// P7 S33 chunk 1 — Cluster H, in-pane search-bar (Ctrl-F overlay)
// + the related settings-close-btn hover state. Both regions use
// the same #f87171 close-affordance red, so they were migrated
// together as a pure cross-component reuse pass — no new tokens.
//
// Reuses:
// - --ht-agent-row-bg-hover-card (0.06 white, exact) for the input bg
// - --ht-sidebar-filter-selected-bg-top (0.1 white, exact) for the
//   focused input bg
// - --ht-panel-border-soft (0.08 white, exact) for the btn:hover bg
// - --ht-sem-error (#f87171 exact in default dark theme) for the
//   search-bar close hover fg + settings close-btn hover fg
// - --ht-sem-error-tint (0.08 alpha vs the 0.1 literal — 2pp delta,
//   within the ≤3% harmonisation threshold) for the settings close-
//   btn hover bg

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const indexCss = readFileSync(
  join(repo, "src", "views", "terminal", "index.css"),
  "utf8",
);

describe("theme-token migration — search-bar + settings-close-btn (P7 S33 chunk 1)", () => {
  test(".search-bar-input uses agent-row-bg-hover-card", () => {
    const rule = matchRule(indexCss, ".search-bar-input");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
  });

  test(".search-bar-input:focus uses filter-selected-bg-top", () => {
    const rule = matchRule(indexCss, ".search-bar-input:focus");
    expect(rule).toContain("var(--ht-sidebar-filter-selected-bg-top)");
  });

  test(".search-bar-btn:hover uses panel-border-soft", () => {
    const rule = matchRule(indexCss, ".search-bar-btn:hover");
    expect(rule).toContain("var(--ht-panel-border-soft)");
  });

  test(".search-bar-close:hover uses sem-error", () => {
    const rule = matchRule(indexCss, ".search-bar-close:hover");
    expect(rule).toContain("var(--ht-sem-error)");
    expect(rule).not.toContain("#f87171");
  });

  test(".settings-close-btn:hover uses sem-error + sem-error-tint", () => {
    const rule = matchRule(indexCss, ".settings-close-btn:hover");
    expect(rule).toContain("var(--ht-sem-error)");
    expect(rule).toContain("var(--ht-sem-error-tint)");
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
