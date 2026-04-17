/**
 * Pure, DOM-agnostic helpers extracted from agent-panel.ts. Nothing in
 * this file should reach into the panel's view/state — functions here
 * are input-in, output-out so they can be tested in isolation.
 */

export interface ImageAttachment {
  type: "image";
  data: string;
  mimeType: string;
  fileName?: string;
}

export function parseToolArgs(args: unknown): {
  command?: string;
  path?: string;
  pattern?: string;
  url?: string;
  fullOutputPath?: string | null;
} {
  if (!args) return {};
  if (typeof args === "object") {
    const rec = args as Record<string, unknown>;
    return {
      command: rec["command"] as string | undefined,
      path:
        (rec["path"] as string | undefined) ??
        (rec["file_path"] as string | undefined),
      pattern: rec["pattern"] as string | undefined,
      url: rec["url"] as string | undefined,
      fullOutputPath: rec["fullOutputPath"] as string | null | undefined,
    };
  }
  try {
    return parseToolArgs(JSON.parse(String(args)));
  } catch {
    return {};
  }
}

export function formatArgs(args: unknown): string {
  if (!args) return "";
  try {
    const s = typeof args === "string" ? args : JSON.stringify(args);
    const parsed = JSON.parse(s);
    if (parsed.command) return parsed.command;
    if (parsed.path) return parsed.path;
    if (parsed.file_path) return parsed.file_path;
    if (parsed.pattern) return parsed.pattern;
    return s.length > 120 ? s.slice(0, 117) + "\u2026" : s;
  } catch {
    return String(args).slice(0, 120);
  }
}

export function extractContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);
  return content
    .map((c) => {
      const rec = c as Record<string, unknown>;
      if (typeof rec["text"] === "string") return rec["text"] as string;
      if (typeof rec["thinking"] === "string") return rec["thinking"] as string;
      return "";
    })
    .join("");
}

export function extractTextBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return extractContent(content);
  return content
    .map((c) => {
      const rec = c as Record<string, unknown>;
      return rec["type"] === "text" ? ((rec["text"] as string) ?? "") : "";
    })
    .join("");
}

export function extractThinkingBlocks(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((c) => {
      const rec = c as Record<string, unknown>;
      return rec["type"] === "thinking"
        ? ((rec["thinking"] as string) ?? "")
        : "";
    })
    .join("");
  return text || undefined;
}

export function extractImageBlocks(
  content: unknown,
): ImageAttachment[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const images = content
    .map((c) => {
      const rec = c as Record<string, unknown>;
      if (rec["type"] !== "image") return null;
      return {
        type: "image" as const,
        data: (rec["data"] as string) ?? "",
        mimeType: (rec["mimeType"] as string) ?? "image/png",
      };
    })
    .filter((img): img is ImageAttachment => Boolean(img?.data));
  return images.length ? images : undefined;
}

export function autoResize(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 180) + "px";
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function mdLite(text: string): string {
  let h = escapeHtml(text);
  // Code blocks with language labels
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const langLabel = lang
      ? `<span class="agent-code-lang">${lang}</span>`
      : "";
    return `<div class="agent-code-wrap">${langLabel}<pre class="agent-code"><code>${code.trim()}</code></pre></div>`;
  });
  h = h.replace(/`([^`]+)`/g, '<code class="agent-ic">$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Headers
  h = h.replace(/^### (.+)$/gm, '<div class="agent-md-h3">$1</div>');
  h = h.replace(/^## (.+)$/gm, '<div class="agent-md-h2">$1</div>');
  h = h.replace(/^# (.+)$/gm, '<div class="agent-md-h1">$1</div>');
  // Lists
  h = h.replace(/^- (.+)$/gm, '<div class="agent-md-li">\u2022 $1</div>');
  h = h.replace(/^\d+\. (.+)$/gm, '<div class="agent-md-li">$&</div>');
  h = h.replace(/\n/g, "<br>");
  return h;
}

export function highlightDiff(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        return `<span class="agent-diff-add">${escapeHtml(line)}</span>`;
      }
      if (line.startsWith("-") && !line.startsWith("---")) {
        return `<span class="agent-diff-del">${escapeHtml(line)}</span>`;
      }
      return escapeHtml(line);
    })
    .join("\n");
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function dispatch(event: string, detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent(event, { detail }));
}
