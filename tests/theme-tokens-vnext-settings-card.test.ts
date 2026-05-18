// P7 S39 chunk 2 — Cluster H, vNext settings panel chrome +
// theme-card + sheet shell (the bulk of the panel-style overrides
// between pane-divider and the theme-card.active rule).
//
// 7 new --ht-vnext-* tokens:
// - text-mid (0.52, also harmonises 0.54 section-desc 2pp away)
// - text-elevated (0.64) — between text-soft-2 0.68 and muted 0.58
// - settings-body-bg (0.01 white, faintest tier)
// - settings-range-thumb-border (rgba(22,25,33,0.9))
// - segment-active-fg (#10141a — text on accent fills)
// - sheet-bg (rgba(24,28,36,0.92))
// - modal-overlay-bg (rgba(7,10,14,0.4))
//
// ~22 reuses across pane-divider, sheet shell, panel headers,
// settings nav/body/section/field/input/range/toggle, theme-card +
// states. Heavy reliance on S37/S38 vnext-text-* tokens + the
// existing white-alpha vocabulary.

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
  "--ht-vnext-text-mid",
  "--ht-vnext-text-elevated",
  "--ht-vnext-settings-body-bg",
  "--ht-vnext-settings-range-thumb-border",
  "--ht-vnext-segment-active-fg",
  "--ht-vnext-sheet-bg",
  "--ht-vnext-modal-overlay-bg",
];

// Scope to the 2026-refresh vNext block (the 2nd to 3rd #titlebar {
// occurrence in the file). Same anchor as the chunk-1 sidebar test.
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

describe("theme-token migration — vNext settings/card/sheet (P7 S39 chunk 2)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".pane-divider (vNext) uses panel-border-soft", () => {
    const rule = matchRule(vBlock, ".pane-divider");
    expect(rule).toContain("var(--ht-panel-border-soft)");
  });

  test("panel/sheet multi-selector uses panel-border-soft + sheet-bg", () => {
    expect(vBlock).toMatch(
      /\.panel,\s*\n\.surface-context-menu,[^{}]*\{[^}]*var\(--ht-panel-border-soft\)[^}]*var\(--ht-vnext-sheet-bg\)/,
    );
  });

  test("modal overlay multi-selector uses modal-overlay-bg", () => {
    expect(vBlock).toMatch(
      /\.process-manager-overlay,\s*\n\.surface-details-overlay,[^{}]*\{[^}]*var\(--ht-vnext-modal-overlay-bg\)/,
    );
  });

  test("panel header multi-selector uses agent-row-bg-hover-card + chip-bg in gradient", () => {
    expect(vBlock).toMatch(
      /\.process-manager-header,\s*\n\.surface-details-header,[^{}]*\.palette-input-row \{[^}]*var\(--ht-agent-row-bg-hover-card\)[^}]*var\(--ht-chip-bg\)/,
    );
  });

  test(".process-manager-header-hint + surface-details-header-subtitle use vnext-text-mute", () => {
    expect(vBlock).toMatch(
      /\.process-manager-header-hint,\s*\n\.surface-details-header-subtitle \{[^}]*var\(--ht-vnext-text-mute\)/,
    );
  });

  test(".settings-header-eyebrow + -subtitle use text-section-h + text-mid", () => {
    const eyebrow = matchRule(vBlock, ".settings-header-eyebrow");
    expect(eyebrow).toContain("var(--ht-vnext-text-section-h)");

    const subtitle = matchRule(vBlock, ".settings-header-subtitle");
    expect(subtitle).toContain("var(--ht-vnext-text-mid)");
  });

  test(".settings-body uses settings-body-bg token", () => {
    const rule = matchRule(vBlock, ".settings-body");
    expect(rule).toContain("var(--ht-vnext-settings-body-bg)");
  });

  test(".settings-nav uses agent-row-bg-hover-card + sidebar-row-bg-stripe", () => {
    const rule = matchRule(vBlock, ".settings-nav");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rule).toContain("var(--ht-sidebar-row-bg-stripe)");
  });

  test(".settings-nav-item rest/hover/active use elevated + chip-bg + sidebar-text-strong", () => {
    const rest = matchRule(vBlock, ".settings-nav-item");
    expect(rest).toContain("var(--ht-vnext-text-elevated)");

    const hover = matchRule(vBlock, ".settings-nav-item:hover");
    expect(hover).toContain("var(--ht-chip-bg)");
    expect(hover).toContain("var(--ht-sidebar-text-strong)");

    const active = matchRule(vBlock, ".settings-nav-item.active");
    expect(active).toContain("var(--ht-agent-row-bg-hover)");
    expect(active).toContain("var(--ht-sidebar-text-strong)");
  });

  test(".settings-section-desc reuses text-mid (0.54 → 0.52 2pp harmonisation)", () => {
    const rule = matchRule(vBlock, ".settings-section-desc");
    expect(rule).toContain("var(--ht-vnext-text-mid)");
  });

  test(".settings-field-note + range-value reuse text-mute (0.5 → 0.48 2pp)", () => {
    expect(vBlock).toMatch(
      /\.settings-field-note,\s*\n\.settings-range-value \{[^}]*var\(--ht-vnext-text-mute\)/,
    );
  });

  test(".settings-input multi-selector uses agent-row-bg-hover + panel-border-soft", () => {
    expect(vBlock).toMatch(
      /\.settings-input,\s*\n\.settings-segmented \{[^}]*var\(--ht-agent-row-bg-hover\)[^}]*var\(--ht-panel-border-soft\)/,
    );
  });

  test(".settings-range + thumb border use panel-border-soft + range-thumb-border", () => {
    const range = matchRule(vBlock, ".settings-range");
    expect(range).toContain("var(--ht-panel-border-soft)");

    const thumb = matchRule(vBlock, ".settings-range::-webkit-slider-thumb");
    expect(thumb).toContain("var(--ht-vnext-settings-range-thumb-border)");
  });

  test(".settings-toggle-slider reuses filter-selected-bg-top (0.12 → 0.1 2pp)", () => {
    const rule = matchRule(vBlock, ".settings-toggle-slider");
    expect(rule).toContain("var(--ht-sidebar-filter-selected-bg-top)");
  });

  test(".settings-segment.active multi-selector uses segment-active-fg", () => {
    expect(vBlock).toMatch(
      /\.settings-segment\.active,\s*\n\.prompt-btn-primary \{[^}]*var\(--ht-vnext-segment-active-fg\)/,
    );
  });

  test(".theme-card rest/hover/active use card tokens + button-bg + filter-selected-bg-top in color-mix", () => {
    const rest = matchRule(vBlock, ".theme-card");
    expect(rest).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rest).toContain("var(--ht-package-header-bg-hover)");

    const hover = matchRule(vBlock, ".theme-card:hover");
    expect(hover).toContain("var(--ht-button-bg)");

    const active = matchRule(vBlock, ".theme-card.active");
    expect(active).toContain("var(--ht-sidebar-filter-selected-bg-top)");
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
