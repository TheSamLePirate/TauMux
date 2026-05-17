// P7 S30 — Cluster H, prompt overlay / sheet / input / btn region.
//
// 6 new --ht-prompt-* tokens cover the dialog-specific bits (scrim,
// focus glow, invalid state border + shadow, primary button bg + fg).
// Heavy cross-component reuse: --ht-ask-sheet-bg / -border /
// -codebox-bg / -codebox-border for the sheet + input chrome,
// --ht-palette-shadow for the drop shadow.

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
  "--ht-prompt-scrim-bg",
  "--ht-prompt-focus-glow",
  "--ht-prompt-invalid-border",
  "--ht-prompt-invalid-shadow",
  "--ht-prompt-primary-bg",
  "--ht-prompt-primary-fg",
];

describe("theme-token migration — prompt dialog (P7 S30)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("prompt overlay scrim uses the new token", () => {
    const overlay = matchRule(indexCss, ".prompt-overlay");
    expect(overlay).toContain("var(--ht-prompt-scrim-bg)");
    expect(overlay).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.35\)/);
  });

  test("prompt sheet REUSES ask-sheet bg/border + palette-shadow", () => {
    const sheet = matchRule(indexCss, ".prompt-sheet");
    expect(sheet).toContain("var(--ht-ask-sheet-bg)");
    expect(sheet).toContain("var(--ht-ask-sheet-border)");
    expect(sheet).toContain("var(--ht-palette-shadow)");
  });

  test("prompt input + focus state use ask-codebox + new focus glow", () => {
    const input = matchRule(indexCss, ".prompt-input");
    expect(input).toContain("var(--ht-ask-codebox-border)");
    expect(input).toContain("var(--ht-ask-codebox-bg)");

    const focus = matchRule(indexCss, ".prompt-input:focus");
    expect(focus).toContain("var(--ht-ask-sheet-border)");
    expect(focus).toContain("var(--ht-prompt-focus-glow)");
  });

  test("prompt input invalid state uses the new red tokens", () => {
    const invalid = matchRule(indexCss, ".prompt-input-invalid");
    expect(invalid).toContain("var(--ht-prompt-invalid-border)");
    expect(invalid).toContain("var(--ht-prompt-invalid-shadow)");
  });

  test("prompt buttons use new primary tokens + reuse ask-codebox border", () => {
    // Two `.prompt-btn` rules — the first is a multi-selector reset
    // (shared with .workspace-close / .surface-bar-btn / .sidebar-
    // section-clear). The second is the prompt-specific one with the
    // border. Grep for the standalone selector.
    expect(indexCss).toMatch(
      /\n\.prompt-btn \{[^}]*border:\s*0\.5px solid var\(--ht-ask-codebox-border\)/,
    );

    const primary = matchRule(indexCss, ".prompt-btn-primary");
    expect(primary).toContain("var(--ht-prompt-primary-bg)");
    expect(primary).toContain("var(--ht-prompt-primary-fg)");
    expect(primary).not.toContain("#09090b");
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
