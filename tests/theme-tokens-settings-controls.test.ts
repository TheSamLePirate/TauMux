// P7 S34 chunk 1 — Cluster H, settings panel form controls
// (toggle, segmented control, color swatch, field-group divider,
// action btn, reset btn).
//
// 1 new --ht-on-accent-fg token (#000) — the foreground that paints
// labels sitting on top of an --accent-primary fill (segmented
// "active" state). Everything else collapses onto existing white-
// alpha tokens (--ht-sidebar-filter-selected-bg-top, --ht-panel-
// border-soft, --ht-agent-row-bg-hover-card, --ht-package-bg,
// --ht-pm-surface-divider, --ht-text-strong) and the existing
// red-tint family (--ht-pm-kill-bg, --ht-sem-error, --ht-pm-kill-
// border). 17 literals migrated.

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

describe("theme-token migration — settings panel form controls (P7 S34 chunk 1)", () => {
  test("token --ht-on-accent-fg is defined", () => {
    expect(tokens).toContain("--ht-on-accent-fg:");
  });

  test(".settings-toggle-slider uses filter-selected-bg-top", () => {
    const rule = matchRule(indexCss, ".settings-toggle-slider");
    expect(rule).toContain("var(--ht-sidebar-filter-selected-bg-top)");
  });

  test(".settings-toggle ::after checked uses text-strong", () => {
    const rule = matchRule(
      indexCss,
      ".settings-toggle input:checked + .settings-toggle-slider::after",
    );
    expect(rule).toContain("var(--ht-text-strong)");
    expect(rule).not.toContain("#fff");
  });

  test(".settings-segmented uses panel-border-soft", () => {
    const rule = matchRule(indexCss, ".settings-segmented");
    expect(rule).toContain("var(--ht-panel-border-soft)");
  });

  test(".settings-segment uses package-bg + agent-row-bg-hover-card", () => {
    const rule = matchRule(indexCss, ".settings-segment");
    expect(rule).toContain("var(--ht-package-bg)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
  });

  test(".settings-segment:hover uses agent-row-bg-hover-card", () => {
    const rule = matchRule(indexCss, ".settings-segment:hover");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
  });

  test(".settings-segment.active uses on-accent-fg", () => {
    const rule = matchRule(indexCss, ".settings-segment.active");
    expect(rule).toContain("var(--ht-on-accent-fg)");
    expect(rule).not.toMatch(/color:\s*#000/);
  });

  test(".settings-color-swatch uses filter-selected-bg-top", () => {
    const rule = matchRule(indexCss, ".settings-color-swatch");
    expect(rule).toContain("var(--ht-sidebar-filter-selected-bg-top)");
  });

  test(".settings-field-group uses pm-surface-divider", () => {
    const rule = matchRule(indexCss, ".settings-field-group");
    expect(rule).toContain("var(--ht-pm-surface-divider)");
  });

  test(".settings-action-btn + hover use agent-row-bg-hover-card + package-bg", () => {
    const rest = matchRule(indexCss, ".settings-action-btn");
    expect(rest).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rest).toContain("var(--ht-package-bg)");

    const hover = matchRule(indexCss, ".settings-action-btn:hover");
    expect(hover).toContain("var(--ht-agent-row-bg-hover-card)");
  });

  test(".settings-reset-btn:hover unifies on pm-kill-bg + sem-error + pm-kill-border", () => {
    const rest = matchRule(indexCss, ".settings-reset-btn");
    expect(rest).toContain("var(--ht-package-bg)");

    const hover = matchRule(indexCss, ".settings-reset-btn:hover");
    expect(hover).toContain("var(--ht-pm-kill-bg)");
    expect(hover).toContain("var(--ht-sem-error)");
    expect(hover).toContain("var(--ht-pm-kill-border)");
    expect(hover).not.toContain("#f87171");
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
