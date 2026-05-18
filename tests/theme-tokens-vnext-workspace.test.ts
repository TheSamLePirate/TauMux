// P7 S40 chunk 2 — Cluster H, vNext workspace-item card + its sub-
// chrome (name, port/cwd chips, meta-fg, package container).
//
// 3 new --ht-vnext-* tokens:
// - workspace-shadow (0.18 black) — rest depth.
// - workspace-shadow-active (0.22 black) — active depth, deliberate
//   alpha separation so the active card lifts off without changing
//   chrominance.
// - text-name (rgba(232,238,248,0.82)) — kept in its own slot
//   instead of reusing --ht-sidebar-filter-btn-hover-fg because the
//   vNext family deliberately uses a cooler/bluer zinc tint (232/
//   238/248 vs 229/231/237); a future vNext-tint swap repaints
//   workspace names correctly.
//
// ~22 reuses across borders / bgs / insets / color-mix nested
// literals — sidebar-filter-selected-bg-top (hover border 0.1),
// chip-bg, agent-row-bg-hover[-card], package-header-bg-hover,
// panel-border-soft, button-bg, button-bg-hover-fallback (chip
// border 0.07), vnext-text-soft-2 (cwd-chip rest), sidebar-text-
// strong (cwd-chip.active).

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
  "--ht-vnext-workspace-shadow",
  "--ht-vnext-workspace-shadow-active",
  "--ht-vnext-text-name",
];

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

describe("theme-token migration — vNext workspace-item card (P7 S40 chunk 2)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".workspace-item uses agent-row-bg-hover-card + package-header-bg-hover + agent-row-bg-hover + workspace-shadow", () => {
    // First `.workspace-item {` in the block is a multi-selector
    // width-only rule; assert the second one's body via regex.
    expect(vBlock).toMatch(
      /\n\.workspace-item \{[^}]*var\(--ht-agent-row-bg-hover-card\)[^}]*var\(--ht-package-header-bg-hover\)[^}]*var\(--ht-agent-row-bg-hover\)[^}]*var\(--ht-vnext-workspace-shadow\)/,
    );
  });

  test(".workspace-item:hover uses filter-selected-bg-top + chip-bg", () => {
    const rule = matchRule(vBlock, ".workspace-item:hover");
    expect(rule).toContain("var(--ht-sidebar-filter-selected-bg-top)");
    expect(rule).toContain("var(--ht-chip-bg)");
  });

  test(".workspace-item.active uses panel-border-soft + agent-row-bg-hover-card + button-bg + chip-bg + workspace-shadow-active", () => {
    const rule = matchRule(vBlock, ".workspace-item.active");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rule).toContain("var(--ht-button-bg)");
    expect(rule).toContain("var(--ht-chip-bg)");
    expect(rule).toContain("var(--ht-vnext-workspace-shadow-active)");
  });

  test(".workspace-name uses vnext-text-name", () => {
    const rule = matchRule(vBlock, ".workspace-name");
    expect(rule).toContain("var(--ht-vnext-text-name)");
    expect(rule).not.toMatch(/rgba\(232,\s*238,\s*248,\s*0\.82\)/);
  });

  test("port/cwd chip multi-selector uses button-bg-hover-fallback + chip-bg", () => {
    expect(vBlock).toMatch(
      /\.workspace-port-chip,\s*\n\.workspace-cwd-chip \{[^}]*var\(--ht-button-bg-hover-fallback\)[^}]*var\(--ht-chip-bg\)/,
    );
  });

  test(".workspace-meta-fg multi-selector color-mix uses package-header-bg-hover + agent-row-bg-hover-card", () => {
    expect(vBlock).toMatch(
      /\.workspace-meta-fg,\s*\n\.surface-chip\.chip-command \{[^}]*var\(--ht-package-header-bg-hover\)[^}]*var\(--ht-agent-row-bg-hover-card\)/,
    );
  });

  test(".workspace-cwd-chip standalone uses vnext-text-soft-2", () => {
    // .workspace-cwd-chip { has two rules — the multi-selector
    // (with comma) at the port-chip block and the standalone one
    // below. Assert the standalone rule's body via regex.
    expect(vBlock).toMatch(
      /\n\.workspace-cwd-chip \{[^}]*var\(--ht-vnext-text-soft-2\)/,
    );
  });

  test(".workspace-cwd-chip.active uses sidebar-text-strong + chip-bg", () => {
    const rule = matchRule(vBlock, ".workspace-cwd-chip.active");
    expect(rule).toContain("var(--ht-sidebar-text-strong)");
    expect(rule).toContain("var(--ht-chip-bg)");
  });

  test(".workspace-package uses agent-row-bg-hover-card + package-header-bg-hover", () => {
    const rule = matchRule(vBlock, ".workspace-package");
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
