// P7 S32 chunk 2 — Cluster H, workspace card sub-rows: grip, pin,
// metrics, section header / caret / count.
//
// 4 new --ht-workspace-* tokens cover the grip rest fg (0.26 — the
// dimmest icon in the card, only visible on hover), pin hover fg
// (0.86 — sits between filter-btn-hover and section-text-hover),
// mem metric fg (0.62 — softer than CPU which uses success badge fg),
// and the section header rest fg (0.54 — fractionally below sidebar-
// section-text, a denser-card tier).
//
// Cross-component reuse: --ht-sidebar-section-count-fg (grip active,
// 0.56 exact), --ht-sidebar-text-dim (pin rest + section-count fg),
// --ht-agent-row-bg-hover-card (pin hover bg), --ht-agent-row-bg-
// hover (metrics bg + section-header hover bg), --ht-button-bg
// (metrics border 0.055 exact), --ht-sidebar-filter-btn-hover-fg
// (metrics fg 0.82 + section-caret hover), --ht-badge-success-fg
// (CPU metric green #86efac exact), --ht-panel-border-soft (mem
// divider), --ht-sidebar-section-text-hover (section-header hover
// fg 0.9 exact), --ht-sidebar-text-mute (section-caret rest 0.48,
// 3pp delta), --ht-sidebar-row-border (section-count bg 0.045 exact).

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
  "--ht-workspace-grip-fg",
  "--ht-workspace-pin-hover-fg",
  "--ht-workspace-metric-mem-fg",
  "--ht-workspace-section-header-fg",
];

describe("theme-token migration — workspace card sub-rows (P7 S32 chunk 2)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".workspace-grip uses grip-fg + active reuses sidebar-section-count-fg", () => {
    const rest = matchRule(indexCss, ".workspace-grip");
    expect(rest).toContain("var(--ht-workspace-grip-fg)");

    const active = matchRule(indexCss, ".workspace-grip:active");
    expect(active).toContain("var(--ht-sidebar-section-count-fg)");
  });

  test(".workspace-pin uses sidebar-text-dim + hover state tokens", () => {
    const rest = matchRule(indexCss, ".workspace-pin");
    expect(rest).toContain("var(--ht-sidebar-text-dim)");

    const hover = matchRule(indexCss, ".workspace-pin:hover");
    expect(hover).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(hover).toContain("var(--ht-workspace-pin-hover-fg)");
  });

  test(".workspace-metrics reuses agent-row-bg-hover + button-bg + filter-btn-hover-fg", () => {
    const rule = matchRule(indexCss, ".workspace-metrics");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
    expect(rule).toContain("var(--ht-button-bg)");
    expect(rule).toContain("var(--ht-sidebar-filter-btn-hover-fg)");
  });

  test(".workspace-metric-cpu reuses badge-success-fg (no #86efac literal)", () => {
    const rule = matchRule(indexCss, ".workspace-metric-cpu");
    expect(rule).toContain("var(--ht-badge-success-fg)");
    expect(rule).not.toContain("#86efac");
  });

  test(".workspace-metric-mem uses mem-fg + panel-border-soft divider", () => {
    const rule = matchRule(indexCss, ".workspace-metric-mem");
    expect(rule).toContain("var(--ht-workspace-metric-mem-fg)");
    expect(rule).toContain("var(--ht-panel-border-soft)");
  });

  test(".workspace-section-header uses header-fg + hover state tokens", () => {
    const rest = matchRule(indexCss, ".workspace-section-header");
    expect(rest).toContain("var(--ht-workspace-section-header-fg)");

    const hover = matchRule(indexCss, ".workspace-section-header:hover");
    expect(hover).toContain("var(--ht-agent-row-bg-hover)");
    expect(hover).toContain("var(--ht-sidebar-section-text-hover)");
  });

  test(".workspace-section-caret + hover use sidebar-text-mute + filter-btn-hover-fg", () => {
    const rest = matchRule(indexCss, ".workspace-section-caret");
    expect(rest).toContain("var(--ht-sidebar-text-mute)");

    const hover = matchRule(
      indexCss,
      ".workspace-section-header:hover .workspace-section-caret",
    );
    expect(hover).toContain("var(--ht-sidebar-filter-btn-hover-fg)");
  });

  test(".workspace-section-count reuses sidebar-text-dim + sidebar-row-border", () => {
    const rule = matchRule(indexCss, ".workspace-section-count");
    expect(rule).toContain("var(--ht-sidebar-text-dim)");
    expect(rule).toContain("var(--ht-sidebar-row-border)");
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
