// P7 S29 — Cluster H, surface drag-ghost + drop-overlay region.
//
// The .surface-drag-ghost(-header)(-badge) + .surface-drop-overlay +
// .surface-drop-label + .surface-container.drop-target rules carried
// 19 literals across color-mix() fallbacks, gradient stops, drop
// label chrome, and the drop-target deeper shadow. 7 new --ht-drag-
// ghost-* / --ht-drop-* tokens minted + heavy cross-component reuse
// (8 existing tokens).

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
  "--ht-drag-ghost-bg-top",
  "--ht-drag-ghost-bg-bottom",
  "--ht-drag-ghost-header-mix-bg",
  "--ht-drag-ghost-header-bg-bottom",
  "--ht-drop-overlay-border-white",
  "--ht-drop-label-bg",
  "--ht-drop-target-shadow",
];

describe("theme-token migration — drag-ghost + drop-overlay (P7 S29)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".surface-drag-ghost uses the new gradient + REUSES inline-shadow", () => {
    const ghost = matchRule(indexCss, ".surface-drag-ghost");
    expect(ghost).toContain("var(--ht-drag-ghost-bg-top)");
    expect(ghost).toContain("var(--ht-drag-ghost-bg-bottom)");
    expect(ghost).toContain("var(--ht-panel-inline-shadow)");
    expect(ghost).toContain("var(--ht-pm-secondary-btn-border-hover)");
  });

  test(".surface-drag-ghost-header border + gradient use new + reused tokens", () => {
    const header = matchRule(indexCss, ".surface-drag-ghost-header");
    expect(header).toContain("var(--ht-panel-border-soft)");
    expect(header).toContain("var(--ht-drag-ghost-header-mix-bg)");
    expect(header).toContain("var(--ht-drag-ghost-header-bg-bottom)");
  });

  test(".surface-drag-ghost-badge bg reuses --ht-package-header-bg-hover", () => {
    const badge = matchRule(indexCss, ".surface-drag-ghost-badge");
    expect(badge).toContain("var(--ht-package-header-bg-hover)");
  });

  test(".surface-drop-overlay border + bg use new + reused tokens", () => {
    const overlay = matchRule(indexCss, ".surface-drop-overlay");
    expect(overlay).toContain("var(--ht-drop-overlay-border-white)");
    expect(overlay).toContain("var(--ht-agent-row-bg-hover)");
    expect(overlay).toContain("var(--ht-sidebar-inset-shadow)");
  });

  test(".surface-drop-label bg + shadow use new + reused tokens", () => {
    const label = matchRule(indexCss, ".surface-drop-label");
    expect(label).toContain("var(--ht-drop-label-bg)");
    expect(label).toContain("var(--ht-button-drop-shadow)");
  });

  test(".surface-container.drop-target uses new --ht-drop-target-shadow + reuses --ht-drop-overlay-border-white + --ht-pm-card-border", () => {
    const target = matchRule(indexCss, ".surface-container.drop-target");
    expect(target).toContain("var(--ht-drop-overlay-border-white)");
    expect(target).toContain("var(--ht-pm-card-border)");
    expect(target).toContain("var(--ht-drop-target-shadow)");
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
