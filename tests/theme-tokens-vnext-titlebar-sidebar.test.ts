// P7 S40 chunk 1 — Cluster H, vNext titlebar + sidebar header
// overrides (the 2026-refresh chrome at the top of the vNext block,
// lines ~4960–5104).
//
// 1 new --ht-vnext-sidebar-bg token: rgba(22, 25, 33, 0.78). The
// vNext sidebar is intentionally translucent (0.78 alpha) so the
// desktop bloom can bleed through — a deliberate departure from
// the S36 --ht-window-sidebar-bg's 0.98 opaque hold, hence its
// own slot.
//
// Heavy cross-component reuse (~22 sites): --ht-vnext-text-section-
// h (titlebar-caption), --ht-vnext-text-soft-2 (titlebar-info), --ht-
// vnext-text-elevated (toolbar-icon-btn rest), --ht-sidebar-text-
// strong (icon-btn hover + sidebar-title + sidebar-new-btn hover),
// --ht-vnext-text-mid (sidebar-subtitle), --ht-sidebar-filter-btn-
// hover-fg (sidebar-new-btn rest 0.82 exact), plus white-alpha
// reuses for borders / bgs / insets / color-mix nested literals.

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

const NEW_TOKENS = ["--ht-vnext-sidebar-bg"];

// Scope to the 2026-refresh vNext block (2nd to 3rd line-start
// #titlebar { occurrence — same anchor pattern as S39).
const titlebarMatches: number[] = [];
let off = 0;
while (off < indexCss.length) {
  const i = indexCss.indexOf("\n#titlebar {", off);
  if (i < 0) break;
  titlebarMatches.push(i + 1);
  off = i + 1;
}
if (titlebarMatches.length < 3) {
  throw new Error("expected ≥3 line-start #titlebar { rules");
}
const vBlock = indexCss.slice(titlebarMatches[1], titlebarMatches[2]);

describe("theme-token migration — vNext titlebar/sidebar header (P7 S40 chunk 1)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("#titlebar-caption uses vnext-text-section-h", () => {
    const rule = matchRule(vBlock, "#titlebar-caption");
    expect(rule).toContain("var(--ht-vnext-text-section-h)");
  });

  test(".titlebar-info uses agent-row-bg-hover-card + agent-row-bg-hover + vnext-text-soft-2", () => {
    const rule = matchRule(vBlock, ".titlebar-info");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
    expect(rule).toContain("var(--ht-vnext-text-soft-2)");
  });

  test(".titlebar-info-primary color-mix uses panel-border-soft + package-header-bg-hover", () => {
    const rule = matchRule(vBlock, ".titlebar-info-primary");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-package-header-bg-hover)");
  });

  test("#titlebar .toolbar-icon-strip uses agent-row-bg-hover-card + agent-row-bg-hover + package-header-bg-hover", () => {
    const rule = matchRule(vBlock, "#titlebar .toolbar-icon-strip");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
    expect(rule).toContain("var(--ht-package-header-bg-hover)");
  });

  test("#titlebar .toolbar-icon-btn uses vnext-text-elevated (0.62 → 0.64 2pp)", () => {
    const rule = matchRule(vBlock, "#titlebar .toolbar-icon-btn");
    expect(rule).toContain("var(--ht-vnext-text-elevated)");
  });

  test("toolbar-icon-btn :hover/.active uses sidebar-text-strong + package-bg color-mix", () => {
    expect(vBlock).toMatch(
      /#titlebar \.toolbar-icon-btn:hover,\s*\n#titlebar \.toolbar-icon-btn\.active \{[^}]*var\(--ht-sidebar-text-strong\)[^}]*var\(--ht-package-bg\)/,
    );
  });

  test("#sidebar uses vnext-sidebar-bg + agent-row-bg-hover-card + package-bg", () => {
    const rule = matchRule(vBlock, "#sidebar");
    expect(rule).toContain("var(--ht-vnext-sidebar-bg)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rule).toContain("var(--ht-package-bg)");
    expect(rule).not.toMatch(/rgba\(22,\s*25,\s*33,\s*0\.78\)/);
  });

  test(".sidebar-title uses sidebar-text-strong", () => {
    const rule = matchRule(vBlock, ".sidebar-title");
    expect(rule).toContain("var(--ht-sidebar-text-strong)");
  });

  test(".sidebar-subtitle uses vnext-text-mid", () => {
    const rule = matchRule(vBlock, ".sidebar-subtitle");
    expect(rule).toContain("var(--ht-vnext-text-mid)");
  });

  test(".sidebar-new-btn rest uses sidebar-filter-btn-hover-fg + chip-bg + agent-row-bg-hover-card + package-header-bg-hover", () => {
    const rule = matchRule(vBlock, ".sidebar-new-btn");
    expect(rule).toContain("var(--ht-sidebar-filter-btn-hover-fg)");
    expect(rule).toContain("var(--ht-chip-bg)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rule).toContain("var(--ht-package-header-bg-hover)");
  });

  test(".sidebar-new-btn:hover uses sidebar-text-strong + agent-row-bg-hover color-mix", () => {
    const rule = matchRule(vBlock, ".sidebar-new-btn:hover");
    expect(rule).toContain("var(--ht-sidebar-text-strong)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
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
