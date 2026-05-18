// P7 S33 chunk 2 — Cluster H, sidebar v2 log-item state colours +
// notification-dismiss hover tint.
//
// 4 new --ht-sidebar-v2-* tokens cover the denser amber (#f9c84a —
// distinct from --ht-log-warning-fg #facc15), the amber tint (0.04),
// the azure info (#8fbcff — not in the v1 palette), and the dismiss
// hover red tint (0.14 — between --ht-pm-kill-bg 0.08 and -bg-hover
// 0.22). Reuses: --ht-sem-error (#f87171 exact) for the error
// border, --ht-sem-error-tint (0.08 vs 0.06, 2pp delta) for the
// error bg, --ht-pm-kill-fg (#fca5a5 exact) for the error log-level
// fg + dismiss hover fg.

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
  "--ht-sidebar-v2-log-warning-fg",
  "--ht-sidebar-v2-log-warning-tint",
  "--ht-sidebar-v2-log-info-fg",
  "--ht-sidebar-v2-dismiss-hover-bg",
];

describe("theme-token migration — sidebar v2 log + dismiss (P7 S33 chunk 2)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("notification-dismiss:hover uses pm-kill-fg + dismiss-hover-bg", () => {
    const rule = matchRule(
      indexCss,
      "#sidebar.sidebar-v2 .notification-dismiss:hover",
    );
    expect(rule).toContain("var(--ht-pm-kill-fg)");
    expect(rule).toContain("var(--ht-sidebar-v2-dismiss-hover-bg)");
    expect(rule).not.toContain("#fca5a5");
  });

  test("log-item.error reuses sem-error + sem-error-tint", () => {
    const rule = matchRule(indexCss, "#sidebar.sidebar-v2 .log-item.error");
    expect(rule).toContain("var(--ht-sem-error)");
    expect(rule).toContain("var(--ht-sem-error-tint)");
    expect(rule).not.toContain("#f87171");
  });

  test("log-item.warning uses new warning fg + tint tokens", () => {
    const rule = matchRule(indexCss, "#sidebar.sidebar-v2 .log-item.warning");
    expect(rule).toContain("var(--ht-sidebar-v2-log-warning-fg)");
    expect(rule).toContain("var(--ht-sidebar-v2-log-warning-tint)");
    expect(rule).not.toContain("#f9c84a");
  });

  test("log-item.info uses info-fg token", () => {
    const rule = matchRule(indexCss, "#sidebar.sidebar-v2 .log-item.info");
    expect(rule).toContain("var(--ht-sidebar-v2-log-info-fg)");
    expect(rule).not.toContain("#8fbcff");
  });

  test("log-level inline rules use the same per-state tokens", () => {
    // Single-line selectors — grep across the file rather than match-rule.
    expect(indexCss).toMatch(
      /\.log-item\.error \.log-level \{\s*color:\s*var\(--ht-pm-kill-fg\)/,
    );
    expect(indexCss).toMatch(
      /\.log-item\.warning \.log-level \{\s*color:\s*var\(--ht-sidebar-v2-log-warning-fg\)/,
    );
    expect(indexCss).toMatch(
      /\.log-item\.info \.log-level \{\s*color:\s*var\(--ht-sidebar-v2-log-info-fg\)/,
    );
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
