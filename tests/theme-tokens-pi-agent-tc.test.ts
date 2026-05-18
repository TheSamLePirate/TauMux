// P7 S42 chunk 2 — Cluster H, pi-agent code blocks + inline code +
// think blocks + tool-call panel (rest / run / err / ok / inline)
// + context-meter + footer + widget.
//
// 10 new --ht-agent-* tokens:
// - code-bg (0.5 black deep hold)
// - ic-border (cyan 0.06 — distinct from palette-divider-soft 0.14)
// - think-bg (amber 0.035 flat fill) + think-border-left (amber 0.25)
// - tc-bg (green 0.02 faint rest fill — distinct from --ht-badge-
//   success-bg 0.08 used as the border)
// - tc-run-bg (cyan 0.025)
// - tc-err-border (red 0.15) + tc-err-bg (red 0.025)
// - tc-body-bg (0.35 black mid hold) + footer-bg (0.15 black light)
//
// Reuses: --ht-badge-success-bg (rgba(74,222,128,0.08) exact for
// .agent-tc border), --ht-palette-divider-soft (cyan 0.14 ↔ 0.15
// 1pp for .agent-tc-run border), --ht-palette-divider (0.18 ↔ 0.2
// 2pp for context-fill glow), --ht-notify-cyan-soft (cyan 0.1 ↔
// 0.08 2pp for .agent-ic bg), --ht-notify-amber-soft (amber 0.1 ↔
// 0.08 2pp for .agent-think border), --ht-sidebar-filter-selected-
// shadow (0.28 ↔ 0.3 2pp for tc-inline-body bg), --ht-sem-success
// + --ht-sem-error (exact #4ade80/#f87171 across icons/diff/inline-
// hdr/bash-prompt).

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
  "--ht-agent-code-bg",
  "--ht-agent-ic-border",
  "--ht-agent-think-bg",
  "--ht-agent-think-border-left",
  "--ht-agent-tc-bg",
  "--ht-agent-tc-run-bg",
  "--ht-agent-tc-err-border",
  "--ht-agent-tc-err-bg",
  "--ht-agent-tc-body-bg",
  "--ht-agent-footer-bg",
];

describe("theme-token migration — pi-agent think/code/tool-call (P7 S42 chunk 2)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".agent-code uses code-bg + agent-row-bg-hover", () => {
    const rule = matchRule(indexCss, ".agent-code");
    expect(rule).toContain("var(--ht-agent-code-bg)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
  });

  test(".agent-code-lang reuses agent-row-bg-hover-card", () => {
    const rule = matchRule(indexCss, ".agent-code-lang");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
  });

  test(".agent-ic uses notify-cyan-soft + ic-border", () => {
    const rule = matchRule(indexCss, ".agent-ic");
    expect(rule).toContain("var(--ht-notify-cyan-soft)");
    expect(rule).toContain("var(--ht-agent-ic-border)");
  });

  test(".agent-think uses think-bg + notify-amber-soft + think-border-left", () => {
    const rule = matchRule(indexCss, ".agent-think");
    expect(rule).toContain("var(--ht-agent-think-bg)");
    expect(rule).toContain("var(--ht-notify-amber-soft)");
    expect(rule).toContain("var(--ht-agent-think-border-left)");
  });

  test(".agent-tc reuses badge-success-bg (border 0.08) + tc-bg (green 0.02)", () => {
    const rule = matchRule(indexCss, ".agent-tc");
    expect(rule).toContain("var(--ht-badge-success-bg)");
    expect(rule).toContain("var(--ht-agent-tc-bg)");
    expect(rule).not.toContain("rgba(74,222,128");
  });

  test(".agent-tc-run reuses palette-divider-soft + tc-run-bg", () => {
    const rule = matchRule(indexCss, ".agent-tc-run");
    expect(rule).toContain("var(--ht-palette-divider-soft)");
    expect(rule).toContain("var(--ht-agent-tc-run-bg)");
  });

  test(".agent-tc-err uses tc-err-border + tc-err-bg", () => {
    const rule = matchRule(indexCss, ".agent-tc-err");
    expect(rule).toContain("var(--ht-agent-tc-err-border)");
    expect(rule).toContain("var(--ht-agent-tc-err-bg)");
  });

  test("tc-icon err/ok reuse sem-error/sem-success", () => {
    expect(indexCss).toMatch(
      /\.agent-tc-err \.agent-tc-icon \{[^}]*var\(--ht-sem-error\)/,
    );
    expect(indexCss).toMatch(
      /\.agent-tc-ok \.agent-tc-icon \{[^}]*var\(--ht-sem-success\)/,
    );
  });

  test(".agent-tc-body uses tc-body-bg", () => {
    const rule = matchRule(indexCss, ".agent-tc-body");
    expect(rule).toContain("var(--ht-agent-tc-body-bg)");
  });

  test(".agent-diff-add/-del reuse sem-success/sem-error", () => {
    expect(indexCss).toMatch(/\.agent-diff-add \{[^}]*var\(--ht-sem-success\)/);
    expect(indexCss).toMatch(/\.agent-diff-del \{[^}]*var\(--ht-sem-error\)/);
  });

  test(".agent-tc-inline-* reuse sem-success/sem-error + filter-selected-shadow", () => {
    const hdr = matchRule(indexCss, ".agent-tc-inline-hdr");
    expect(hdr).toContain("var(--ht-sem-success)");

    const err = matchRule(indexCss, ".agent-tc-inline-err");
    expect(err).toContain("var(--ht-sem-error)");

    const body = matchRule(indexCss, ".agent-tc-inline-body");
    expect(body).toContain("var(--ht-sidebar-filter-selected-shadow)");
  });

  test(".agent-tool-action-btn uses panel-border-soft + package-header-bg-hover", () => {
    const rule = matchRule(indexCss, ".agent-tool-action-btn");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-package-header-bg-hover)");
  });

  test(".agent-bash-prompt reuses sem-success", () => {
    const rule = matchRule(indexCss, ".agent-bash-prompt");
    expect(rule).toContain("var(--ht-sem-success)");
  });

  test(".agent-context-meter uses agent-row-bg-hover-card; .agent-context-fill box-shadow uses palette-divider", () => {
    const meter = matchRule(indexCss, ".agent-context-meter");
    expect(meter).toContain("var(--ht-agent-row-bg-hover-card)");

    const fill = matchRule(indexCss, ".agent-context-fill");
    expect(fill).toContain("var(--ht-palette-divider)");
  });

  test(".agent-footer uses package-header-bg-hover + footer-bg", () => {
    const rule = matchRule(indexCss, ".agent-footer");
    expect(rule).toContain("var(--ht-package-header-bg-hover)");
    expect(rule).toContain("var(--ht-agent-footer-bg)");
  });

  test(".agent-widget uses panel-border-soft + sidebar-row-bg-stripe", () => {
    const rule = matchRule(indexCss, ".agent-widget");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-sidebar-row-bg-stripe)");
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
