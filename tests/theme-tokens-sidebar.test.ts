// P7 S10 — Cluster H continuation, sidebar workspace-card region.
//
// The .workspace-item / :hover / .keyboard-focus / .active /
// .drop-* rules used a handful of fine-tuned rgba(255,255,255,X)
// literals. Migrated to the `--ht-sidebar-*` token set so a future
// palette swap (or a sidebar density rework) can repaint in one
// place. These tests pin the migration so a refactor can't silently
// re-introduce the literals.

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
  "--ht-sidebar-row-bg",
  "--ht-sidebar-row-bg-hover",
  "--ht-sidebar-row-bg-stripe-soft",
  "--ht-sidebar-row-bg-stripe",
  "--ht-sidebar-row-border",
  "--ht-sidebar-row-border-hover",
  "--ht-sidebar-inset-highlight",
  "--ht-sidebar-inset-strong",
  "--ht-sidebar-row-shadow",
];

describe("theme-token migration — sidebar workspace-card (P7 S10)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".workspace-item resting state uses sidebar tokens", () => {
    const block = matchRule(indexCss, ".workspace-item");
    expect(block).not.toBeNull();
    expect(block).toContain("var(--ht-sidebar-row-border)");
    expect(block).toContain("var(--ht-sidebar-row-bg)");
    expect(block).toContain("var(--ht-sidebar-inset-highlight)");
    // The raw 0.022 / 0.045 / 0.028 white-tints must not survive.
    expect(block).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.022\)/);
    expect(block).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.045\)/);
    expect(block).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.028\)/);
  });

  test(".workspace-item:hover uses the hover tokens", () => {
    const block = matchRule(indexCss, ".workspace-item:hover");
    expect(block).not.toBeNull();
    expect(block).toContain("var(--ht-sidebar-row-border-hover)");
    expect(block).toContain("var(--ht-sidebar-row-bg-hover)");
    expect(block).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.1\)/);
    expect(block).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.045\)/);
  });

  test(".workspace-item.active uses the stripe + inset + shadow tokens", () => {
    const block = matchRule(indexCss, ".workspace-item.active");
    expect(block).not.toBeNull();
    expect(block).toContain("var(--ht-sidebar-row-bg-stripe-soft)");
    expect(block).toContain("var(--ht-sidebar-row-bg-stripe)");
    expect(block).toContain("var(--ht-sidebar-inset-strong)");
    expect(block).toContain("var(--ht-sidebar-row-shadow)");
    expect(block).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.014\)/);
    expect(block).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.025\)/);
    expect(block).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.06\)/);
    expect(block).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.26\)/);
  });

  test("drop indicators use the inset-highlight token", () => {
    const before = matchRule(indexCss, ".workspace-item.drop-before");
    const after = matchRule(indexCss, ".workspace-item.drop-after");
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(before).toContain("var(--ht-sidebar-inset-highlight)");
    expect(after).toContain("var(--ht-sidebar-inset-highlight)");
  });
});

/** Pull the body of a CSS rule (selector { … }). Returns null when the
 *  selector isn't found. Walks balanced braces; doesn't handle @media
 *  nesting but the workspace-item rules aren't inside @media. */
function matchRule(css: string, selector: string): string | null {
  // Need to match the selector at the START of a rule, not inside
  // a comment or another selector. The CSS uses one rule per
  // selector here; a literal indexOf plus space-before check suffices.
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
