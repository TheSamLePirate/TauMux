// P7 S22 — Cluster H continuation, workspace script-button state
// region.
//
// The .workspace-script-btn rule carried 7 literals across hover +
// running + error + dot states. Migrated to a new --ht-script-*
// token group (5 tokens for the state-specific tints) + REUSES
// --ht-agent-row-bg-hover (white 0.04) + --ht-border-soft (white 0.06)
// for the hover state — same alpha values, same intent.

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
  "--ht-script-running-bg",
  "--ht-script-running-border",
  "--ht-script-error-bg",
  "--ht-script-error-border",
  "--ht-script-dot-bg",
];

describe("theme-token migration — workspace script button (P7 S22)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("script-btn :hover REUSES existing white-overlay tokens", () => {
    const hover = matchRule(indexCss, ".workspace-script-btn:hover");
    expect(hover).toContain("var(--ht-agent-row-bg-hover)");
    expect(hover).toContain("var(--ht-border-soft)");
    expect(hover).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.04\)/);
    expect(hover).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.06\)/);
  });

  test('script-btn [data-state="running"] uses the success tokens', () => {
    const running = matchRule(
      indexCss,
      '.workspace-script-btn[data-state="running"]',
    );
    expect(running).toContain("var(--ht-script-running-bg)");
    expect(running).toContain("var(--ht-script-running-border)");
    expect(running).not.toMatch(/rgba\(74,\s*222,\s*128/);
  });

  test('script-btn [data-state="error"] uses the error tokens', () => {
    const err = matchRule(
      indexCss,
      '.workspace-script-btn[data-state="error"]',
    );
    expect(err).toContain("var(--ht-script-error-bg)");
    expect(err).toContain("var(--ht-script-error-border)");
    expect(err).not.toMatch(/rgba\(248,\s*113,\s*113/);
  });

  test("script-dot idle bg uses the new token", () => {
    const dot = matchRule(indexCss, ".workspace-script-dot");
    expect(dot).toContain("var(--ht-script-dot-bg)");
    expect(dot).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.18\)/);
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
