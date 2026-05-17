// P7 S16 — Cluster H continuation, command palette + kbd cheat-sheet
// region.
//
// The .palette-* and .kbd-* rules shared a black-on-black container
// with a stack of fine-grained cyan tints (border, divider, header,
// kbd-keys chip bg/fg/border). 18 fine-tuned literals migrated to a
// new --ht-palette-* token group (14 tokens) so a future palette swap
// can repaint both overlays in one place — mirroring the
// ht-sidebar-* / ht-button-* / ht-agent-* / ht-telegram-* /
// ht-titlebar-* migrations from S10 → S15.

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
  "--ht-palette-scrim-bg",
  "--ht-palette-kbd-scrim-bg",
  "--ht-palette-shell-bg",
  "--ht-palette-border",
  "--ht-palette-shadow",
  "--ht-palette-divider",
  "--ht-palette-divider-soft",
  "--ht-palette-results-bg",
  "--ht-palette-row-hover-bg",
  "--ht-palette-placeholder-fg",
  "--ht-palette-kbd-section-fg",
  "--ht-palette-kbd-keys-fg",
  "--ht-palette-kbd-keys-bg",
  "--ht-palette-kbd-keys-border",
];

describe("theme-token migration — command palette + kbd cheat-sheet (P7 S16)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("palette overlay + container chrome use the new tokens", () => {
    const overlay = matchRule(indexCss, ".palette-overlay");
    expect(overlay).toContain("var(--ht-palette-scrim-bg)");
    expect(overlay).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.28\)/);

    const container = matchRule(indexCss, ".palette-container");
    expect(container).toContain("var(--ht-palette-shell-bg)");
    expect(container).toContain("var(--ht-palette-border)");
    expect(container).toContain("var(--ht-palette-shadow)");
    expect(container).not.toContain("#000;");
    expect(container).not.toMatch(/rgba\(111,\s*233,\s*255,\s*0\.72\)/);

    const inputRow = matchRule(indexCss, ".palette-input-row");
    expect(inputRow).toContain("var(--ht-palette-shell-bg)");
    expect(inputRow).toContain("var(--ht-palette-divider-soft)");

    const placeholder = matchRule(indexCss, ".palette-input::placeholder");
    expect(placeholder).toContain("var(--ht-palette-placeholder-fg)");

    const results = matchRule(indexCss, ".palette-results");
    expect(results).toContain("var(--ht-palette-results-bg)");

    // Hover / selected rule has two selectors; just grep the whole file
    // for the migrated background line.
    expect(indexCss).toMatch(
      /\.palette-item:hover,\s*\n\s*\.palette-item\.selected\s*\{[^}]*background:\s*var\(--ht-palette-row-hover-bg\)/,
    );
  });

  test("kbd cheat-sheet panel + key chip use the new tokens", () => {
    const sheet = matchRule(indexCss, ".kbd-cheatsheet");
    expect(sheet).toContain("var(--ht-palette-kbd-scrim-bg)");

    const panel = matchRule(indexCss, ".kbd-panel");
    expect(panel).toContain("var(--ht-palette-shell-bg)");
    expect(panel).toContain("var(--ht-palette-border)");
    expect(panel).toContain("var(--ht-palette-shadow)");

    const header = matchRule(indexCss, ".kbd-header");
    expect(header).toContain("var(--ht-palette-divider)");

    const headerH2 = matchRule(indexCss, ".kbd-header h2");
    expect(headerH2).toContain("var(--ht-palette-kbd-keys-fg)");

    const section = matchRule(indexCss, ".kbd-section h3");
    expect(section).toContain("var(--ht-palette-kbd-section-fg)");

    const keys = matchRule(indexCss, ".kbd-row .kbd-keys");
    expect(keys).toContain("var(--ht-palette-kbd-keys-fg)");
    expect(keys).toContain("var(--ht-palette-kbd-keys-bg)");
    expect(keys).toContain("var(--ht-palette-kbd-keys-border)");

    const footer = matchRule(indexCss, ".kbd-footer");
    expect(footer).toContain("var(--ht-palette-divider)");

    const footerKbd = matchRule(indexCss, ".kbd-footer kbd");
    expect(footerKbd).toContain("var(--ht-palette-kbd-keys-bg)");
    expect(footerKbd).toContain("var(--ht-palette-kbd-keys-border)");
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
