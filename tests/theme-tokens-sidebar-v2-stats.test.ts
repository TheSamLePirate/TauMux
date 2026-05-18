// P7 S34 chunk 2 — Cluster H, sidebar v2 global stats row (CPU /
// MEM / PROC / PORT chips) + the filter-btn hover bg.
//
// 2 new --ht-sidebar-v2-* tokens: --stat-proc-fg (#c89aff, purple)
// and --global-stats-bg (rgba(0, 0, 0, 0.1) — black-hold bg with no
// near-match in the existing token set; the black-alpha family is
// sparse compared to the white-alpha family). The CPU + MEM chips
// reuse --ht-sidebar-v2-log-warning-fg + -info-fg from S33 — same
// shades, same context (the v2 sidebar palette). PORT reuses
// --ht-badge-success-fg (#86efac exact). filter-btn hover bg
// reuses --ht-agent-row-bg-hover (0.04 white exact).

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
  "--ht-sidebar-v2-stat-proc-fg",
  "--ht-sidebar-v2-global-stats-bg",
];

describe("theme-token migration — sidebar v2 global stats (P7 S34 chunk 2)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("sidebar-filter-btn:hover uses agent-row-bg-hover", () => {
    const rule = matchRule(
      indexCss,
      "#sidebar.sidebar-v2 .sidebar-filter-btn:hover",
    );
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
  });

  test("sidebar-global-stats uses global-stats-bg token", () => {
    const rule = matchRule(
      indexCss,
      "#sidebar.sidebar-v2 .sidebar-global-stats",
    );
    expect(rule).toContain("var(--ht-sidebar-v2-global-stats-bg)");
  });

  test("stat-cpu reuses S33 log-warning-fg (#f9c84a)", () => {
    expect(indexCss).toMatch(
      /\.sidebar-global-stat\.stat-cpu \{\s*color:\s*var\(--ht-sidebar-v2-log-warning-fg\)/,
    );
  });

  test("stat-mem reuses S33 log-info-fg (#8fbcff)", () => {
    const rule = matchRule(
      indexCss,
      "#sidebar.sidebar-v2 .sidebar-global-stat.stat-mem",
    );
    expect(rule).toContain("var(--ht-sidebar-v2-log-info-fg)");
    expect(rule).not.toContain("#8fbcff");
  });

  test("stat-proc uses new stat-proc-fg token", () => {
    const rule = matchRule(
      indexCss,
      "#sidebar.sidebar-v2 .sidebar-global-stat.stat-proc",
    );
    expect(rule).toContain("var(--ht-sidebar-v2-stat-proc-fg)");
    expect(rule).not.toContain("#c89aff");
  });

  test("stat-port reuses badge-success-fg (#86efac)", () => {
    const rule = matchRule(
      indexCss,
      "#sidebar.sidebar-v2 .sidebar-global-stat.stat-port",
    );
    expect(rule).toContain("var(--ht-badge-success-fg)");
    expect(rule).not.toContain("#86efac");
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
