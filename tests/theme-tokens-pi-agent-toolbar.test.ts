// P7 S41 chunk 2 — Cluster H, pi-agent toolbar + meta badges + stats
// + model-scope. The agent panel has its own deep-black gradient
// backdrop plus three accent palettes (cyan model, amber thinking,
// purple scope) overlaying the chrome.
//
// 8 new --ht-agent-* tokens:
// - body-bg-top / -bottom (0.95 / 0.98 black-hold gradient stops)
// - dot-glow (cyan 0.4 — model dot drop-shadow)
// - tb-model-hover-border (cyan 0.3)
// - tb-thinking-hover-border (amber 0.3)
// - badge-scope-fg (#818cf8 purple, reused for scope-on)
// - stats-bg (rgba(0,0,0,0.2) — denser hold than other panels)
// - model-scope-fg (rgba(255,255,255,0.25) — dim glyph rest)
//
// Reuses: --ht-agent-row-bg-hover[-card], --ht-package-bg,
// --ht-sidebar-row-bg-stripe, --ht-sidebar-filter-selected-bg-top,
// --ht-package-header-bg-hover, --ht-pm-card-bg (0.015 exact),
// --ht-palette-divider-soft (cyan 0.14 → 0.12 2pp), --ht-palette-
// divider (cyan 0.18 exact), --ht-notify-amber-soft (0.1 → 0.12
// 2pp), --ht-sem-success (#4ade80 exact), --text-muted,
// --text-strong, --text-dim, --accent-primary.

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
  "--ht-agent-body-bg-top",
  "--ht-agent-body-bg-bottom",
  "--ht-agent-dot-glow",
  "--ht-agent-tb-model-hover-border",
  "--ht-agent-tb-thinking-hover-border",
  "--ht-agent-badge-scope-fg",
  "--ht-agent-stats-bg",
  "--ht-agent-model-scope-fg",
];

describe("theme-token migration — pi-agent toolbar/badges/stats (P7 S41 chunk 2)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".agent-body uses body-bg-top + body-bg-bottom in gradient", () => {
    const rule = matchRule(indexCss, ".agent-body");
    expect(rule).toContain("var(--ht-agent-body-bg-top)");
    expect(rule).toContain("var(--ht-agent-body-bg-bottom)");
    expect(rule).not.toContain("rgba(10,10,14,0.95)");
  });

  test(".agent-toolbar uses agent-row-bg-hover + sidebar-row-bg-stripe", () => {
    const rule = matchRule(indexCss, ".agent-toolbar");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
    expect(rule).toContain("var(--ht-sidebar-row-bg-stripe)");
  });

  test(".agent-tb-btn rest + hover use the white-alpha vocabulary", () => {
    const rest = matchRule(indexCss, ".agent-tb-btn");
    expect(rest).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rest).toContain("var(--ht-package-bg)");

    const hover = matchRule(indexCss, ".agent-tb-btn:hover");
    expect(hover).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(hover).toContain("var(--ht-sidebar-filter-selected-bg-top)");
  });

  test(".agent-tb-dot-model reuses agent-dot-glow", () => {
    const rule = matchRule(indexCss, ".agent-tb-dot-model");
    expect(rule).toContain("var(--ht-agent-dot-glow)");
    expect(rule).not.toContain("rgba(111, 233, 255,0.4)");
  });

  test(".agent-tb-model rest reuses palette-divider-soft (0.12 → 0.14 2pp)", () => {
    const rest = matchRule(indexCss, ".agent-tb-model");
    expect(rest).toContain("var(--ht-palette-divider-soft)");

    const hover = matchRule(indexCss, ".agent-tb-model:hover");
    expect(hover).toContain("var(--ht-agent-tb-model-hover-border)");
  });

  test(".agent-tb-thinking rest reuses notify-amber-soft (0.12 → 0.1 2pp)", () => {
    const rest = matchRule(indexCss, ".agent-tb-thinking");
    expect(rest).toContain("var(--ht-notify-amber-soft)");

    const hover = matchRule(indexCss, ".agent-tb-thinking:hover");
    expect(hover).toContain("var(--ht-agent-tb-thinking-hover-border)");
  });

  test(".agent-model-meta uses package-header-bg-hover + pm-card-bg", () => {
    const rule = matchRule(indexCss, ".agent-model-meta");
    expect(rule).toContain("var(--ht-package-header-bg-hover)");
    expect(rule).toContain("var(--ht-pm-card-bg)");
  });

  test(".agent-model-badge uses panel-border-soft + sidebar-row-bg-stripe", () => {
    const rule = matchRule(indexCss, ".agent-model-badge");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-sidebar-row-bg-stripe)");
  });

  test(".agent-model-badge-provider reuses palette-divider (0.18 exact)", () => {
    const rule = matchRule(indexCss, ".agent-model-badge-provider");
    expect(rule).toContain("var(--ht-palette-divider)");
  });

  test(".agent-model-badge-cost reuses sem-success (#4ade80 exact)", () => {
    const rule = matchRule(indexCss, ".agent-model-badge-cost");
    expect(rule).toContain("var(--ht-sem-success)");
    expect(rule).not.toContain("#4ade80");
  });

  test(".agent-model-badge-scope + .agent-model-scope-on share badge-scope-fg", () => {
    const badge = matchRule(indexCss, ".agent-model-badge-scope");
    expect(badge).toContain("var(--ht-agent-badge-scope-fg)");

    const scopeOn = matchRule(indexCss, ".agent-model-scope-on");
    expect(scopeOn).toContain("var(--ht-agent-badge-scope-fg)");
  });

  test(".agent-stats uses package-header-bg-hover + stats-bg", () => {
    const rule = matchRule(indexCss, ".agent-stats");
    expect(rule).toContain("var(--ht-package-header-bg-hover)");
    expect(rule).toContain("var(--ht-agent-stats-bg)");
  });

  test(".agent-model-scope rest uses model-scope-fg", () => {
    const rule = matchRule(indexCss, ".agent-model-scope");
    expect(rule).toContain("var(--ht-agent-model-scope-fg)");
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
