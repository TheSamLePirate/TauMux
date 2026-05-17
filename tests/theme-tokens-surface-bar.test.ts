// P7 S25 — Cluster H continuation, surface bar (pane header) region.
//
// The .surface-bar rule carried 7 literals across the bar bg, border,
// focused glow strip + inset highlight, btn fg, close hover red.
// 4 new --ht-surface-bar-* tokens minted + 3 reuses (info-border-soft
// for the focused border, agent-row-bg-hover for the inset highlight,
// --ht-sem-error for the close-hover red).

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
  "--ht-surface-bar-bg",
  "--ht-surface-bar-border",
  "--ht-surface-bar-focused-glow",
  "--ht-surface-bar-btn-fg",
];

describe("theme-token migration — surface bar (P7 S25)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".surface-bar resting uses the new chrome tokens", () => {
    const bar = matchRule(indexCss, ".surface-bar");
    expect(bar).toContain("var(--ht-surface-bar-bg)");
    expect(bar).toContain("var(--ht-surface-bar-border)");
    expect(bar).not.toMatch(/rgba\(9,\s*9,\s*11,\s*0\.92\)/);
  });

  test(".surface-container.focused .surface-bar reuses badge-info + agent-row tokens", () => {
    const focused = matchRule(
      indexCss,
      ".surface-container.focused .surface-bar",
    );
    expect(focused).toContain("var(--ht-badge-info-border-soft)");
    expect(focused).toContain("var(--ht-agent-row-bg-hover)");
    expect(focused).toContain("var(--ht-surface-bar-focused-glow)");
  });

  test("surface-bar buttons use the new fg + close-hover reuses --ht-sem-error", () => {
    const btn = matchRule(indexCss, ".surface-bar-btn");
    expect(btn).toContain("var(--ht-surface-bar-btn-fg)");
    expect(btn).not.toMatch(/rgba\(244,\s*244,\s*245,\s*0\.44\)/);

    const closeHover = matchRule(indexCss, ".surface-bar-close:hover");
    expect(closeHover).toContain("var(--ht-sem-error)");
    expect(closeHover).not.toContain("#f87171");
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
