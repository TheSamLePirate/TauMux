/**
 * Auto-continue heuristic (Plan #09 §B, Commit A version).
 *
 * Pure decision function — no Claude API calls, no model providers.
 * Inputs are a `Plan` (or null when no plan is published), the
 * trailing N lines of the agent surface, and the agent's turn-end
 * notification text. Output is a structured action the host can
 * dispatch: continue with an instruction, or wait (with a reason).
 *
 * The function never throws and never reaches outside its inputs —
 * makes it trivially testable, and gives the host a stable contract
 * before a model-backed engine lands in a follow-up.
 *
 * Decision tree (in order; first match wins):
 *
 *   1. Notification / surface tail mentions an error
 *      ("error" / "failed" / "denied" / "permission" / "fatal")
 *      → wait. Pushing through a real failure is exactly what the
 *      user wants the auto-continue to NOT do.
 *
 *   2. Surface tail ends with a question ("?" within last 5 lines
 *      that aren't whitespace-only) → wait. The agent is asking
 *      for input, not just paused at a step boundary.
 *
 *   3. Plan exists and has a `waiting` or `active` step beyond the
 *      most-recently-`done` step → continue with `Continue <id>`.
 *      The instruction names the next step explicitly so the agent
 *      doesn't have to re-read its plan to know where to resume.
 *
 *   4. Plan exists but every step is `done` (or only `err` remain)
 *      → wait. Either the agent finished or there's nothing
 *      productive to push toward.
 *
 *   5. No plan / unknown shape → wait. Without a plan, the
 *      heuristic has no anchor to ground a "continue" against;
 *      blindly nudging the agent here is more annoying than
 *      helpful.
 */

import type { Plan, PlanStep } from "../shared/types";

export type AutoContinueAction = "continue" | "wait";

export interface AutoContinueDecision {
  action: AutoContinueAction;
  /** One short sentence — surfaced to the user via the sidebar log
   *  + the rotating app log so they can audit why a continue did
   *  or didn't fire. */
  reason: string;
  /** When `action === "continue"`, the literal text the host
   *  should send into the agent's surface (with a trailing newline
   *  to enter the prompt). Always `undefined` when waiting. */
  instruction?: string;
}

export interface AutoContinueInput {
  plan: Plan | null;
  /** Trailing lines of the originating agent surface, newest last.
   *  Lines may contain ANSI escapes — we treat the content as opaque
   *  text and only check for substrings, so escape codes don't
   *  matter. Empty array is fine. */
  surfaceTail: readonly string[];
  /** The notification body / message that fired the turn-end event.
   *  Often "completed M2", "ran tests", or simply blank. */
  notificationText?: string;
}

const ERROR_TOKENS = [
  "error:",
  "errored",
  "failed",
  "failure",
  "fatal",
  "denied",
  "permission denied",
  "exception",
  "traceback",
  "panic:",
];

const QUESTION_LOOKBACK_LINES = 5;

export function decideAutoContinue(
  input: AutoContinueInput,
): AutoContinueDecision {
  const tail = input.surfaceTail ?? [];
  const notif = (input.notificationText ?? "").trim();
  const notifLower = notif.toLowerCase();

  // 1. Error guard — never push through a real failure.
  if (containsErrorToken(notifLower)) {
    return {
      action: "wait",
      reason: `Notification mentions an error (${quoteShort(notif)})`,
    };
  }
  for (const line of tail) {
    if (containsErrorToken(line.toLowerCase())) {
      return {
        action: "wait",
        reason: `Surface tail mentions an error (${quoteShort(line)})`,
      };
    }
  }

  // 2. Question guard — don't push through an unanswered "?".
  const questionLine = findTrailingQuestion(tail);
  if (questionLine !== null) {
    return {
      action: "wait",
      reason: `Agent asked a question (${quoteShort(questionLine)})`,
    };
  }

  // 3. Plan-driven continue.
  const plan = input.plan;
  if (plan && plan.steps.length > 0) {
    const next = pickNextStep(plan.steps);
    if (next) {
      return {
        action: "continue",
        reason: `Plan step ${next.id} is ${next.state}; continuing.`,
        instruction: `Continue ${next.id}`,
      };
    }
    return {
      action: "wait",
      reason: "Plan has no remaining `waiting` or `active` steps.",
    };
  }

  // 5. Fallback — no plan to anchor a continue against.
  return {
    action: "wait",
    reason: "No plan published; refusing to nudge agent without anchor.",
  };
}

function containsErrorToken(text: string): boolean {
  if (!text) return false;
  for (const t of ERROR_TOKENS) {
    if (text.includes(t)) return true;
  }
  return false;
}

/** Walk the trailing lines newest-first; return the first non-blank
 *  line if it ends with `?`. Returns null otherwise. Five lines is
 *  enough to catch agents that follow their question with a blank
 *  prompt or a status pill suffix. */
function findTrailingQuestion(tail: readonly string[]): string | null {
  let scanned = 0;
  for (
    let i = tail.length - 1;
    i >= 0 && scanned < QUESTION_LOOKBACK_LINES;
    i--
  ) {
    const raw = tail[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    scanned++;
    if (trimmed.endsWith("?")) return trimmed;
  }
  return null;
}

/** Pick the step the agent should advance toward. Prefers the
 *  currently-`active` step (already in progress); falls back to the
 *  first `waiting` step. Returns null when nothing is left to do. */
function pickNextStep(steps: readonly PlanStep[]): PlanStep | null {
  const active = steps.find((s) => s.state === "active");
  if (active) return active;
  const waiting = steps.find((s) => s.state === "waiting");
  if (waiting) return waiting;
  return null;
}

/** Trim and clip a fragment for inclusion in a single-line reason
 *  message. Long lines or notification bodies would otherwise
 *  smother the sidebar log on the next refresh. */
function quoteShort(text: string): string {
  const stripped = text.replace(/\s+/g, " ").trim();
  if (stripped.length <= 60) return stripped;
  return `${stripped.slice(0, 57)}…`;
}
