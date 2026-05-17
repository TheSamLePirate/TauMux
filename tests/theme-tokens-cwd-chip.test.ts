// P7 S20 — Cluster H continuation, workspace cwd chip region.
//
// The .workspace-cwd-chip rule (sidebar mixed-cwd selector) carried
// 7 literals: resting bg/border, hover bg/border, active bg + border +
// inset glow. Migrated to a new --ht-cwd-chip-* token group (6 tokens)
// + reuses --ht-badge-info-bg for the active state's cyan tint.

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
  "--ht-cwd-chip-bg",
  "--ht-cwd-chip-border",
  "--ht-cwd-chip-bg-hover",
  "--ht-cwd-chip-border-hover",
  "--ht-cwd-chip-active-border",
  "--ht-cwd-chip-active-glow",
];

describe("theme-token migration — workspace cwd chip (P7 S20)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("cwd chip resting uses the new tokens", () => {
    const chip = matchRule(indexCss, ".workspace-cwd-chip");
    expect(chip).toContain("var(--ht-cwd-chip-bg)");
    expect(chip).toContain("var(--ht-cwd-chip-border)");
    expect(chip).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.03\)/);
  });

  test("cwd chip :hover uses the new tokens", () => {
    const hover = matchRule(indexCss, ".workspace-cwd-chip:hover");
    expect(hover).toContain("var(--ht-cwd-chip-bg-hover)");
    expect(hover).toContain("var(--ht-cwd-chip-border-hover)");
  });

  test("cwd chip .active reuses --ht-badge-info-bg + has its own border + glow", () => {
    const active = matchRule(indexCss, ".workspace-cwd-chip.active");
    expect(active).toContain("var(--ht-badge-info-bg)");
    expect(active).toContain("var(--ht-cwd-chip-active-border)");
    expect(active).toContain("var(--ht-cwd-chip-active-glow)");
    expect(active).not.toMatch(/rgba\(111,\s*233,\s*255,\s*0\.32\)/);
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
