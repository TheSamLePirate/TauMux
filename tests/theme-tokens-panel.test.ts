// P7 S28 — Cluster H, sideband panel container chrome + a few small
// cross-component reuses.
//
// The .panel rule paints a 4-sided border tetra (brighter top + left;
// darker right + bottom) plus an inline-position variant with deeper
// bg + drop shadow. 5 new --ht-panel-* tokens cover this. Three small
// rules also migrate via REUSE: .workspace-progress bg →
// --ht-agent-row-bg-hover-card (0.06); .palette-item-category border →
// --ht-surface-bar-border (0.92 zinc); .surface-details-overlay scrim
// → --ht-pm-scrim-bg (2% alpha delta — perceptually identical).

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
  "--ht-panel-border-light",
  "--ht-panel-border-soft",
  "--ht-panel-border-dark",
  "--ht-panel-inline-bg",
  "--ht-panel-inline-shadow",
];

describe("theme-token migration — panel + reuses (P7 S28)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".panel border tetra uses the new --ht-panel-border-* tokens", () => {
    const panel = matchRule(indexCss, ".panel");
    expect(panel).toContain("var(--ht-panel-border-light)");
    expect(panel).toContain("var(--ht-panel-border-soft)");
    expect(panel).toContain("var(--ht-panel-border-dark)");
    expect(panel).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.12\)/);
    expect(panel).not.toMatch(/rgba\(39,\s*39,\s*42,\s*0\.96\)/);
  });

  test(".panel-position-inline bg + shadow use the new tokens", () => {
    const inline = matchRule(indexCss, ".panel-position-inline");
    expect(inline).toContain("var(--ht-panel-inline-bg)");
    expect(inline).toContain("var(--ht-panel-inline-shadow)");
  });

  test(".workspace-progress bg reuses --ht-agent-row-bg-hover-card", () => {
    const prog = matchRule(indexCss, ".workspace-progress");
    expect(prog).toContain("var(--ht-agent-row-bg-hover-card)");
  });

  test(".palette-item-category border reuses --ht-surface-bar-border (multi-selector rule)", () => {
    // The rule starts with `.palette-item-category, .palette-item-recent, .palette-item-shortcut`.
    expect(indexCss).toMatch(
      /\.palette-item-shortcut\s*\{[^}]*border:\s*0\.5px solid var\(--ht-surface-bar-border\)/,
    );
  });

  test(".surface-details-overlay scrim reuses --ht-pm-scrim-bg", () => {
    const overlay = matchRule(indexCss, ".surface-details-overlay");
    expect(overlay).toContain("var(--ht-pm-scrim-bg)");
    expect(overlay).not.toMatch(/rgba\(5,\s*5,\s*8/);
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
