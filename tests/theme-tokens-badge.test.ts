// P7 S18 — Cluster H continuation, cross-component semantic badge
// tints + PM port/git badges.
//
// The PM port (green), git-clean (amber), and git-dirty (cyan) badges
// each carried bg + border literals at the same soft-bg/matching-
// border depth. Pulling them into a shared --ht-badge-* namespace lets
// future surface chips / sidebar status pills reuse the same tokens.
// Also reuses existing --ht-sem-success / --ht-sem-error for git-add
// / git-conflicts / git-del foreground colours and the CPU heatmap
// endpoint.

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
  "--ht-badge-success-fg",
  "--ht-badge-success-bg",
  "--ht-badge-success-border",
  "--ht-badge-warn-bg",
  "--ht-badge-warn-border",
  "--ht-badge-info-bg",
  "--ht-badge-info-border",
];

describe("theme-token migration — cross-component badge tints (P7 S18)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("PM port badge uses success badge tokens", () => {
    const port = matchRule(indexCss, ".process-manager-port");
    expect(port).toContain("var(--ht-badge-success-fg)");
    expect(port).toContain("var(--ht-badge-success-bg)");
    expect(port).toContain("var(--ht-badge-success-border)");
    expect(port).not.toContain("#86efac");
    expect(port).not.toMatch(/rgba\(74,\s*222,\s*128/);
  });

  test("PM git clean badge uses warn badge tokens", () => {
    const git = matchRule(indexCss, ".process-manager-git");
    expect(git).toContain("var(--ht-badge-warn-bg)");
    expect(git).toContain("var(--ht-badge-warn-border)");
    expect(git).not.toMatch(/rgba\(255,\s*197,\s*107/);
  });

  test("PM git dirty badge uses info badge tokens", () => {
    const dirty = matchRule(indexCss, ".process-manager-git.dirty");
    expect(dirty).toContain("var(--ht-badge-info-bg)");
    expect(dirty).toContain("var(--ht-badge-info-border)");
    expect(dirty).not.toMatch(/rgba\(111,\s*233,\s*255/);
  });

  test("git conflict/del/add fg + CPU heatmap reuse --ht-sem-* tokens", () => {
    // Multi-selector rule — grep instead.
    expect(indexCss).toMatch(
      /\.process-manager-git-conflicts,\s*\n\s*\.process-manager-git-del\s*\{[^}]*color:\s*var\(--ht-sem-error\)/,
    );
    const add = matchRule(indexCss, ".process-manager-git-add");
    expect(add).toContain("var(--ht-sem-success)");

    const cpu = matchRule(indexCss, ".process-manager-cpu");
    expect(cpu).toContain("var(--ht-sem-error)");
    expect(cpu).not.toContain("#f87171");
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
