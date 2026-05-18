// P7 S32 — Cluster H, sidebar search input + filter segment + inline
// divider region.
//
// 4 new --ht-sidebar-* tokens cover the search input fg (0.92 near-
// white, a touch above the sidebar section header brightness) + the
// filter button hover fg (0.82) + the selected segment's gradient top
// stop (0.1 white) + the selected segment's black drop-shadow (0.28).
// Cross-component reuse: --ht-chip-bg for search bg, --ht-panel-border-
// soft for the search border, --ht-agent-row-bg-hover for the search
// inset + segment bg, --ht-button-bg-hover-fallback for the search
// focus bg, --ht-sidebar-text-mute for the search icon, --ht-sidebar-
// text-dim for the placeholder + divider fg, --ht-pm-card-border for
// the segment border, --ht-package-header-bg-hover for the segment
// inset, --ht-sidebar-section-count-fg for the filter btn rest fg,
// --ht-button-fg-hover for the selected fg, --ht-panel-border-soft for
// the gradient bottom stop + selected outer ring, --ht-panel-border-
// light for the selected inset.

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
  "--ht-sidebar-search-input-fg",
  "--ht-sidebar-filter-btn-hover-fg",
  "--ht-sidebar-filter-selected-bg-top",
  "--ht-sidebar-filter-selected-shadow",
];

describe("theme-token migration — sidebar search + filter segment (P7 S32)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".sidebar-search uses chip-bg + panel-border-soft + agent-row-bg-hover", () => {
    const rule = matchRule(indexCss, ".sidebar-search");
    expect(rule).toContain("var(--ht-chip-bg)");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
    expect(rule).not.toContain("rgba(255, 255, 255, 0.05)");
  });

  test(".sidebar-search:focus-within uses button-bg-hover-fallback", () => {
    const rule = matchRule(indexCss, ".sidebar-search:focus-within");
    expect(rule).toContain("var(--ht-button-bg-hover-fallback)");
  });

  test(".sidebar-search-icon uses sidebar-text-mute", () => {
    const rule = matchRule(indexCss, ".sidebar-search-icon");
    expect(rule).toContain("var(--ht-sidebar-text-mute)");
  });

  test(".sidebar-search-input uses search-input-fg", () => {
    const rule = matchRule(indexCss, ".sidebar-search-input");
    expect(rule).toContain("var(--ht-sidebar-search-input-fg)");
  });

  test(".sidebar-search-input::placeholder uses sidebar-text-dim", () => {
    const rule = matchRule(indexCss, ".sidebar-search-input::placeholder");
    expect(rule).toContain("var(--ht-sidebar-text-dim)");
  });

  test(".sidebar-filter-segment uses agent-row-bg-hover + pm-card-border + package-header-bg-hover", () => {
    const rule = matchRule(indexCss, ".sidebar-filter-segment");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
    expect(rule).toContain("var(--ht-pm-card-border)");
    expect(rule).toContain("var(--ht-package-header-bg-hover)");
  });

  test(".sidebar-filter-btn uses sidebar-section-count-fg", () => {
    const rule = matchRule(indexCss, ".sidebar-filter-btn");
    expect(rule).toContain("var(--ht-sidebar-section-count-fg)");
  });

  test(".sidebar-filter-btn:hover uses filter-btn-hover-fg", () => {
    const rule = matchRule(indexCss, ".sidebar-filter-btn:hover");
    expect(rule).toContain("var(--ht-sidebar-filter-btn-hover-fg)");
  });

  test('.sidebar-filter-btn[aria-selected="true"] uses all selected tokens', () => {
    const rule = matchRule(
      indexCss,
      '.sidebar-filter-btn[aria-selected="true"]',
    );
    expect(rule).toContain("var(--ht-button-fg-hover)");
    expect(rule).toContain("var(--ht-sidebar-filter-selected-bg-top)");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-panel-border-light)");
    expect(rule).toContain("var(--ht-sidebar-filter-selected-shadow)");
  });

  test(".sidebar-inline-divider + ::after use sidebar-text-dim + panel-border-soft", () => {
    const rule = matchRule(indexCss, ".sidebar-inline-divider");
    expect(rule).toContain("var(--ht-sidebar-text-dim)");

    const after = matchRule(indexCss, ".sidebar-inline-divider::after");
    expect(after).toContain("var(--ht-panel-border-soft)");
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
