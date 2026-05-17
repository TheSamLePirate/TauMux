// P7 S26 — Cluster H, workspace port chip + script-run state colours.
//
// The .workspace-port-chip rule was the third "success-tinted
// interactive chip" in the codebase (surface-chip.chip-port from S19
// being the first migration; PM .chip-port also lives in the same
// visual family). This session harmonises the port chip's success
// alphas onto the existing --ht-badge-success-* family — the literal
// values differed by <2% from the badge tokens, well below the
// perceptual threshold. Zero new tokens; pure cross-component
// reuse. Also reuses --ht-pm-kill-fg for the workspace-script-btn
// error state colour + --ht-pm-card-border for the workspace-status
// divider.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const indexCss = readFileSync(
  join(repo, "src", "views", "terminal", "index.css"),
  "utf8",
);

describe("theme-token migration — workspace port chip (P7 S26)", () => {
  test("workspace-port-chip resting reuses the success badge family", () => {
    const chip = matchRule(indexCss, ".workspace-port-chip");
    expect(chip).toContain("var(--ht-badge-success-fg)");
    expect(chip).toContain("var(--ht-badge-success-bg)");
    expect(chip).toContain("var(--ht-badge-success-border)");
    expect(chip).not.toContain("#86efac");
    expect(chip).not.toMatch(/rgba\(74,\s*222,\s*128/);
  });

  test("workspace-port-chip hover/focus reuses the success-hover tokens", () => {
    // Multi-selector rule — grep the whole block.
    expect(indexCss).toMatch(
      /\.workspace-port-chip:hover,\s*\n\s*\.workspace-port-chip:focus-visible\s*\{[^}]*background:\s*var\(--ht-badge-success-bg-hover\)/,
    );
    expect(indexCss).toMatch(
      /\.workspace-port-chip:hover,\s*\n\s*\.workspace-port-chip:focus-visible\s*\{[^}]*border-color:\s*var\(--ht-badge-success-border-hover\)/,
    );
    expect(indexCss).toMatch(
      /\.workspace-port-chip:hover,\s*\n\s*\.workspace-port-chip:focus-visible\s*\{[^}]*color:\s*var\(--ht-badge-success-fg-hover\)/,
    );
  });

  test("workspace-script-btn state colours reuse cross-component tokens", () => {
    const running = matchRule(
      indexCss,
      '.workspace-script-btn[data-state="running"] .workspace-script-run',
    );
    expect(running).toContain("var(--ht-badge-success-fg)");

    const errored = matchRule(
      indexCss,
      '.workspace-script-btn[data-state="error"] .workspace-script-run',
    );
    expect(errored).toContain("var(--ht-pm-kill-fg)");
    expect(errored).not.toContain("#fca5a5");
  });

  test("workspace-status top divider reuses --ht-pm-card-border", () => {
    const status = matchRule(indexCss, ".workspace-status");
    expect(status).toContain("var(--ht-pm-card-border)");
    expect(status).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.05\)/);
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
