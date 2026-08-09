/**
 * The event log — what happened, and when.
 *
 * CHRONO's second half is the vertical strike: an approval landing at
 * t−40 s is one rule crossing every lane at the same x, and you can *see*
 * which panes went quiet and which woke up when it happened. Causality as
 * geometry.
 *
 * Drawing that needs something τ-mux did not have. Session phase
 * transitions, approvals, notifications and `ht atlas mark` are all
 * *known* — the stores carry them — but none of them is **timestamped
 * into a ring**. `claude-session-store` holds the current phase, not the
 * moment it changed. This module is the missing axis, and it is
 * deliberately the same shape and the same discipline as
 * `metrics-history`:
 *
 *  - **No timers.** Events are pushed by whoever is already awake. An
 *    idle τ-mux records nothing and costs nothing.
 *  - **Bounded, forever.** A fixed cap and a TTL, both enforced on write.
 *    A week-long session cannot grow this.
 *  - **Deduped.** The stores re-push whole snapshots on every tick, so
 *    the same transition arrives several times; without a dedupe window
 *    one approval would draw four rules a pixel apart.
 */

/** Events retained. A busy agent turn is a prompt, a reply and a dozen
 *  tool calls, so a five-minute window can legitimately hold a few
 *  hundred; the cap is a safety net rather than a policy. */
const CAPACITY = 512;

/** Events older than this are dropped. Matches the widest timebase, so
 *  zooming all the way out never reaches past what the log remembers. */
const TTL_MS = 300_000;

/** Two events of the same kind on the same surface inside this window are
 *  the same event arriving twice. */
const DEDUPE_MS = 900;

/**
 * What a strike means. The kinds are the ones worth a rule across every
 * lane — a moment where the shape of the session changed. Ordinary
 * output is already drawn, continuously, as the traces.
 */
export type ChronoEventKind =
  /** The human said something to an agent. */
  | "prompt"
  /** An agent replied. */
  | "reply"
  /** An agent reached for a tool. */
  | "tool"
  /** An agent turn began or ended. */
  | "turn"
  /** A task or plan step changed state. */
  | "task"
  /** A tool is waiting for consent. */
  | "approval"
  /** A question is on screen for the human. */
  | "question"
  /** A turn ended on an API error, or a tool failed. */
  | "error"
  /** An unread τ-mux notification. */
  | "notify"
  /** `ht atlas mark` — an agent-authored milestone. */
  | "mark";

export interface ChronoEvent {
  /** `Date.now()` when it happened. */
  at: number;
  kind: ChronoEventKind;
  /** The pane it belongs to, when it has one. Strikes span every lane
   *  regardless; this is for the label and the inspector. */
  surfaceId: string | null;
  /** One short line. Shown on the axis when the strike has room. */
  text: string;
}

let events: ChronoEvent[] = [];

/**
 * Record one event. Returns true when it was actually stored — a
 * duplicate inside the dedupe window is dropped and returns false, which
 * callers can use to decide whether the field needs repainting.
 */
export function noteEvent(
  kind: ChronoEventKind,
  surfaceId: string | null,
  text: string,
  now = Date.now(),
): boolean {
  const key = `${kind}:${surfaceId ?? ""}:${text}`;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (now - e.at > DEDUPE_MS) break;
    if (`${e.kind}:${e.surfaceId ?? ""}:${e.text}` === key) return false;
  }
  events.push({ at: now, kind, surfaceId, text });
  prune(now);
  return true;
}

/** Events inside `windowMs` of `now`, oldest first. */
export function eventsSince(windowMs: number, now = Date.now()): ChronoEvent[] {
  const floor = now - windowMs;
  return events.filter((e) => e.at >= floor && e.at <= now);
}

/** Every retained event, oldest first. */
export function allEvents(): readonly ChronoEvent[] {
  return events;
}

function prune(now: number): void {
  const floor = now - TTL_MS;
  if (events.length > CAPACITY || (events[0] && events[0].at < floor)) {
    events = events.filter((e) => e.at >= floor).slice(-CAPACITY);
  }
}

/** Test seam. */
export function resetEvents(): void {
  events = [];
}
