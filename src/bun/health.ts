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
}

export interface HealthSnapshot {
  /** True iff every entry is `ok` or `disabled`. False if any
   *  subsystem reports `degraded` or `error`. */
  ok: boolean;
  /** Entries in registration order (so the sidebar / CLI render in
   *  a stable order even though the underlying map is unordered). */
  entries: HealthEntry[];
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
   *  message both match the prior write. */
  set(id: string, severity: HealthSeverity, message: string): void {
    const prev = this.entries.get(id);
    if (
      prev !== undefined &&
      prev.severity === severity &&
      prev.message === message
    ) {
      return;
    }
    this.entries.set(id, {
      id,
      severity,
      message,
      updatedAt: this.now(),
    });
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
   *  cheap, called per RPC; not memoised. */
  snapshot(): HealthSnapshot {
    const entries = this.order
      .map((id) => this.entries.get(id))
      .filter((e): e is HealthEntry => e !== undefined);
    const ok = entries.every(
      (e) => e.severity === "ok" || e.severity === "disabled",
    );
    return { ok, entries };
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
