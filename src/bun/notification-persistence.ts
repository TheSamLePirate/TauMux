// P7 S3 — Notification history persistence.
//
// The in-memory notification list lives in `NotificationStore.list`,
// capped at MAX_NOTIFICATIONS (500). Without persistence the user
// loses every notification on bun restart — losing the auto-continue
// history, the per-pane chronology, and any unactioned reminders.
//
// This module wraps the store with a tiny load-on-create + debounced
// save-on-mutation contract:
//
//   - `loadInto(path, store)` reads `$path` (if present) and seeds the
//     store. Bad JSON / unexpected shape → silent no-op (treated as
//     empty history); we never throw from boot-time IO.
//
//   - `createDebouncedPersister(path, store, delayMs)` returns a fn
//     suitable for `NotificationStore.persist`. Each call schedules a
//     debounced write so a burst of notifications coalesces into a
//     single fsync.
//
// We deliberately don't return a Promise — the contract is
// "fire-and-forget" so the RPC handlers don't have to await IO from
// inside their synchronous flows.

import { existsSync, readFileSync } from "node:fs";
import type { Notification, NotificationStore } from "./rpc-handlers/types";
import { writeFileAtomic } from "./atomic-write";

interface PersistedShape {
  version: 1;
  counter: number;
  list: Notification[];
}

const FILE_VERSION = 1;
const MAX_PERSISTED = 500;

/** Hydrate the store from disk. Best-effort — any IO or JSON error is
 *  swallowed and treated as "no prior history", so a corrupt file
 *  can't fail boot. The on-disk shape is versioned (`version: 1`) so
 *  future migrations can detect older snapshots without re-shaping. */
export function loadInto(path: string, store: NotificationStore): void {
  if (!existsSync(path)) return;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    if (parsed.version !== FILE_VERSION) return;
    if (!Array.isArray(parsed.list)) return;
    if (typeof parsed.counter !== "number") return;
    // Trim down to MAX_PERSISTED — a tampered file with 50k entries
    // would otherwise spike RAM + every broadcast frame.
    const trimmed = parsed.list.slice(-MAX_PERSISTED);
    store.list.push(...trimmed);
    store.counter = parsed.counter;
  } catch {
    /* corrupt file → treat as empty history (silent) */
  }
}

/** Build a debounced `persist()` callback that writes the store to
 *  disk after `delayMs` of quiet. Subsequent calls within the window
 *  reset the timer; the actual write uses `writeFileAtomic` so the
 *  reader never sees a half-written file. Returns the callback plus
 *  a `flush()` helper that fires the pending write immediately
 *  (useful at shutdown). */
export function createDebouncedPersister(
  path: string,
  store: NotificationStore,
  delayMs: number = 300,
): { persist: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const writeNow = (): void => {
    try {
      const payload: PersistedShape = {
        version: FILE_VERSION,
        counter: store.counter,
        // Re-trim on write so a runtime that exceeded the cap can't
        // persist beyond what we'd load.
        list: store.list.slice(-MAX_PERSISTED),
      };
      writeFileAtomic(path, JSON.stringify(payload));
    } catch {
      /* a busted FS must not break notifications — log on the next
         tick if we ever wire one in, but never throw from the persist
         channel */
    }
  };

  return {
    persist: () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        writeNow();
      }, delayMs);
    },
    flush: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      writeNow();
    },
  };
}
