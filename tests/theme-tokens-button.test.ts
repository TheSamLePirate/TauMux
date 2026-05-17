// P7 S12 — Cluster H continuation, small icon button region.
//
// The .sidebar-new-btn / :hover rules carried 6 fine-tuned rgba
// literals for the resting + hover button states. Migrated to a
// new --ht-button-* token group so a future palette swap can repaint
// the macOS-HIG-style 26 px icon buttons (sidebar-new, section-clear,
// workspace-close, surface-bar) in one place.

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
  "--ht-button-fg",
  "--ht-button-fg-hover",
  "--ht-button-bg",
  "--ht-button-border",
  "--ht-button-inset-highlight",
  "--ht-button-drop-shadow",
  "--ht-button-bg-hover-fallback",
];

describe("theme-token migration — small icon button (P7 S12)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".sidebar-new-btn resting state uses button tokens", () => {
    const block = matchRule(indexCss, ".sidebar-new-btn");
    expect(block).not.toBeNull();
    expect(block).toContain("var(--ht-button-fg)");
    expect(block).toContain("var(--ht-button-bg)");
    expect(block).toContain("var(--ht-button-border)");
    expect(block).toContain("var(--ht-button-inset-highlight)");
    expect(block).toContain("var(--ht-button-drop-shadow)");
    // Raw rgba shapes must not survive.
    expect(block).not.toMatch(/rgba\(243,\s*246,\s*253,\s*0\.82\)/);
    expect(block).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.055\)/);
    expect(block).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.18\)/);
  });

  test(".sidebar-new-btn:hover uses the hover tokens", () => {
    const block = matchRule(indexCss, ".sidebar-new-btn:hover");
    expect(block).not.toBeNull();
    expect(block).toContain("var(--ht-button-fg-hover)");
    expect(block).toContain("var(--ht-button-bg-hover-fallback)");
    expect(block).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.98\)/);
    expect(block).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.07\)/);
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
