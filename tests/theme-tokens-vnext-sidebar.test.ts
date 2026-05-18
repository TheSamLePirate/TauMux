// P7 S39 chunk 1 — Cluster H, vNext sidebar / notification / server-
// row overrides. A pure-reuse pass: 11 literals collapse onto the
// S37 vnext-text-* family + the existing white-alpha tokens with
// zero new entries.
//
// Reuses:
// - --ht-vnext-text-mute (0.48): progress-inline-label fg
// - --ht-vnext-text-section-h (0.46): sidebar-section-header fg
// - --ht-vnext-text-emph (0.94, 2pp harmonisation from the 0.92
//   literal): sidebar-section-clear hover fg
// - --ht-chip-bg (0.05): section-header border-top, section-clear
//   hover bg, sidebar-footer border-top
// - --ht-agent-row-bg-hover-card (0.06): notification/log + server-
//   row borders
// - --ht-package-header-bg-hover (0.03, 0.5pp harmonisation from
//   the 0.035 literal): notif/log bg + inset highlight + server-
//   row bg
//
// Most of these selectors have a base rule earlier in the file;
// tests scope to the vNext block (lines ~5270–5340).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const indexCss = readFileSync(
  join(repo, "src", "views", "terminal", "index.css"),
  "utf8",
);

// vNext "2026-refresh" block = the SECOND `#titlebar {` rule in
// the file (line ~4945, just below the "2026-refresh titlebar
// override neutralised" comment) through to the THIRD #titlebar {
// rule (line ~5995, where the next pass begins). This bracket
// covers the progress-inline-label, sidebar-section-*, notification-
// item, sidebar-footer, sidebar-server-row overrides plus the
// palette / prompt / surface chrome from S37/S38.
// Use \n#titlebar { so indented @media nested selectors don't get
// counted as top-level rule starts.
const titlebarMatches: number[] = [];
let off = 0;
while (off < indexCss.length) {
  const i = indexCss.indexOf("\n#titlebar {", off);
  if (i < 0) break;
  titlebarMatches.push(i + 1);
  off = i + 1;
}
if (titlebarMatches.length < 3) {
  throw new Error("expected ≥3 #titlebar { rules");
}
const vStart = titlebarMatches[1];
const vEnd = titlebarMatches[2];
const vBlock = indexCss.slice(vStart, vEnd);

describe("theme-token migration — vNext sidebar/notif/server (P7 S39 chunk 1)", () => {
  test(".progress-inline-label uses vnext-text-mute", () => {
    const rule = matchRule(vBlock, ".progress-inline-label");
    expect(rule).toContain("var(--ht-vnext-text-mute)");
  });

  test(".sidebar-section-header (vNext) uses vnext-text-section-h + chip-bg", () => {
    const rule = matchRule(vBlock, ".sidebar-section-header");
    expect(rule).toContain("var(--ht-vnext-text-section-h)");
    expect(rule).toContain("var(--ht-chip-bg)");
  });

  test(".sidebar-section-clear:hover uses chip-bg + vnext-text-emph (0.92 → 0.94 2pp harmonisation)", () => {
    const rule = matchRule(vBlock, ".sidebar-section-clear:hover");
    expect(rule).toContain("var(--ht-chip-bg)");
    expect(rule).toContain("var(--ht-vnext-text-emph)");
  });

  test("notification-item + log-item reuse agent-row-bg-hover-card + package-header-bg-hover", () => {
    expect(vBlock).toMatch(
      /\.notification-item,\s*\n\.log-item \{[^}]*var\(--ht-agent-row-bg-hover-card\)[^}]*var\(--ht-package-header-bg-hover\)[^}]*var\(--ht-package-header-bg-hover\)/,
    );
  });

  test(".sidebar-footer (vNext) uses chip-bg border-top", () => {
    const rule = matchRule(vBlock, ".sidebar-footer");
    expect(rule).toContain("var(--ht-chip-bg)");
  });

  test(".sidebar-server-row (vNext) uses agent-row-bg-hover-card + package-header-bg-hover", () => {
    const rule = matchRule(vBlock, ".sidebar-server-row");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rule).toContain("var(--ht-package-header-bg-hover)");
  });
});

function matchRule(css: string, selector: string): string {
  const re = new RegExp(`(^|\\n)${escape(selector)}\\s*\\{`, "g");
  const m = re.exec(css);
  if (!m) throw new Error(`rule not found: ${selector}`);
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (depth > 0 && i < css.length) {
    const ch = css[i++];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return css.slice(m.index, i);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
