// P7 S24 — Cluster H continuation, surface-details overlay region.
//
// The surface-details overlay is a sister of the process-manager
// overlay (the cmd+option+P sheet) — same denser "system inspector"
// visual identity, same chrome alphas, same danger button family.
// This migration REUSES the S18 --ht-pm-* + --ht-badge-* + S20
// --ht-sem-* tokens directly, and adds 4 new --ht-pm-secondary-btn-*
// tokens for the neutral inline-action buttons that the PM overlay
// doesn't currently use. ~25 literals migrated, only 4 new tokens
// minted — the biggest cross-component reuse landing yet.

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
  "--ht-pm-secondary-btn-bg",
  "--ht-pm-secondary-btn-border",
  "--ht-pm-secondary-btn-bg-hover",
  "--ht-pm-secondary-btn-border-hover",
];

describe("theme-token migration — surface-details overlay (P7 S24)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("surface-details panel chrome REUSES the PM panel tokens", () => {
    const panel = matchRule(indexCss, ".surface-details-panel");
    expect(panel).toContain("var(--ht-pm-panel-bg)");
    expect(panel).toContain("var(--ht-pm-panel-border)");
    expect(panel).toContain("var(--ht-pm-panel-shadow)");
    expect(panel).not.toMatch(/rgba\(10,\s*10,\s*14,\s*0\.98\)/);

    const header = matchRule(indexCss, ".surface-details-header");
    expect(header).toContain("var(--ht-pm-panel-border)");

    const closeHover = matchRule(indexCss, ".surface-details-close:hover");
    expect(closeHover).toContain("var(--ht-pm-close-border-hover)");
  });

  test("surface-details section divider + table reuses PM tokens", () => {
    const section = matchRule(indexCss, ".surface-details-section");
    expect(section).toContain("var(--ht-pm-card-divider)");

    // Multi-selector header + td rule.
    expect(indexCss).toMatch(
      /\.surface-details-table th,\s*\n\s*\.surface-details-table td\s*\{[^}]*border-bottom:\s*0\.5px solid var\(--ht-pm-table-row-divider\)/,
    );
    const th = matchRule(indexCss, ".surface-details-table th");
    expect(th).toContain("var(--ht-pm-table-header-bg)");

    const fgRow = matchRule(
      indexCss,
      ".surface-details-table tr.foreground td",
    );
    expect(fgRow).toContain("var(--ht-pm-table-fg-row-bg)");
  });

  test("port green + CPU heatmap reuse cross-component sem tokens", () => {
    const port = matchRule(indexCss, ".surface-details-port");
    expect(port).toContain("var(--ht-badge-success-fg)");
    expect(port).not.toContain("#86efac");

    const cpu = matchRule(indexCss, ".surface-details-cpu");
    expect(cpu).toContain("var(--ht-sem-error)");
    expect(cpu).not.toContain("#f87171");
  });

  test("secondary btn uses the new neutral tokens; danger reuses the PM kill family", () => {
    const btn = matchRule(indexCss, ".surface-details-btn");
    expect(btn).toContain("var(--ht-pm-secondary-btn-bg)");
    expect(btn).toContain("var(--ht-pm-secondary-btn-border)");

    const btnHover = matchRule(indexCss, ".surface-details-btn:hover");
    expect(btnHover).toContain("var(--ht-pm-secondary-btn-bg-hover)");
    expect(btnHover).toContain("var(--ht-pm-secondary-btn-border-hover)");

    const danger = matchRule(indexCss, ".surface-details-btn.danger");
    expect(danger).toContain("var(--ht-pm-kill-fg)");
    expect(danger).toContain("var(--ht-pm-kill-bg)");
    expect(danger).toContain("var(--ht-pm-kill-border)");

    const dangerHover = matchRule(
      indexCss,
      ".surface-details-btn.danger:hover",
    );
    expect(dangerHover).toContain("var(--ht-pm-kill-bg-hover)");
    expect(dangerHover).toContain("var(--ht-pm-kill-fg-hover)");
    expect(dangerHover).toContain("var(--ht-pm-kill-border-hover)");
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
