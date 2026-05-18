// P7 S37 chunk 1 — Cluster H, vNext UI overrides for palette / prompt
// / search regions. 3 new --ht-vnext-text-* tokens cover the cooler
// zinc tint scale (232,238,248 + 243,246,253) used by the post-Phase-6
// redesign — distinct from the (229,231,237) v1 sidebar family.
//
// New tokens: --ht-vnext-text-mute (0.48), --ht-vnext-text-muted
// (0.58 — also harmonises the 0.56 palette-footer-hint 2pp away),
// --ht-vnext-text-bright (0.88 — also harmonises the 0.9 prompt-btn-
// secondary fg 2pp away). 18 literals migrated total.
//
// Cross-component reuse: --ht-chip-bg (0.05 white for palette item /
// search input bg + category chips + footer-key bg), --ht-panel-
// border-soft (0.08 for key border + prompt-input border + color-
// mix nested), --ht-agent-row-bg-hover-card (0.06 for footer
// border-top), --ht-package-bg (0.02 for footer bg), --ht-agent-row-
// bg-hover (0.04 for prompt-input bg + secondary-btn bg).
//
// These selectors all have a base rule earlier in the file; tests
// scope to the vNext override block (lines ~5700–5950) via a marker.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const tokens = readFileSync(
  join(repo, "src", "shared", "web-theme-tokens.css"),
  "utf8",
);
const indexCss = readFileSync(
  join(repo, "src", "views", "terminal", "index.css"),
  "utf8",
);

const NEW_TOKENS = [
  "--ht-vnext-text-mute",
  "--ht-vnext-text-muted",
  "--ht-vnext-text-bright",
];

// vNext overrides are the third + final occurrence of .palette-
// input-row in the file (just below the theme-card block) and end
// where the t3 override block begins. The S36 tests anchored that
// boundary via lastIndexOf("#titlebar {", t3FinalAlignmentMark) —
// reusing the same anchor here gives us vEnd cleanly.
const T3_FINAL_MARK = "/* Final alignment: exact t3code-style dark shell";
const t3FinalIdx = indexCss.indexOf(T3_FINAL_MARK);
if (t3FinalIdx < 0) throw new Error("t3 final-alignment marker not found");
const vEnd = indexCss.lastIndexOf("#titlebar {", t3FinalIdx);
if (vEnd < 0) throw new Error("t3 #titlebar anchor not found");
const vStart = indexCss.lastIndexOf(".palette-input-row {", vEnd);
if (vStart < 0) throw new Error("vNext block start not found");
const vBlock = indexCss.slice(vStart, vEnd);

describe("theme-token migration — vNext overrides palette/prompt/search (P7 S37 chunk 1)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".palette-item hover (vNext) uses chip-bg + color-mix panel-border-soft", () => {
    expect(vBlock).toMatch(
      /\.palette-item:hover,\s*\n\.palette-item\.selected \{[^}]*var\(--ht-chip-bg\)/,
    );
    expect(vBlock).toMatch(
      /\.palette-item:hover,\s*\n\.palette-item\.selected \{[^}]*var\(--ht-panel-border-soft\)/,
    );
  });

  test(".palette-item-description uses vnext-text-muted", () => {
    const rule = matchRule(vBlock, ".palette-item-description");
    expect(rule).toContain("var(--ht-vnext-text-muted)");
  });

  test(".palette-item-category multi-selector uses chip-bg", () => {
    expect(vBlock).toMatch(
      /\.palette-item-category,\s*\n\.palette-item-recent,\s*\n\.palette-item-shortcut \{[^}]*var\(--ht-chip-bg\)/,
    );
  });

  test(".palette-footer uses agent-row-bg-hover-card + package-bg", () => {
    const rule = matchRule(vBlock, ".palette-footer");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rule).toContain("var(--ht-package-bg)");
  });

  test(".palette-footer-summary uses vnext-text-mute (0.48)", () => {
    const rule = matchRule(vBlock, ".palette-footer-summary");
    expect(rule).toContain("var(--ht-vnext-text-mute)");
  });

  test(".palette-footer-hint reuses vnext-text-muted (0.56 → 0.58 harmonisation)", () => {
    const rule = matchRule(vBlock, ".palette-footer-hint");
    expect(rule).toContain("var(--ht-vnext-text-muted)");
  });

  test(".palette-footer-key uses panel-border-soft + chip-bg + vnext-text-bright", () => {
    const rule = matchRule(vBlock, ".palette-footer-key");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-chip-bg)");
    expect(rule).toContain("var(--ht-vnext-text-bright)");
  });

  test(".prompt-message uses vnext-text-muted", () => {
    const rule = matchRule(vBlock, ".prompt-message");
    expect(rule).toContain("var(--ht-vnext-text-muted)");
  });

  test(".prompt-input uses panel-border-soft + agent-row-bg-hover", () => {
    const rule = matchRule(vBlock, ".prompt-input");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
  });

  test(".prompt-btn-secondary reuses vnext-text-bright (0.9 → 0.88) + agent-row-bg-hover", () => {
    const rule = matchRule(vBlock, ".prompt-btn-secondary");
    expect(rule).toContain("var(--ht-vnext-text-bright)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
  });

  test(".search-bar-input (vNext) uses chip-bg", () => {
    const rule = matchRule(vBlock, ".search-bar-input");
    expect(rule).toContain("var(--ht-chip-bg)");
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
