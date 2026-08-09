/**
 * Agent activity → strikes.
 *
 * A native Claude pane streams the whole session: the prompt you typed,
 * every tool it reached for, the reply it came back with. That stream is
 * already decoded once, for the pane's transcript, by
 * `digestClaudeEvent` — so this reuses it rather than parsing the SDK's
 * envelope a second time. One decoder, two consumers; a second one would
 * drift the day the SDK changes a field name.
 *
 * What lands on the axis and what does not:
 *
 *  - **Prompts, replies, tool calls, permission requests** — each is a
 *    discrete thing that happened at a knowable moment. These are the
 *    "every action" the timeline is for.
 *  - **Deltas** — dropped. `assistant-delta` fires per token; a strike
 *    per token is not a timeline, it is a fill pattern. The reply's
 *    *arrival* is the event, and that is `assistant-final`.
 *  - **Tool results** — only failures. A tool starting is the action; a
 *    tool succeeding is that action finishing normally, and drawing both
 *    doubles every rule for no added meaning. A tool *failing* is a new
 *    fact and gets its own.
 */
import { digestClaudeEvent } from "../claude-agent-pane";
import { noteEvent, type ChronoEventKind } from "./event-log";

/** Longest a strike label gets. The rail truncates too, but keeping the
 *  log itself bounded stops one enormous prompt from sitting in memory
 *  for the whole TTL. */
const MAX_TEXT = 72;

function short(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length <= MAX_TEXT ? line : `${line.slice(0, MAX_TEXT - 1)}…`;
}

/**
 * Fold one raw agent event into the log. Returns true when something was
 * recorded, so the caller can decide whether the field needs repainting
 * — the common case is a delta, and the common case must be free.
 */
export function noteAgentActivity(surfaceId: string, event: unknown): boolean {
  let logged = false;
  for (const op of digestClaudeEvent(event)) {
    const mapped = mapOp(op);
    if (!mapped) continue;
    logged = noteEvent(mapped.kind, surfaceId, mapped.text) || logged;
  }
  return logged;
}

type Op = ReturnType<typeof digestClaudeEvent>[number];

function mapOp(op: Op): { kind: ChronoEventKind; text: string } | null {
  switch (op.kind) {
    case "user-text":
      return { kind: "prompt", text: short(op.text) };
    case "assistant-final":
      // A pure tool-use message finalizes with empty text; the tool calls
      // in it are already their own strikes and this would be a rule with
      // nothing behind it.
      return op.text.trim() ? { kind: "reply", text: short(op.text) } : null;
    case "tool-start":
      return {
        kind: "tool",
        text: op.summary ? `${op.name} · ${short(op.summary)}` : op.name,
      };
    case "tool-result":
      return op.isError
        ? { kind: "error", text: short(op.output) || "tool failed" }
        : null;
    case "perm":
      return op.status === "pending"
        ? { kind: "approval", text: `${op.toolName} needs consent` }
        : null;
    case "result":
      return {
        kind: "turn",
        text: op.isError ? "turn failed" : "turn done",
      };
    default:
      return null;
  }
}
