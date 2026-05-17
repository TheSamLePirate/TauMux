// P7 S6 — Auto-continue paused-surfaces persistence.
//
// The auto-continue engine carries an in-memory set of paused surface
// ids. Without disk persistence, every restart silently re-enables
// auto-continue for surfaces the user had explicitly paused — a
// quiet UX regression: the user pauses an agent that's looping,
// closes the lid, comes back, and the agent resumes on its own.
//
// Same shape as `notification-persistence.ts`: a `load(path)` boot
// helper + a `createDebouncedPersister(path)` that returns a
// `persist(ids)` callback. Versioned on disk (`version: 1`) so
// future shape changes can be migrated without a corrupt-file
// surprise.

import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic-write";

interface PersistedShape {
  version: 1;
  paused: string[];
}

const FILE_VERSION = 1;

/** Read the paused-surfaces snapshot from disk. Returns an empty
 *  array on any IO / parse / version error so a corrupt file can't
 *  block boot — the engine just starts with no paused surfaces. */
export function loadPausedSurfaces(path: string): string[] {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    if (parsed.version !== FILE_VERSION) return [];
    if (!Array.isArray(parsed.paused)) return [];
    // Filter the array down to strings; a tampered file with mixed
    // types is treated as "best-effort recover what we can".
    return parsed.paused.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

/** Build a debounced persist callback. Subsequent calls within
 *  `delayMs` reset the timer; the actual write uses `writeFileAtomic`
 *  so the reader never sees a half-written file. */
export function createPausedSurfacesPersister(
  path: string,
  delayMs: number = 300,
): { persist: (ids: readonly string[]) => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: readonly string[] = [];

  const writeNow = (): void => {
    try {
      const payload: PersistedShape = {
        version: FILE_VERSION,
        paused: [...pending],
      };
      writeFileAtomic(path, JSON.stringify(payload));
    } catch {
      /* a busted FS must not break pause/resume — silent drop */
    }
  };

  return {
    persist: (ids) => {
      pending = ids;
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
