// P7 S43 chunk 1 — Cluster H, pi-agent slash command menu + confirm
// dialog (overlay + sheet + tree-role colours + dialog buttons +
// dialog inputs).
//
// 6 new --ht-agent-* tokens:
// - slash-menu-bg (0.96 deep black hold)
// - dialog-overlay-bg (rgba(0,0,0,0.6) — between agent-code-bg 0.5
//   and pure black; distinct because the overlay is a dimmer not
//   a fill)
// - dialog-bg (rgba(16,16,22,0.98) — slightly bluer than 0,0,0)
// - badge-extension-bg (indigo 0.12 — unique to extension slash badge)
// - tree-role-assistant-fg (#93c5fd light blue)
// - tree-role-compaction-fg (#f97316 orange)
//
// Reuses: --ht-panel-border-soft (0.08 borders ×5), --ht-agent-code-
// bg (0.5 black for shadows — exact reuse, both deep-black holds),
// --ht-agent-row-bg-hover-card (scrollbar 0.06), --ht-notify-cyan-
// soft (0.1 cyan for slash-item-sel, dialog-option-sel, badge-
// skill — 2pp harmonisation for 0.08), --ht-badge-success-bg (0.08
// green exact for badge-prompt), --ht-sem-success (#4ade80),
// --ht-agent-badge-scope-fg (#818cf8 indigo for extension), --ht-
// agent-row-bg-hover (0.04 dialog-btn bg), --ht-on-accent-fg (#000
// for dialog-btn-primary), --ht-sidebar-filter-selected-shadow
// (0.28 ↔ 0.3 2pp for dialog-input bg).

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
  "--ht-agent-slash-menu-bg",
  "--ht-agent-dialog-overlay-bg",
  "--ht-agent-dialog-bg",
  "--ht-agent-badge-extension-bg",
  "--ht-agent-tree-role-assistant-fg",
  "--ht-agent-tree-role-compaction-fg",
];

describe("theme-token migration — pi-agent slash + dialog (P7 S43 chunk 1)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".agent-slash-menu uses slash-menu-bg + panel-border-soft + agent-code-bg + agent-row-bg-hover-card", () => {
    const rule = matchRule(indexCss, ".agent-slash-menu");
    expect(rule).toContain("var(--ht-agent-slash-menu-bg)");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-agent-code-bg)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
  });

  test(".agent-slash-item-sel reuses notify-cyan-soft (cyan 0.08 → 0.1 2pp)", () => {
    const rule = matchRule(indexCss, ".agent-slash-item-sel");
    expect(rule).toContain("var(--ht-notify-cyan-soft)");
  });

  test("slash-badge-extension uses badge-extension-bg + badge-scope-fg (S41 token)", () => {
    expect(indexCss).toMatch(
      /\.agent-slash-badge-extension \{[^}]*var\(--ht-agent-badge-extension-bg\)[^}]*var\(--ht-agent-badge-scope-fg\)/,
    );
  });

  test("slash-badge-prompt reuses badge-success-bg + sem-success (S33+S42)", () => {
    expect(indexCss).toMatch(
      /\.agent-slash-badge-prompt \{[^}]*var\(--ht-badge-success-bg\)[^}]*var\(--ht-sem-success\)/,
    );
  });

  test("slash-badge-skill reuses notify-cyan-soft + accent-primary", () => {
    expect(indexCss).toMatch(
      /\.agent-slash-badge-skill \{[^}]*var\(--ht-notify-cyan-soft\)[^}]*var\(--accent-primary\)/,
    );
  });

  test(".agent-dialog-overlay uses dialog-overlay-bg", () => {
    const rule = matchRule(indexCss, ".agent-dialog-overlay");
    expect(rule).toContain("var(--ht-agent-dialog-overlay-bg)");
  });

  test(".agent-dialog uses dialog-bg + panel-border-soft + agent-code-bg shadow", () => {
    const rule = matchRule(indexCss, ".agent-dialog");
    expect(rule).toContain("var(--ht-agent-dialog-bg)");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-agent-code-bg)");
  });

  test("tree-role colours use new + reused tokens", () => {
    expect(indexCss).toMatch(
      /\.agent-tree-role-assistant \{[^}]*var\(--ht-agent-tree-role-assistant-fg\)/,
    );
    expect(indexCss).toMatch(
      /\.agent-tree-role-toolResult[^{}]*\{[^}]*var\(--ht-sem-success\)/,
    );
    expect(indexCss).toMatch(
      /\.agent-tree-role-compaction[^{}]*\{[^}]*var\(--ht-agent-tree-role-compaction-fg\)/,
    );
  });

  test(".agent-dialog-option-sel reuses notify-cyan-soft", () => {
    const rule = matchRule(indexCss, ".agent-dialog-option-sel");
    expect(rule).toContain("var(--ht-notify-cyan-soft)");
  });

  test(".agent-dialog-btn rest/primary use panel-border-soft + agent-row-bg-hover + on-accent-fg", () => {
    const rest = matchRule(indexCss, ".agent-dialog-btn");
    expect(rest).toContain("var(--ht-panel-border-soft)");
    expect(rest).toContain("var(--ht-agent-row-bg-hover)");

    const primary = matchRule(indexCss, ".agent-dialog-btn-primary");
    expect(primary).toContain("var(--ht-on-accent-fg)");
  });

  test(".agent-dialog-input/-editor reuse sidebar-filter-selected-shadow (0.3 → 0.28 2pp)", () => {
    const input = matchRule(indexCss, ".agent-dialog-input");
    expect(input).toContain("var(--ht-sidebar-filter-selected-shadow)");
    expect(input).toContain("var(--ht-panel-border-soft)");

    const editor = matchRule(indexCss, ".agent-dialog-editor");
    expect(editor).toContain("var(--ht-sidebar-filter-selected-shadow)");
    expect(editor).toContain("var(--ht-panel-border-soft)");
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
