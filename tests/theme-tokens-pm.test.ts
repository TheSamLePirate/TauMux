// P7 S18 — Cluster H continuation, process manager (⌘⌥P) region.
//
// The .process-manager-* rules carried ~14 white-on-dark chrome
// literals (overlay scrim, panel bg/border/shadow, close hover,
// workspace cards, header dividers, table row stripes, foreground-row
// highlight) plus the kill button's 6 soft-red literals. Migrated to
// new --ht-pm-* token groups (15 chrome + 6 kill) so a future palette
// swap can repaint the PM overlay in one place. Semantic badges
// (port=green, git=amber/cyan/red) stay on the per-clause path for a
// future targeted session.

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

const CHROME_TOKENS = [
  "--ht-pm-scrim-bg",
  "--ht-pm-panel-bg",
  "--ht-pm-panel-border",
  "--ht-pm-panel-shadow",
  "--ht-pm-close-border-hover",
  "--ht-pm-card-bg",
  "--ht-pm-card-border",
  "--ht-pm-card-border-active",
  "--ht-pm-card-header-bg",
  "--ht-pm-card-divider",
  "--ht-pm-surface-divider",
  "--ht-pm-surface-hover-bg",
  "--ht-pm-table-row-divider",
  "--ht-pm-table-header-bg",
  "--ht-pm-table-fg-row-bg",
];

const KILL_TOKENS = [
  "--ht-pm-kill-fg",
  "--ht-pm-kill-bg",
  "--ht-pm-kill-border",
  "--ht-pm-kill-fg-hover",
  "--ht-pm-kill-bg-hover",
  "--ht-pm-kill-border-hover",
];

describe("theme-token migration — process manager chrome (P7 S18)", () => {
  for (const name of [...CHROME_TOKENS, ...KILL_TOKENS]) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("overlay + panel + header use the new tokens", () => {
    const overlay = matchRule(indexCss, ".process-manager-overlay");
    expect(overlay).toContain("var(--ht-pm-scrim-bg)");
    expect(overlay).not.toMatch(/rgba\(5,\s*5,\s*8,\s*0\.7\)/);

    const panel = matchRule(indexCss, ".process-manager-panel");
    expect(panel).toContain("var(--ht-pm-panel-bg)");
    expect(panel).toContain("var(--ht-pm-panel-border)");
    expect(panel).toContain("var(--ht-pm-panel-shadow)");

    const header = matchRule(indexCss, ".process-manager-header");
    expect(header).toContain("var(--ht-pm-panel-border)");
  });

  test("workspace cards + active + header dividers use the new tokens", () => {
    const ws = matchRule(indexCss, ".process-manager-workspace");
    expect(ws).toContain("var(--ht-pm-card-bg)");
    expect(ws).toContain("var(--ht-pm-card-border)");

    const wsActive = matchRule(indexCss, ".process-manager-workspace.active");
    expect(wsActive).toContain("var(--ht-pm-card-border-active)");

    const wsHeader = matchRule(indexCss, ".process-manager-workspace-header");
    expect(wsHeader).toContain("var(--ht-pm-card-header-bg)");
    expect(wsHeader).toContain("var(--ht-pm-card-divider)");
  });

  test("surface + table rules use the new tokens", () => {
    const surface = matchRule(indexCss, ".process-manager-surface");
    expect(surface).toContain("var(--ht-pm-surface-divider)");

    const surfaceHover = matchRule(
      indexCss,
      ".process-manager-surface-header:hover",
    );
    expect(surfaceHover).toContain("var(--ht-pm-surface-hover-bg)");

    // Table row dividers + header bg appear in shared selectors; the
    // first `.process-manager-table th { … }` rule is captured.
    const tableHeader = matchRule(indexCss, ".process-manager-table th");
    expect(tableHeader).toContain("var(--ht-pm-table-header-bg)");

    // Foreground row highlight.
    const fgRow = matchRule(
      indexCss,
      ".process-manager-table tr.foreground td",
    );
    expect(fgRow).toContain("var(--ht-pm-table-fg-row-bg)");
  });

  test("kill button + hover use the soft-red token family", () => {
    const kill = matchRule(indexCss, ".process-manager-kill-btn");
    expect(kill).toContain("var(--ht-pm-kill-fg)");
    expect(kill).toContain("var(--ht-pm-kill-bg)");
    expect(kill).toContain("var(--ht-pm-kill-border)");
    expect(kill).not.toContain("#fca5a5");
    expect(kill).not.toMatch(/rgba\(248,\s*113,\s*113,\s*0\.08\)/);

    const killHover = matchRule(indexCss, ".process-manager-kill-btn:hover");
    expect(killHover).toContain("var(--ht-pm-kill-bg-hover)");
    expect(killHover).toContain("var(--ht-pm-kill-fg-hover)");
    expect(killHover).toContain("var(--ht-pm-kill-border-hover)");
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
