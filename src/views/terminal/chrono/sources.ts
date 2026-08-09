/**
 * Where strikes come from.
 *
 * The stores τ-mux already keeps carry the *current* state — this session
 * is working, that one wants approval, three marks exist. None of them
 * carries the moment a state changed, which is the one thing a time axis
 * needs. This module watches them and turns the transitions into
 * timestamped events.
 *
 * Two shapes of source, handled differently on purpose:
 *
 *  - **Derived** (Claude sessions, notifications) — the store re-pushes a
 *    whole snapshot on every tick, so a transition is a *diff* against
 *    what we last saw, stamped with the moment we noticed it. That is the
 *    honest timestamp available: the store does not remember when the
 *    phase changed, only that it has.
 *  - **Authored** (`ht atlas mark`) — the mark carries its own `at` and
 *    its own id, so it is replayed at its real time and deduped by id
 *    rather than by a time window.
 */
import type { ClaudeSessionState } from "../../../shared/claude-types";
import { sessionTitle } from "../../../shared/claude-types";
import { atlasMarks } from "../atlas-annotation-store";
import { noteEvent, type ChronoEventKind } from "./event-log";

/**
 * Watches the Claude session store and the annotation store, and folds
 * what it sees into the event log. One instance per open of the view;
 * `seed()` primes it so opening CHRONO does not strike a rule for every
 * session that merely *exists*.
 */
export class ChronoSources {
  private phases = new Map<string, string>();
  private marks = new Set<string>();
  private notified = new Set<string>();
  private primed = false;

  /**
   * Record current *derived* state without emitting anything.
   *
   * Without this, opening the view during a long turn would draw a "turn
   * started" strike at *now* for a turn that started four minutes ago —
   * the exact lie a time axis exists to prevent. Same for a notification
   * that was already unread when the view opened: we know it is unread,
   * not when it arrived, and inventing "now" would be worse than saying
   * nothing.
   *
   * Marks are deliberately *not* primed. They carry their own `at`, so
   * they can be replayed at the moment they really happened — which is
   * the whole reason an agent writes one.
   */
  seed(
    sessions: readonly ClaudeSessionState[],
    notify: ReadonlySet<string>,
  ): void {
    for (const s of sessions) this.phases.set(s.sessionId, s.phase);
    this.notified = new Set(notify);
    this.primed = true;
  }

  /** Fold a session snapshot in. Returns true when anything was logged. */
  ingestSessions(
    sessions: readonly ClaudeSessionState[],
    now = Date.now(),
  ): boolean {
    if (!this.primed) {
      this.seed(sessions, this.notified);
      return false;
    }
    let logged = false;
    const live = new Set<string>();
    for (const session of sessions) {
      live.add(session.sessionId);
      const before = this.phases.get(session.sessionId);
      this.phases.set(session.sessionId, session.phase);
      if (before === session.phase) continue;
      const event = phaseEvent(before, session.phase);
      if (!event) continue;
      logged =
        noteEvent(event.kind, session.surfaceId, event.text(session), now) ||
        logged;
    }
    for (const id of [...this.phases.keys()]) {
      if (!live.has(id)) this.phases.delete(id);
    }
    return logged;
  }

  /** Fold agent-authored milestones in, at their own timestamps. */
  ingestMarks(): boolean {
    let logged = false;
    for (const mark of atlasMarks()) {
      if (this.marks.has(mark.id)) continue;
      this.marks.add(mark.id);
      logged =
        noteEvent("mark", mark.target ?? null, mark.text, mark.at) || logged;
    }
    return logged;
  }

  /** A workspace that has just grown an unread notification. Dismissals
   *  are not events — nothing happened, something was acknowledged. */
  ingestNotifications(
    workspaces: ReadonlySet<string>,
    now = Date.now(),
  ): boolean {
    let logged = false;
    for (const id of workspaces) {
      if (this.notified.has(id)) continue;
      logged = noteEvent("notify", null, "notification", now) || logged;
    }
    this.notified = new Set(workspaces);
    return logged;
  }
}

/**
 * Which transitions earn a rule across every lane.
 *
 * Not all of them do. `idle → working` is a turn starting and matters;
 * `compacting → working` is bookkeeping. `ended` is a session going away,
 * which the lane's disappearance already says.
 */
function phaseEvent(
  before: string | undefined,
  after: string,
): { kind: ChronoEventKind; text: (s: ClaudeSessionState) => string } | null {
  switch (after) {
    case "working":
      return before === "idle" || before === undefined
        ? { kind: "turn", text: (s) => `${sessionTitle(s)} — turn` }
        : null;
    case "waiting-approval":
      return {
        kind: "approval",
        text: (s) => s.approvalMessage || `${sessionTitle(s)} — approval`,
      };
    case "waiting-input":
      return { kind: "question", text: (s) => `${sessionTitle(s)} — asking` };
    case "error":
      return { kind: "error", text: (s) => `${sessionTitle(s)} — error` };
    case "idle":
      // A turn ending is as much a boundary as one starting, and it is
      // the one you look for when asking "what reacted to what".
      return before === "working"
        ? { kind: "turn", text: (s) => `${sessionTitle(s)} — done` }
        : null;
    default:
      return null;
  }
}
