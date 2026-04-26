/**
 * Tiny markdown → HTML renderer for shareBin's `show_md`.
 *
 * Subset:
 *   #/##/###/####  headings (h1..h4)
 *   ```lang        fenced code blocks (preserves whitespace)
 *   `inline`       inline code
 *   **bold**       bold
 *   _italic_       italic
 *   [text](url)    links (http(s) only — other schemes render as text)
 *   -/* item       unordered list
 *   1. item        ordered list
 *   blank line     paragraph break
 *
 * Deliberately under-featured: no tables, no nested lists, no
 * footnotes, no autolinks. Goal is "agent dropped a README
 * fragment, render it in a panel" — not a full CommonMark
 * implementation. Heavy or off-spec markdown should fall through
 * the safety net (escape + render as preformatted text in the
 * worst case).
 *
 * Pure function; safe to call repeatedly with no side-effects.
 */

import { escapeHtml } from "./escape";

const HEADING_TAGS = ["h1", "h2", "h3", "h4"] as const;
const URL_RE = /^https?:\/\//i;

interface Block {
  kind: "p" | "ul" | "ol" | "code" | "h" | "blank";
  level?: number;
  lang?: string;
  lines: string[];
}

/** Parse + render the input markdown to a self-contained HTML
 *  fragment string. Caller wraps the fragment in their preferred
 *  outer chrome (the shareBin script provides body styling). */
export function renderMarkdown(input: string): string {
  const blocks = parseBlocks(input.replace(/\r\n/g, "\n"));
  return blocks.map(renderBlock).join("\n");
}

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    // Fenced code block.
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        buf.push(lines[i]!);
        i++;
      }
      // Skip closing fence (or hit EOF).
      if (i < lines.length) i++;
      blocks.push({ kind: "code", lang, lines: buf });
      continue;
    }
    // Heading.
    const headMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    if (headMatch) {
      blocks.push({
        kind: "h",
        level: headMatch[1]!.length,
        lines: [headMatch[2]!],
      });
      i++;
      continue;
    }
    // Lists — collect contiguous - / * (ul) or 1. (ol) lines.
    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        buf.push(lines[i]!.replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", lines: buf });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        buf.push(lines[i]!.replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ol", lines: buf });
      continue;
    }
    // Blank line.
    if (line.trim().length === 0) {
      blocks.push({ kind: "blank", lines: [] });
      i++;
      continue;
    }
    // Paragraph — slurp lines until a blank.
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim().length > 0) {
      // Stop at fence / heading / list — those start a new block.
      if (
        lines[i]!.startsWith("```") ||
        /^#{1,4}\s+/.test(lines[i]!) ||
        /^\s*[-*]\s+/.test(lines[i]!) ||
        /^\s*\d+\.\s+/.test(lines[i]!)
      ) {
        break;
      }
      buf.push(lines[i]!);
      i++;
    }
    blocks.push({ kind: "p", lines: buf });
  }
  return blocks;
}

function renderBlock(b: Block): string {
  switch (b.kind) {
    case "blank":
      return "";
    case "h": {
      const tag = HEADING_TAGS[(b.level ?? 1) - 1] ?? "h4";
      return `<${tag}>${renderInline(b.lines[0] ?? "")}</${tag}>`;
    }
    case "code": {
      const langClass = b.lang ? ` class="language-${escapeHtml(b.lang)}"` : "";
      return `<pre><code${langClass}>${escapeHtml(b.lines.join("\n"))}</code></pre>`;
    }
    case "ul":
      return `<ul>${b.lines.map((l) => `<li>${renderInline(l)}</li>`).join("")}</ul>`;
    case "ol":
      return `<ol>${b.lines.map((l) => `<li>${renderInline(l)}</li>`).join("")}</ol>`;
    case "p":
      return `<p>${b.lines.map(renderInline).join("<br>")}</p>`;
  }
}

/** Inline markdown renderer. Order of operations matters — code
 *  spans hide their content from the bold / italic / link passes
 *  by stashing tokens, then we substitute back at the end. */
export function renderInline(text: string): string {
  // 1. Stash inline-code spans so backticks inside them don't
  //    interact with the bold / italic / link regexes.
  const codeBuf: string[] = [];
  let stashed = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    const idx = codeBuf.push(code) - 1;
    return `${idx}`;
  });
  // 2. Escape everything else now (before we inject our tags).
  stashed = escapeHtml(stashed);
  // 3. Bold / italic / link substitutions.
  stashed = stashed.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  stashed = stashed.replace(/_([^_]+)_/g, "<em>$1</em>");
  stashed = stashed.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, label: string, url: string) => {
      if (!URL_RE.test(url)) return label;
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${label}</a>`;
    },
  );
  // 4. Restore inline-code spans (escape the contents now — they
  //    bypassed the earlier escape pass to avoid double-encoding).
  stashed = stashed.replace(/(\d+)/g, (_m, idx: string) => {
    return `<code>${escapeHtml(codeBuf[Number(idx)] ?? "")}</code>`;
  });
  return stashed;
}
