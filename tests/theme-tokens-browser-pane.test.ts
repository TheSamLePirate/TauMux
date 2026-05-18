// P7 S41 chunk 1 — Cluster H, browser pane address bar / nav-btn /
// url-input / find bar / chip-domain / find-input / find-close.
//
// This is a pure-reuse pass with a twist: many of the literals were
// "dead fallbacks" inside `var(--name, <literal>)` calls where the
// named var IS defined elsewhere in the codebase. Stripping the
// dead fallback removes the literal without changing rendered
// output, since the var() resolves first. The audit then passes.
//
// Token names that were already defined (just had dead fallbacks
// stripped): --text-muted, --text-strong, --accent-primary,
// --bg-glass-strong, --border-soft.
// Token names that did NOT exist: --ansi-green (mapped to
// --ht-sem-success #4ade80 exact), --ansi-yellow (mapped to
// --ht-sem-warning #f59e0b exact).
// Raw white-alpha literals migrated: 0.08 → --ht-panel-border-soft,
// 0.06 → --ht-agent-row-bg-hover-card, 0.04 → --ht-agent-row-bg-
// hover. Zero new tokens needed.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const indexCss = readFileSync(
  join(repo, "src", "views", "terminal", "index.css"),
  "utf8",
);

describe("theme-token migration — browser pane (P7 S41 chunk 1)", () => {
  test(".browser-address-bar uses border-soft (fallback stripped)", () => {
    const rule = matchRule(indexCss, ".surface-browser .browser-address-bar");
    expect(rule).toContain("var(--border-soft)");
    expect(rule).not.toMatch(/var\(--border-soft,\s*rgba/);
  });

  test(".browser-nav-btn rest uses text-muted (fallback stripped)", () => {
    const rule = matchRule(indexCss, ".browser-nav-btn");
    expect(rule).toContain("var(--text-muted)");
    expect(rule).not.toMatch(/var\(--text-muted,\s*rgba/);
  });

  test(".browser-nav-btn:hover uses panel-border-soft + text-strong", () => {
    const rule = matchRule(indexCss, ".browser-nav-btn:hover:not(:disabled)");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--text-strong)");
    expect(rule).not.toMatch(/var\(--text-strong,\s*#/);
  });

  test(".browser-lock-secure/-insecure use sem-success/sem-warning", () => {
    const secure = matchRule(indexCss, ".browser-lock-secure");
    expect(secure).toContain("var(--ht-sem-success)");
    expect(secure).not.toContain("#4ade80");

    const insecure = matchRule(indexCss, ".browser-lock-insecure");
    expect(insecure).toContain("var(--ht-sem-warning)");
    expect(insecure).not.toContain("#f59e0b");
  });

  test(".browser-url-input uses panel-border-soft + agent-row-bg-hover + text-strong", () => {
    const rule = matchRule(indexCss, ".browser-url-input");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
    expect(rule).toContain("var(--text-strong)");
  });

  test(".browser-url-input:focus uses accent-primary + agent-row-bg-hover-card", () => {
    const rule = matchRule(indexCss, ".browser-url-input:focus");
    expect(rule).toContain("var(--accent-primary)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rule).not.toMatch(/var\(--accent-primary,\s*#/);
  });

  test(".browser-url-input::placeholder uses text-muted (fallback stripped)", () => {
    const rule = matchRule(indexCss, ".browser-url-input::placeholder");
    expect(rule).toContain("var(--text-muted)");
    expect(rule).not.toMatch(/var\(--text-muted,\s*rgba/);
  });

  test(".chip-domain uses agent-row-bg-hover-card + text-muted", () => {
    const rule = matchRule(indexCss, ".chip-domain");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rule).toContain("var(--text-muted)");
  });

  test(".browser-find-bar uses bg-glass-strong + agent-row-bg-hover-card", () => {
    const rule = matchRule(indexCss, ".browser-find-bar");
    expect(rule).toContain("var(--bg-glass-strong)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rule).not.toMatch(/var\(--bg-glass-strong,\s*rgba/);
  });

  test(".browser-find-input uses panel-border-soft + agent-row-bg-hover + text-strong", () => {
    const rule = matchRule(indexCss, ".browser-find-input");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
    expect(rule).toContain("var(--text-strong)");
  });

  test(".browser-find-close + :hover use text-muted + panel-border-soft + text-strong", () => {
    const rest = matchRule(indexCss, ".browser-find-close");
    expect(rest).toContain("var(--text-muted)");

    const hover = matchRule(indexCss, ".browser-find-close:hover");
    expect(hover).toContain("var(--ht-panel-border-soft)");
    expect(hover).toContain("var(--text-strong)");
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
