/**
 * Message-shape helpers shared by observers and the summarizer.
 *
 * Pi messages may be plain strings or arrays of content blocks; the
 * extractors below normalise both forms so callers don't need to
 * branch on shape every time.
 */

type ContentBlock = { type?: string; text?: string };

export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content as ContentBlock[]) {
    if (
      part &&
      typeof part === "object" &&
      part.type === "text" &&
      typeof part.text === "string"
    ) {
      parts.push(part.text);
    }
  }
  return parts.join("\n").trim();
}

export interface TurnSlice {
  userPrompt: string;
  assistantTail: string;
}

/** Reduce a per-turn `messages` array (or `{messages: …}`) to the
 *  user's last prompt and the assistant's last reply text, ignoring
 *  tool-call blocks. */
export function sliceTurn(eventMessages: unknown): TurnSlice {
  const msgs: any[] = Array.isArray(eventMessages)
    ? (eventMessages as any[])
    : Array.isArray((eventMessages as any)?.messages)
      ? (eventMessages as any).messages
      : [];

  let userPrompt = "";
  let assistantTail = "";
  for (const m of msgs) {
    const role = m?.role ?? m?.message?.role;
    const content = m?.content ?? m?.message?.content;
    if (role === "user") {
      const t = extractText(content);
      if (t) userPrompt = t;
    } else if (role === "assistant") {
      const t = extractText(content);
      if (t) assistantTail = t;
    }
  }
  return { userPrompt, assistantTail };
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/** Human-friendly elapsed time: "0.4s", "12.3s", "45s", "2 min", "1h 04m". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const sec = ms / 1000;
  if (sec < 10) return `${sec.toFixed(1)}s`;
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = sec / 60;
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
