// P7 S36 chunk 1 — Cluster H, t3code window-theme override block.
// A pure cross-component reuse pass — zero new tokens. 13 literals
// collapse onto the existing white-alpha vocabulary:
// - --ht-chip-bg (0.05): workspace-item hover + settings-nav-item /
//   theme-card / palette-item / surface-context-menu hover
// - --ht-agent-row-bg-hover (0.04): surface-chip + settings/prompt/
//   search-bar/palette-footer input bg
// - --ht-package-bg (0.02): panel header bg + color-mix nested
// - --ht-package-header-bg-hover (0.03): color-mix nested @ 3 sites
//   (workspace.active, surface-chip command, settings-nav active)
// - --ht-sidebar-row-bg-stripe (0.025): table th + color-mix nested
// - --ht-button-bg-hover-fallback (0.07): pane-divider
// - --ht-panel-border-soft (0.08): pane-divider:hover color-mix
//
// Most of these selectors appear earlier in the file with their
// base styling — the t3 override block sits below a "t3code-style"
// marker comment. Tests scope assertions to the file region after
// that marker via a one-shot substring slice.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const indexCss = readFileSync(
  join(repo, "src", "views", "terminal", "index.css"),
  "utf8",
);

// Scope all assertions to the t3 override block: everything between
// the "Phase 5 window-frame" comment near line 6240 and the next
// :root override below (line ~6494). matchRuleAfter takes a haystack
// offset and finds the first rule with that selector at-or-after it.
const T3_BLOCK_MARK = "/* Final alignment: exact t3code-style dark shell";
const t3End = indexCss.indexOf(T3_BLOCK_MARK);
if (t3End < 0) throw new Error("t3 block marker not found");
// First #titlebar { in the file is the base, we want the one inside
// the t3 override block — find the LAST occurrence before the marker.
const t3Start = indexCss.lastIndexOf("#titlebar {", t3End);
if (t3Start < 0) throw new Error("t3 block start (#titlebar) not found");
const t3Block = indexCss.slice(t3Start, t3End);

describe("theme-token migration — t3 window override pure-reuse (P7 S36 chunk 1)", () => {
  test(".workspace-item:hover (t3 override) uses chip-bg", () => {
    const rule = matchRule(t3Block, ".workspace-item:hover");
    expect(rule).toContain("var(--ht-chip-bg)");
  });

  test(".workspace-item.active (t3 override) color-mix uses package-header-bg-hover", () => {
    const rule = matchRule(t3Block, ".workspace-item.active");
    expect(rule).toContain("var(--ht-package-header-bg-hover)");
  });

  test(".surface-chip (t3 override) uses agent-row-bg-hover", () => {
    const rule = matchRule(t3Block, ".surface-chip");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
  });

  test(".surface-chip.chip-command (t3 override) color-mix reuses package-header-bg-hover", () => {
    expect(t3Block).toMatch(
      /\.surface-chip\.chip-command,\s*\n\.workspace-meta-fg \{[^}]*var\(--ht-package-header-bg-hover\)/,
    );
  });

  test(".pane-divider + hover (t3 override) reuse button-bg-hover-fallback + panel-border-soft", () => {
    const rest = matchRule(t3Block, ".pane-divider");
    expect(rest).toContain("var(--ht-button-bg-hover-fallback)");

    const hover = matchRule(t3Block, ".pane-divider:hover");
    expect(hover).toContain("var(--ht-panel-border-soft)");
  });

  test(".settings-nav-item.active (t3 override) color-mix reuses package-header-bg-hover", () => {
    const rule = matchRule(t3Block, ".settings-nav-item.active");
    expect(rule).toContain("var(--ht-package-header-bg-hover)");
  });

  test("settings-input multi-selector (t3 override) uses agent-row-bg-hover", () => {
    expect(t3Block).toMatch(
      /\.settings-input,\s*\n\.settings-segmented,[^{}]*\{[^}]*var\(--ht-agent-row-bg-hover\)/,
    );
  });

  test("process-manager-table th + surface-details-table th (t3 override) use sidebar-row-bg-stripe", () => {
    expect(t3Block).toMatch(
      /\.process-manager-table th,\s*\n\.surface-details-table th \{[^}]*var\(--ht-sidebar-row-bg-stripe\)/,
    );
  });

  test(".titlebar-info-primary color-mix reuses sidebar-row-bg-stripe", () => {
    const rule = matchRule(t3Block, ".titlebar-info-primary");
    expect(rule).toContain("var(--ht-sidebar-row-bg-stripe)");
  });

  test("titlebar toolbar-icon-btn hover (t3 override) color-mix reuses package-bg", () => {
    expect(t3Block).toMatch(
      /#titlebar \.toolbar-icon-btn:hover,\s*\n#titlebar \.toolbar-icon-btn\.active \{[^}]*var\(--ht-package-bg\)/,
    );
  });

  test("panel header multi-selector (t3 override) uses package-bg", () => {
    expect(t3Block).toMatch(
      /\.process-manager-header,\s*\n\.surface-details-header,\s*\n\.settings-header,\s*\n\.palette-input-row \{[^}]*var\(--ht-package-bg\)/,
    );
  });

  test("settings-nav-item hover group (t3 override) uses chip-bg", () => {
    expect(t3Block).toMatch(
      /\.settings-nav-item:hover,\s*\n\.theme-card:hover,[^{}]*\{[^}]*var\(--ht-chip-bg\)/,
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
