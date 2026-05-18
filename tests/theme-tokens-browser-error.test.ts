// P7 S30 — Cluster H second chunk: browser pane load-error overlay
// + kbd-cheatsheet `var(--fg, #fff)` fallback cleanup.
//
// 2 new --ht-browser-error-* tokens cover the overlay's distinct
// eggplant/soft-red palette. The kbd panel had ~5 inline
// `var(--fg, #e6f4f7)` / `var(--fg-dim, #9aa)` fallbacks that were
// dead code (the --fg var was never defined anywhere in the
// codebase). Migrated to `var(--text-strong)` / `var(--text-dim)`
// which ARE defined — slight visual delta (the original fallbacks
// painted directly with the inline hex) traded for theming
// consistency.

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

describe("theme-token migration — browser error + kbd fallbacks (P7 S30)", () => {
  test("--ht-browser-error-fg + --ht-browser-error-bg defined", () => {
    expect(tokens).toContain("--ht-browser-error-fg:");
    expect(tokens).toContain("--ht-browser-error-bg:");
  });

  test(".browser-pane-error-overlay uses the new tokens", () => {
    const overlay = matchRule(indexCss, ".browser-pane-error-overlay");
    expect(overlay).toContain("var(--ht-browser-error-fg)");
    expect(overlay).toContain("var(--ht-browser-error-bg)");
    expect(overlay).not.toMatch(/rgba\(239,\s*68,\s*68,\s*0\.95\)/);
    expect(overlay).not.toMatch(/rgba\(30,\s*30,\s*46,\s*0\.96\)/);
  });

  test("kbd-panel color flips from var(--fg, #e6f4f7) to var(--text-strong)", () => {
    const panel = matchRule(indexCss, ".kbd-panel");
    expect(panel).toContain("var(--text-strong)");
    expect(panel).not.toContain("#e6f4f7");
  });

  test("kbd-close + kbd-row .kbd-desc + kbd-footer use --text-dim", () => {
    const close = matchRule(indexCss, ".kbd-close");
    expect(close).toContain("var(--text-dim)");
    expect(close).not.toContain("#9aa");

    const closeHover = matchRule(indexCss, ".kbd-close:hover");
    expect(closeHover).toContain("var(--text-strong)");

    const desc = matchRule(indexCss, ".kbd-row .kbd-desc");
    expect(desc).toContain("var(--text-dim)");

    const footer = matchRule(indexCss, ".kbd-footer");
    expect(footer).toContain("var(--text-dim)");
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
