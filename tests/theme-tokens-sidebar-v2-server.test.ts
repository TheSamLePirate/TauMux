// P7 S35 chunk 2 — Cluster H, sidebar v2 footer server-dot status
// palette (online / starting / error / conflict).
//
// 5 new --ht-sidebar-v2-server-* tokens cover the 4 status glow
// alphas (online 0.55, starting 0.48, error 0.5, conflict 0.5) +
// the conflict orange fg (#fab387, no existing match). Reuses:
// - --ht-sidebar-filter-selected-shadow (rgba(0,0,0,0.28) exact) for
//   the footer bg — same value as the existing box-shadow alpha.
// - --ht-agent-row-bg-hover (0.04 white exact) for the pill hover.
// - --ht-badge-success-fg (#86efac exact) for the online dot.
// - --ht-sidebar-v2-log-warning-fg (#f9c84a exact) for the starting
//   dot — third reuse of this token (introduced S33, reused S34 for
//   the CPU stat, now S35 for the server pulse).
// - --ht-pm-kill-fg (#fca5a5 exact) for the error dot.

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
  "--ht-sidebar-v2-server-online-glow",
  "--ht-sidebar-v2-server-starting-glow",
  "--ht-sidebar-v2-server-error-glow",
  "--ht-sidebar-v2-server-conflict-fg",
  "--ht-sidebar-v2-server-conflict-glow",
];

describe("theme-token migration — sidebar v2 server-dot palette (P7 S35 chunk 2)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("sidebar-footer reuses filter-selected-shadow (same 0.28 black value)", () => {
    const rule = matchRule(indexCss, "#sidebar.sidebar-v2 .sidebar-footer");
    expect(rule).toContain("var(--ht-sidebar-filter-selected-shadow)");
    expect(rule).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.28\)/);
  });

  test("sidebar-server-pill:hover uses agent-row-bg-hover", () => {
    const rule = matchRule(
      indexCss,
      "#sidebar.sidebar-v2 .sidebar-server-pill:hover",
    );
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
  });

  test("server-dot.online uses badge-success-fg + online-glow", () => {
    const rule = matchRule(
      indexCss,
      "#sidebar.sidebar-v2 .sidebar-server-dot.online",
    );
    expect(rule).toContain("var(--ht-badge-success-fg)");
    expect(rule).toContain("var(--ht-sidebar-v2-server-online-glow)");
    expect(rule).not.toContain("#86efac");
  });

  test("server-dot.starting reuses S33 log-warning-fg + new starting-glow", () => {
    const rule = matchRule(
      indexCss,
      "#sidebar.sidebar-v2 .sidebar-server-dot.starting",
    );
    expect(rule).toContain("var(--ht-sidebar-v2-log-warning-fg)");
    expect(rule).toContain("var(--ht-sidebar-v2-server-starting-glow)");
    expect(rule).not.toContain("#f9c84a");
  });

  test("server-dot.error reuses pm-kill-fg + new error-glow", () => {
    const rule = matchRule(
      indexCss,
      "#sidebar.sidebar-v2 .sidebar-server-dot.error",
    );
    expect(rule).toContain("var(--ht-pm-kill-fg)");
    expect(rule).toContain("var(--ht-sidebar-v2-server-error-glow)");
    expect(rule).not.toContain("#fca5a5");
  });

  test("server-dot.conflict uses new conflict-fg + conflict-glow", () => {
    const rule = matchRule(
      indexCss,
      "#sidebar.sidebar-v2 .sidebar-server-dot.conflict",
    );
    expect(rule).toContain("var(--ht-sidebar-v2-server-conflict-fg)");
    expect(rule).toContain("var(--ht-sidebar-v2-server-conflict-glow)");
    expect(rule).not.toContain("#fab387");
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
