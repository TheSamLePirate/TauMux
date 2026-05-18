// P7 S35 chunk 1 — Cluster H, sidebar v2 workspace-script-btn region
// (per-workspace npm script buttons with running / error pulse dots).
//
// 3 new --ht-sidebar-v2-script-* tokens for the dot rest bg (0.2
// white, brighter than any existing soft alpha) + the running/error
// pulse glow alphas (0.6 — unique to the dot pulse). Reuses:
// - --ht-package-header-bg-hover (0.03 white, exact) for the
//   color-mix inner alpha on the btn hover state.
// - --ht-script-running-bg + --ht-script-error-bg (0.05 vs 0.06
//   literals — 1pp delta, well within the harmonisation threshold).
// - --ht-badge-success-fg (#86efac exact) for the running dot.
// - --ht-sem-error (#f87171 exact) for the error dot.

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
  "--ht-sidebar-v2-script-dot-rest-bg",
  "--ht-sidebar-v2-script-running-glow",
  "--ht-sidebar-v2-script-error-glow",
];

describe("theme-token migration — sidebar v2 workspace-script-btn (P7 S35 chunk 1)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("workspace-script-btn:hover reuses package-header-bg-hover inside color-mix", () => {
    const rule = matchRule(
      indexCss,
      "#sidebar.sidebar-v2 .workspace-script-btn:hover",
    );
    expect(rule).toContain("var(--ht-package-header-bg-hover)");
    expect(rule).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.03\)/);
  });

  test("workspace-script-btn[running] uses script-running-bg", () => {
    const rule = matchRule(
      indexCss,
      '#sidebar.sidebar-v2 .workspace-script-btn[data-state="running"]',
    );
    expect(rule).toContain("var(--ht-script-running-bg)");
  });

  test("workspace-script-btn[error] uses script-error-bg", () => {
    const rule = matchRule(
      indexCss,
      '#sidebar.sidebar-v2 .workspace-script-btn[data-state="error"]',
    );
    expect(rule).toContain("var(--ht-script-error-bg)");
  });

  test("workspace-script-dot rest uses script-dot-rest-bg", () => {
    const rule = matchRule(
      indexCss,
      "#sidebar.sidebar-v2 .workspace-script-dot",
    );
    expect(rule).toContain("var(--ht-sidebar-v2-script-dot-rest-bg)");
  });

  test("workspace-script-dot.running reuses badge-success-fg + new glow token", () => {
    const rule = matchRule(
      indexCss,
      "#sidebar.sidebar-v2 .workspace-script-dot.running",
    );
    expect(rule).toContain("var(--ht-badge-success-fg)");
    expect(rule).toContain("var(--ht-sidebar-v2-script-running-glow)");
    expect(rule).not.toContain("#86efac");
  });

  test("workspace-script-dot.error reuses sem-error + new glow token", () => {
    const rule = matchRule(
      indexCss,
      "#sidebar.sidebar-v2 .workspace-script-dot.error",
    );
    expect(rule).toContain("var(--ht-sem-error)");
    expect(rule).toContain("var(--ht-sidebar-v2-script-error-glow)");
    expect(rule).not.toContain("#f87171");
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
