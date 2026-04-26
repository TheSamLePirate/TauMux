/**
 * Unified-diff parser + side-by-side HTML renderer for shareBin's
 * `show_diff`. Accepts the output of `git diff` /
 * `diff -u a b`; lines fall into four categories:
 *
 *   `+`  addition (right side; "after")
 *   `-`  deletion (left side; "before")
 *   ` `  context (both sides)
 *   `@@` hunk header (separator)
 *
 * The renderer pairs additions and deletions when they sit
 * adjacent in the same hunk so the side-by-side view aligns
 * correctly. Lines without a counterpart are placed on one side
 * with the other side blank.
 *
 * Pure rendering — input string in, HTML fragment string out. No
 * DOM, no async work. Caller wraps the fragment with chrome +
 * stylesheet.
 */

import { escapeHtml } from "./escape";

interface DiffLine {
  kind: "add" | "del" | "ctx" | "hunk" | "header";
  text: string;
}

interface SideRow {
  left: { text: string; kind: "del" | "ctx" | "" };
  right: { text: string; kind: "add" | "ctx" | "" };
}

/** Parse a unified-diff string and return a side-by-side HTML
 *  table fragment. The fragment is `<table class="diff">…</table>`
 *  with one row per aligned line. */
export function renderUnifiedDiff(input: string): string {
  const lines = parseDiff(input.replace(/\r\n/g, "\n"));
  const rows = pairLines(lines);
  const tbody = rows.map(renderRow).join("");
  return `<table class="diff"><tbody>${tbody}</tbody></table>`;
}

function parseDiff(text: string): DiffLine[] {
  const out: DiffLine[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("@@")) {
      out.push({ kind: "hunk", text: line });
      continue;
    }
    // git diff file headers — kept as separators so we can group
    // hunks under their file. Not paired with anything.
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      out.push({ kind: "header", text: line });
      continue;
    }
    if (line.startsWith("+")) {
      out.push({ kind: "add", text: line.slice(1) });
      continue;
    }
    if (line.startsWith("-")) {
      out.push({ kind: "del", text: line.slice(1) });
      continue;
    }
    if (line.startsWith(" ")) {
      out.push({ kind: "ctx", text: line.slice(1) });
      continue;
    }
    // Blank lines / unknown — treat as context.
    out.push({ kind: "ctx", text: line });
  }
  return out;
}

function pairLines(lines: DiffLine[]): SideRow[] {
  const rows: SideRow[] = [];
  // Pending del lines, waiting to pair with an upcoming add.
  let pendingDels: string[] = [];

  function flushDels(): void {
    for (const d of pendingDels) {
      rows.push({
        left: { text: d, kind: "del" },
        right: { text: "", kind: "" },
      });
    }
    pendingDels = [];
  }

  for (const line of lines) {
    if (line.kind === "del") {
      pendingDels.push(line.text);
      continue;
    }
    if (line.kind === "add") {
      const paired = pendingDels.shift();
      rows.push({
        left:
          paired !== undefined
            ? { text: paired, kind: "del" }
            : { text: "", kind: "" },
        right: { text: line.text, kind: "add" },
      });
      continue;
    }
    // Context / hunk header / file header — flush pending dels first.
    flushDels();
    if (line.kind === "ctx") {
      rows.push({
        left: { text: line.text, kind: "ctx" },
        right: { text: line.text, kind: "ctx" },
      });
      continue;
    }
    // Hunk + file headers occupy the full row width via a sentinel
    // we pick up at render time.
    rows.push({
      left: { text: line.text, kind: "" },
      right: { text: "__SPAN__", kind: "" },
    });
  }
  flushDels();
  return rows;
}

function renderRow(row: SideRow): string {
  const isSpan = row.right.text === "__SPAN__";
  if (isSpan) {
    return `<tr class="diff-sep"><td colspan="2"><code>${escapeHtml(row.left.text)}</code></td></tr>`;
  }
  const leftClass = row.left.kind ? ` class="diff-${row.left.kind}"` : "";
  const rightClass = row.right.kind ? ` class="diff-${row.right.kind}"` : "";
  return `<tr><td${leftClass}><code>${escapeHtml(row.left.text)}</code></td><td${rightClass}><code>${escapeHtml(row.right.text)}</code></td></tr>`;
}
