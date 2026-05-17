// P7 S19 — Cluster H continuation, surface chip region.
//
// The .surface-chip + .chip-* rules carried 14 literals: 2 neutral
// chip tints (bg, border) + the same semantic family the PM badges
// use (success/warn/info bg+border) plus a new success-hover ramp
// for the interactive `chip-port`. The migration:
//   - Adds 2 chip-specific neutral tokens (--ht-chip-bg / --ht-chip-border).
//   - Adds 4 badge-family extensions (info-border-soft, success-bg-hover,
//     success-border-hover, success-fg-hover).
//   - REUSES the S18 --ht-badge-* family (success / warn / info bg + border).
//   - REUSES existing --ht-sem-error / --ht-sem-success for git-add /
//     git-conflicts / git-del foreground colours.
// Total: 6 new tokens, 14 literals replaced.

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
  "--ht-chip-bg",
  "--ht-chip-border",
  "--ht-badge-info-border-soft",
  "--ht-badge-success-bg-hover",
  "--ht-badge-success-border-hover",
  "--ht-badge-success-fg-hover",
];

describe("theme-token migration — surface chips (P7 S19)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("base .surface-chip uses the neutral chip tokens", () => {
    const chip = matchRule(indexCss, ".surface-chip");
    expect(chip).toContain("var(--ht-chip-bg)");
    expect(chip).toContain("var(--ht-chip-border)");
    expect(chip).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.05\)/);
  });

  test("chip-command + chip-git[.dirty] use the badge family", () => {
    const cmd = matchRule(indexCss, ".surface-chip.chip-command");
    expect(cmd).toContain("var(--ht-badge-info-bg)");
    expect(cmd).toContain("var(--ht-badge-info-border-soft)");

    const gitClean = matchRule(indexCss, ".surface-chip.chip-git");
    expect(gitClean).toContain("var(--ht-badge-warn-bg)");
    expect(gitClean).toContain("var(--ht-badge-warn-border)");

    const gitDirty = matchRule(indexCss, ".surface-chip.chip-git.dirty");
    expect(gitDirty).toContain("var(--ht-badge-info-bg)");
    expect(gitDirty).toContain("var(--ht-badge-info-border)");
  });

  test("chip-port resting + hover use the success badge family", () => {
    const port = matchRule(indexCss, ".surface-chip.chip-port");
    expect(port).toContain("var(--ht-badge-success-fg)");
    expect(port).toContain("var(--ht-badge-success-bg)");
    expect(port).toContain("var(--ht-badge-success-border)");

    // Hover/focus is a multi-selector rule — grep it.
    expect(indexCss).toMatch(
      /\.surface-chip\.chip-port:hover,\s*\n\s*\.surface-chip\.chip-port:focus-visible\s*\{[^}]*background:\s*var\(--ht-badge-success-bg-hover\)/,
    );
    expect(indexCss).toMatch(
      /\.surface-chip\.chip-port:hover,\s*\n\s*\.surface-chip\.chip-port:focus-visible\s*\{[^}]*border-color:\s*var\(--ht-badge-success-border-hover\)/,
    );
    expect(indexCss).toMatch(
      /\.surface-chip\.chip-port:hover,\s*\n\s*\.surface-chip\.chip-port:focus-visible\s*\{[^}]*color:\s*var\(--ht-badge-success-fg-hover\)/,
    );
  });

  test("chip-git-add / del / conflicts reuse --ht-sem-* foreground tokens", () => {
    const add = matchRule(indexCss, ".chip-git-add");
    expect(add).toContain("var(--ht-sem-success)");
    expect(add).not.toContain("#4ade80");

    const del = matchRule(indexCss, ".chip-git-del");
    expect(del).toContain("var(--ht-sem-error)");

    const conflicts = matchRule(indexCss, ".chip-git-conflicts");
    expect(conflicts).toContain("var(--ht-sem-error)");
    expect(conflicts).not.toContain("#f87171");
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
