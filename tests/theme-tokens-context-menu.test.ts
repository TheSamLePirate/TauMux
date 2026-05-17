// P7 S29 — Cluster H second chunk: panel close button + panel content
// drop shadows + pane divider + surface context menu.
//
// 1 new token (--ht-context-menu-shadow) + heavy cross-component
// reuse: --ht-surface-bar-btn-fg (panel close), --ht-sem-error
// (close hover), --ht-panel-inline-shadow (image drop), --ht-notify-
// amber-soft (amber trace, 2% delta from 0.08→0.1), --ht-surface-bar-
// border (pane divider, 2% delta from 0.9→0.92), --ht-pm-close-
// border-hover (menu item hover + divider), --ht-ask-danger-banner-bg
// (danger hover), --ht-pm-kill-fg-hover (danger fg). ~10 literals
// migrated.

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

describe("theme-token migration — context menu + small reuses (P7 S29)", () => {
  test("--ht-context-menu-shadow is defined", () => {
    expect(tokens).toContain("--ht-context-menu-shadow:");
  });

  test(".panel-close-btn resting + hover use cross-component tokens", () => {
    const btn = matchRule(indexCss, ".panel-close-btn");
    expect(btn).toContain("var(--ht-surface-bar-btn-fg)");

    const hover = matchRule(indexCss, ".panel-close-btn:hover");
    expect(hover).toContain("var(--ht-sem-error)");
    expect(hover).not.toContain("#f87171");
  });

  test(".panel-content img|canvas drop-shadow reuses panel-inline-shadow + amber-soft", () => {
    // Multi-selector rule — grep instead.
    expect(indexCss).toMatch(
      /\.panel-content img,\s*\n\s*\.panel-content canvas\s*\{[^}]*drop-shadow\(0 14px 26px var\(--ht-panel-inline-shadow\)\)/,
    );
    expect(indexCss).toMatch(
      /\.panel-content img,\s*\n\s*\.panel-content canvas\s*\{[^}]*drop-shadow\(0 0 22px var\(--ht-notify-amber-soft\)\)/,
    );
  });

  test(".pane-divider bg reuses --ht-surface-bar-border", () => {
    const div = matchRule(indexCss, ".pane-divider");
    expect(div).toContain("var(--ht-surface-bar-border)");
  });

  test(".surface-context-menu shadow uses the new token", () => {
    const menu = matchRule(indexCss, ".surface-context-menu");
    expect(menu).toContain("var(--ht-context-menu-shadow)");
    expect(menu).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.5\)/);
  });

  test("context menu item hover + danger reuse cross-component tokens", () => {
    const hover = matchRule(indexCss, ".surface-context-menu-item:hover");
    expect(hover).toContain("var(--ht-pm-close-border-hover)");

    const danger = matchRule(
      indexCss,
      ".surface-context-menu-item-danger:hover",
    );
    expect(danger).toContain("var(--ht-ask-danger-banner-bg)");
    expect(danger).toContain("var(--ht-pm-kill-fg-hover)");

    const divider = matchRule(indexCss, ".surface-context-menu-divider");
    expect(divider).toContain("var(--ht-pm-close-border-hover)");
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
