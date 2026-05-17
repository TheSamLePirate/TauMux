/**
 * System health aggregator.
 *
 * Each subsystem (pty, metadata, telegram, socket, web mirror, audits)
 * pushes its current state into a single registry; consumers
 * (`system.health` RPC, `ht health` CLI, future sidebar pill) read
 * the snapshot.
 *
 * Why a registry instead of polling each subsystem:
 *   1. Subsystems already know when they enter a bad state — make
 *      them push, don't make health probe.
 *   2. State pushes are idempotent — repeated `set("telegram", "ok")`
 *      is a no-op. No tearing on the read side.
 *   3. The aggregator stays UI-free and process-free. Trivially unit-
 *      testable; no fixtures.
 *
 * Severity model:
 *   - `ok`        subsystem is fully functional
 *   - `degraded`  partial loss (e.g. telegram in conflict / backoff,
 *                 web mirror disabled by setting, audit warned)
 *   - `error`     hard failure (telegram crashed, socket unbound)
 *   - `disabled`  intentionally off (telegram token missing, web
 *                 mirror autoStart=false, audit set to null) — does
 *                 NOT count against `overall.ok`
 */

export type HealthSeverity = "ok" | "degraded" | "error" | "disabled";

/** Phase 7 — optional remediation a subsystem can attach to a
 *  degraded / error entry. Mirrors the `AuditFix` pattern in
 *  `src/bun/audits.ts`: a short user-friendly label + an async
 *  `action()` that performs the change. The bun side stores the
 *  action (not wire-safe) and exposes a `label` + a stable `fixId`
 *  on the snapshot so the CLI / sidebar can render a button and
 *  invoke the action via the `health.fix` RPC. */
export interface HealthFix {
  /** Button-friendly description, e.g. "Restart Telegram poller". */
  label: string;
  /** Performs the remediation. Resolves once it has landed; throwing
   *  surfaces as an error message on the next snapshot. */
  action: () => Promise<void>;
}

export interface HealthEntry {
  /** Stable id for the subsystem. Use kebab-case. */
  id: string;
  severity: HealthSeverity;
  /** Human-readable one-liner. Surfaced by `ht health` and the
   *  future sidebar pill tooltip. */
  message: string;
  /** Wall-clock ms when the entry was last updated. Surfaced so
   *  consumers can flag stale entries (a metadata poller stuck in a
   *  loop will stop pushing — the timestamp will go cold). */
  updatedAt: number;
  /** Phase 7 — optional remediation. Subsystems publishing a
   *  degraded / error entry can attach a `fix()` so the sidebar
   *  pill or `ht health fix <id>` can recover with one click. The
   *  field is internal-only (not on the wire snapshot — see
   *  `HealthEntrySnapshot` below). */
  fix?: HealthFix;
}

/** Wire-safe view of a health entry. The `fix.action` callback isn't
 *  JSON-serialisable; the snapshot replaces it with a `fixLabel`
 *  string so the CLI / sidebar know "there's a button to render"
 *  without trying to send the function across the wire. */
export interface HealthEntrySnapshot {
  id: string;
  severity: HealthSeverity;
  message: string;
  updatedAt: number;
  /** When present, the entry advertises a one-step fix. The caller
   *  invokes it via the `health.fix` RPC keyed on the entry's id. */
  fixLabel?: string;
}

export interface HealthSnapshot {
  /** True iff every entry is `ok` or `disabled`. False if any
   *  subsystem reports `degraded` or `error`. */
  ok: boolean;
  /** Entries in registration order, in wire-safe form (no `fix.action`
   *  callbacks). */
  entries: HealthEntrySnapshot[];
}

/** Health registry — owned by the bun process. Subsystems call
 *  `set(id, severity, message)` to publish their state. */
export class HealthRegistry {
  private entries = new Map<string, HealthEntry>();
  private order: string[] = [];
  private subscribers = new Set<(snapshot: HealthSnapshot) => void>();
  private now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  /** Push the current state of a subsystem. New ids land at the end
   *  of the rendered order; subsequent updates keep their position
   *  (predictable for UIs). Idempotent — no-op when severity +
   *  message + fix all match the prior write.
   *
   *  Phase 7 — optional `fix` carries a one-step remediation that the
   *  CLI / sidebar surfaces as a button. The action is invoked via
   *  `runFix(id)` (or the `health.fix` RPC); it's not on the wire
   *  snapshot (functions don't serialise). */
  set(
    id: string,
    severity: HealthSeverity,
    message: string,
    fix?: HealthFix,
  ): void {
    const prev = this.entries.get(id);
    if (
      prev !== undefined &&
      prev.severity === severity &&
      prev.message === message &&
      // Fix identity matters too — a subsystem that recovers and
      // wants to drop its previous fix needs to push again.
      prev.fix?.label === fix?.label
    ) {
      return;
    }
    const entry: HealthEntry = {
      id,
      severity,
      message,
      updatedAt: this.now(),
    };
    if (fix) entry.fix = fix;
    this.entries.set(id, entry);
    if (!prev) this.order.push(id);
    this.notify();
  }

  /** Forget a subsystem. Mostly useful for tests — production code
   *  should prefer `set(id, "disabled", …)` over removal so the row
   *  stays visible. */
  remove(id: string): void {
    if (!this.entries.has(id)) return;
    this.entries.delete(id);
    this.order = this.order.filter((k) => k !== id);
    this.notify();
  }

  /** Read the current state. Computes `overall.ok` from the entries —
   *  cheap, called per RPC; not memoised. Phase 7: projects the
   *  wire-safe `HealthEntrySnapshot` view, replacing any attached
   *  `fix` with a `fixLabel` string. */
  snapshot(): HealthSnapshot {
    const entries: HealthEntrySnapshot[] = this.order
      .map((id) => this.entries.get(id))
      .filter((e): e is HealthEntry => e !== undefined)
      .map((e) => {
        const out: HealthEntrySnapshot = {
          id: e.id,
          severity: e.severity,
          message: e.message,
          updatedAt: e.updatedAt,
        };
        if (e.fix) out.fixLabel = e.fix.label;
        return out;
      });
    const ok = entries.every(
      (e) => e.severity === "ok" || e.severity === "disabled",
    );
    return { ok, entries };
  }

  /** Phase 7 — run the remediation attached to an entry, then return
   *  the post-fix snapshot. Throws when:
   *    - the entry doesn't exist
   *    - the entry has no `fix` attached
   *    - the action itself rejected (the error message propagates)
   *
   *  Subsystems are expected to push a fresh `set(id, "ok", …)` from
   *  inside their `action()` so the snapshot reflects the recovery.
   *  If they don't, the entry stays at its previous severity — the
   *  caller can re-poll. */
  async runFix(id: string): Promise<HealthSnapshot> {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error(`health.runFix: no entry for id "${id}"`);
    }
    if (!entry.fix) {
      throw new Error(`health.runFix: entry "${id}" has no fix attached`);
    }
    await entry.fix.action();
    return this.snapshot();
  }

  /** Subscribe to snapshot updates. Returns an unsubscribe handle.
   *  The bun-side broadcaster wires this to web mirror clients so
   *  the future sidebar pill updates without polling. Subscribers
   *  are called synchronously after each `set` / `remove` — cheap,
   *  but they should not throw. */
  subscribe(fn: (snapshot: HealthSnapshot) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private notify(): void {
    const snap = this.snapshot();
    for (const fn of this.subscribers) {
      try {
        fn(snap);
      } catch {
        /* a buggy subscriber must not break the registry */
      }
    }
  }
}
