// P7 S43 chunk 2 — Cluster H, pi-agent input bar (rest + drop +
// attachments + focus + placeholder + hint), attachment chips +
// thumb, send-btn (#000 fg only — gradient + stop-btn deferred),
// and agent status chips (status / tool / streaming / queue).
//
// 6 new --ht-agent-* tokens:
// - input-with-attachments-border (indigo 0.22, brightest edge)
// - input-with-attachments-shadow (indigo 0.06, faint inset)
// - attachment-chip-bg (indigo 0.08, flat fill)
// - kbd-fg (0.18 white dim glyph)
// - chip-status-border (amber 0.15)
// - chip-streaming-border (green 0.12)
//
// Notable reuses (~16): --ht-agent-footer-bg + --ht-agent-image-
// thumb-bg as gradient stops for the input bar (the gradient
// effectively chains the footer's 0.15 black to the message-thumb's
// 0.25 black), --ht-notify-cyan-soft + --ht-sidebar-filter-selected-
// shadow for the drop state gradient, --ht-palette-divider for
// attachment-chip border (0.16 → 0.18 2pp), --ht-agent-tb-model-
// hover-border for input:focus border (cyan 0.3 exact), --ht-
// sidebar-filter-selected-bg-top for input-hint fg (0.12 → 0.1 2pp),
// --ht-agent-badge-extension-bg reused 3-ways for chip-queue (bg
// 0.1 → 0.12 2pp + border 0.12 exact + cross-component with the
// S43-chunk-1 slash-badge-extension), --ht-on-accent-fg for the
// send-btn fg (S34 token, third reuse now).

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
  "--ht-agent-input-with-attachments-border",
  "--ht-agent-input-with-attachments-shadow",
  "--ht-agent-attachment-chip-bg",
  "--ht-agent-kbd-fg",
  "--ht-agent-chip-status-border",
  "--ht-agent-chip-streaming-border",
];

describe("theme-token migration — pi-agent input + chips (P7 S43 chunk 2)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".agent-input-bar uses agent-row-bg-hover + footer-bg + image-thumb-bg gradient stops", () => {
    const rule = matchRule(indexCss, ".agent-input-bar");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
    expect(rule).toContain("var(--ht-agent-footer-bg)");
    expect(rule).toContain("var(--ht-agent-image-thumb-bg)");
  });

  test(".agent-input-bar-drop uses notify-cyan-soft + filter-selected-shadow + palette-divider-soft", () => {
    const rule = matchRule(indexCss, ".agent-input-bar-drop");
    expect(rule).toContain("var(--ht-notify-cyan-soft)");
    expect(rule).toContain("var(--ht-sidebar-filter-selected-shadow)");
    expect(rule).toContain("var(--ht-palette-divider-soft)");
  });

  test(".agent-input rest uses agent-row-bg-hover-card + package-header-bg-hover", () => {
    const rule = matchRule(indexCss, ".agent-input");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rule).toContain("var(--ht-package-header-bg-hover)");
  });

  test(".agent-input-with-attachments uses both new indigo tokens", () => {
    const rule = matchRule(indexCss, ".agent-input-with-attachments");
    expect(rule).toContain("var(--ht-agent-input-with-attachments-border)");
    expect(rule).toContain("var(--ht-agent-input-with-attachments-shadow)");
  });

  test(".agent-input:focus reuses S41 tb-model-hover-border + agent-row-bg-hover", () => {
    const rule = matchRule(indexCss, ".agent-input:focus");
    expect(rule).toContain("var(--ht-agent-tb-model-hover-border)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
  });

  test(".agent-input-hint uses sidebar-filter-selected-bg-top fg (0.12 → 0.1 2pp)", () => {
    const rule = matchRule(indexCss, ".agent-input-hint");
    expect(rule).toContain("var(--ht-sidebar-filter-selected-bg-top)");
  });

  test(".agent-attachment-chip uses palette-divider + attachment-chip-bg", () => {
    const rule = matchRule(indexCss, ".agent-attachment-chip");
    expect(rule).toContain("var(--ht-palette-divider)");
    expect(rule).toContain("var(--ht-agent-attachment-chip-bg)");
  });

  test(".agent-attachment-thumb uses panel-border-soft", () => {
    const rule = matchRule(indexCss, ".agent-attachment-thumb");
    expect(rule).toContain("var(--ht-panel-border-soft)");
  });

  test(".agent-input-hint kbd uses agent-kbd-fg", () => {
    const rule = matchRule(indexCss, ".agent-input-hint kbd");
    expect(rule).toContain("var(--ht-agent-kbd-fg)");
  });

  test(".agent-send-btn fg uses on-accent-fg (S34 reuse)", () => {
    const rule = matchRule(indexCss, ".agent-send-btn");
    expect(rule).toContain("var(--ht-on-accent-fg)");
    expect(rule).not.toMatch(/color:\s*#000;/);
  });

  test(".chip-agent-status uses notify-amber-soft + chip-status-border", () => {
    const rule = matchRule(indexCss, ".chip-agent-status");
    expect(rule).toContain("var(--ht-notify-amber-soft)");
    expect(rule).toContain("var(--ht-agent-chip-status-border)");
  });

  test(".chip-agent-tool reuses notify-cyan-soft + palette-divider-soft", () => {
    const rule = matchRule(indexCss, ".chip-agent-tool");
    expect(rule).toContain("var(--ht-notify-cyan-soft)");
    expect(rule).toContain("var(--ht-palette-divider-soft)");
  });

  test(".chip-agent-streaming reuses badge-success-bg + sem-success + chip-streaming-border", () => {
    const rule = matchRule(indexCss, ".chip-agent-streaming");
    expect(rule).toContain("var(--ht-badge-success-bg)");
    expect(rule).toContain("var(--ht-sem-success)");
    expect(rule).toContain("var(--ht-agent-chip-streaming-border)");
  });

  test(".chip-agent-queue reuses badge-extension-bg + badge-scope-fg (S41+S43-c1 chain)", () => {
    const rule = matchRule(indexCss, ".chip-agent-queue");
    expect(rule).toContain("var(--ht-agent-badge-extension-bg)");
    expect(rule).toContain("var(--ht-agent-badge-scope-fg)");
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
