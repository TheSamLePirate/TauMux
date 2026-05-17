// P7 S27 — Cluster H, workspace card item + notify-bar-flash region.
//
// 4 new tokens + 2 cross-component reuses (--ht-button-fg-hover for
// the active workspace name, --ht-sem-error for the close-button
// hover red, --ht-notify-cyan-glow for the keyframe's cyan stop —
// already defined). 9 literals migrated across workspace card name
// + dot shadows + close-hover + notify-bar-flash 4-stop keyframe.

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
  "--ht-workspace-name-fg",
  "--ht-workspace-dot-shadow",
  "--ht-surface-bar-notify-rest",
  "--ht-notify-amber-flash",
];

describe("theme-token migration — workspace card item (P7 S27)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("workspace-dot shadow uses the new token (both resting + active states)", () => {
    const dot = matchRule(indexCss, ".workspace-dot");
    expect(dot).toContain("var(--ht-workspace-dot-shadow)");
    expect(dot).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.2\)/);

    const dotActive = matchRule(
      indexCss,
      ".workspace-item.active .workspace-dot",
    );
    expect(dotActive).toContain("var(--ht-workspace-dot-shadow)");
  });

  test("workspace-name uses the new fg token; active state reuses --ht-button-fg-hover", () => {
    const name = matchRule(indexCss, ".workspace-name");
    expect(name).toContain("var(--ht-workspace-name-fg)");
    expect(name).not.toMatch(/rgba\(229,\s*231,\s*237,\s*0\.78\)/);

    const active = matchRule(
      indexCss,
      ".workspace-item.active .workspace-name",
    );
    expect(active).toContain("var(--ht-button-fg-hover)");
  });

  test("workspace-close:hover reuses --ht-sem-error", () => {
    const close = matchRule(indexCss, ".workspace-close:hover");
    expect(close).toContain("var(--ht-sem-error)");
    expect(close).not.toContain("#f87171");
  });

  test("notify-bar-flash keyframe uses --ht-surface-bar-notify-rest + amber-flash + cyan-glow", () => {
    // Keyframe rules don't fit matchRule (multiple `0% / 12% / …`
    // selectors inside a single `@keyframes` block); grep the raw
    // file for the migrated stops.
    expect(indexCss).toMatch(
      /0% \{ background: var\(--ht-surface-bar-notify-rest\); \}/,
    );
    expect(indexCss).toMatch(
      /12% \{ background: var\(--ht-notify-amber-flash\); \}/,
    );
    expect(indexCss).toMatch(
      /40% \{ background: var\(--ht-notify-cyan-glow\); \}/,
    );
    expect(indexCss).toMatch(
      /100% \{ background: var\(--ht-surface-bar-notify-rest\); \}/,
    );
    // Scope the negative check to the keyframe block only — the
    // 0.15 amber alpha also appears in an unrelated chip rule that's
    // not part of this migration's scope.
    const keyframe = indexCss.slice(
      indexCss.indexOf("@keyframes notify-bar-flash"),
      indexCss.indexOf("@keyframes notify-bar-flash") + 400,
    );
    expect(keyframe).not.toMatch(/rgba\(14,\s*18,\s*27/);
    expect(keyframe).not.toMatch(/rgba\(255,\s*197,\s*107,\s*0\.15\)/);
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
