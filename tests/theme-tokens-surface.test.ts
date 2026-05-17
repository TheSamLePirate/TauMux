// P7 S11 — Cluster H continuation, surface (pane) chrome region.
//
// The .surface-container rule held the pane container's dark border
// + inset top-highlight + deep drop shadow as raw rgba literals.
// Migrated to a new --ht-surface-* token group; future palette swap
// can repaint pane chrome in one place. These tests pin the
// migration.

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
  "--ht-surface-border",
  "--ht-surface-inset-highlight",
  "--ht-surface-shadow",
];

describe("theme-token migration — surface (pane) chrome (P7 S11)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".surface-container uses the surface token set", () => {
    const block = matchRule(indexCss, ".surface-container");
    expect(block).not.toBeNull();
    expect(block).toContain("var(--ht-surface-border)");
    expect(block).toContain("var(--ht-surface-inset-highlight)");
    expect(block).toContain("var(--ht-surface-shadow)");
    // The literal rgba(39, 39, 42, 0.96) / rgba(255, 255, 255, 0.03)
    // / rgba(0, 0, 0, 0.38) shouldn't survive in this rule body.
    expect(block).not.toMatch(/rgba\(39,\s*39,\s*42,\s*0\.96\)/);
    expect(block).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.03\)/);
    expect(block).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.38\)/);
  });
});

function matchRule(css: string, selector: string): string | null {
  const re = new RegExp(`(^|\\n)${escape(selector)}\\s*\\{`, "g");
  const m = re.exec(css);
  if (!m) return null;
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
