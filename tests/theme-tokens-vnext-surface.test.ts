// P7 S38 chunk 1 — Cluster H, vNext surface-container / surface-bar /
// surface-chip overrides (the "second-pass" surface chrome between
// the base styles and the t3 override block).
//
// 5 new --ht-vnext-* tokens:
// - surface-bg (0.84) + surface-shadow (0.26 black) + surface-bar-bg
//   (0.92) — the surface-card's own shell, slightly cooler / less
//   opaque than the --ht-window-* outer-frame family. The two
//   coexist deliberately (card-inside-frame).
// - text-soft (0.74) + text-soft-2 (0.68) — fill the holes between
//   text-muted (0.58) and text-bright (0.88) in the vNext brightness
//   ladder; used for surface-bar-title and surface-chip body labels.
//
// Reuses: --ht-panel-border-soft, --ht-chip-bg, --ht-agent-row-bg-
// hover[-card], --ht-vnext-text-mute (rest fg, exact + 2pp 0.5
// harmonisation), --ht-vnext-text-muted (chip-cwd), --ht-sidebar-
// text-strong (focused bar title + bar-btn hover fg, 0.96 → 0.98
// 2pp harmonisation).

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
  "--ht-vnext-surface-bg",
  "--ht-vnext-surface-shadow",
  "--ht-vnext-surface-bar-bg",
  "--ht-vnext-text-soft",
  "--ht-vnext-text-soft-2",
];

// Scope to the vNext "second-pass" surface block. There are 6
// `.surface-container {` rules in the file (base, vNext, an
// intermediate ws-density override, t3 override, and two more
// further down). The vNext one is the SECOND occurrence. We bound
// its end at the THIRD occurrence so unrelated overrides further
// down don't shadow the assertions.
const allMatches: number[] = [];
let off = 0;
while (off < indexCss.length) {
  const i = indexCss.indexOf(".surface-container {", off);
  if (i < 0) break;
  allMatches.push(i);
  off = i + 1;
}
if (allMatches.length < 3) {
  throw new Error("expected ≥3 .surface-container { rules");
}
const vStart = allMatches[1];
const vEnd = allMatches[2];
const vBlock = indexCss.slice(vStart, vEnd);

describe("theme-token migration — vNext surface-container/bar/chip (P7 S38 chunk 1)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".surface-container (vNext) uses panel-border-soft + surface-bg + chip-bg + surface-shadow", () => {
    const rule = matchRule(vBlock, ".surface-container");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-vnext-surface-bg)");
    expect(rule).toContain("var(--ht-chip-bg)");
    expect(rule).toContain("var(--ht-vnext-surface-shadow)");
  });

  test(".surface-bar (vNext) uses surface-bar-bg + agent-row-bg-hover-card + vnext-text-mute", () => {
    const rule = matchRule(vBlock, ".surface-bar");
    expect(rule).toContain("var(--ht-vnext-surface-bar-bg)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rule).toContain("var(--ht-vnext-text-mute)");
  });

  test(".surface-container.focused .surface-bar reuses agent-row-bg-hover[-card] inside color-mix + inset", () => {
    const rule = matchRule(vBlock, ".surface-container.focused .surface-bar");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
  });

  test(".surface-bar-title uses vnext-text-soft", () => {
    const rule = matchRule(vBlock, ".surface-bar-title");
    expect(rule).toContain("var(--ht-vnext-text-soft)");
  });

  test(".surface-container.focused .surface-bar-title reuses sidebar-text-strong (0.96 → 0.98)", () => {
    const rule = matchRule(
      vBlock,
      ".surface-container.focused .surface-bar-title",
    );
    expect(rule).toContain("var(--ht-sidebar-text-strong)");
  });

  test(".surface-chip uses chip-bg + vnext-text-soft-2 + agent-row-bg-hover-card", () => {
    const rule = matchRule(vBlock, ".surface-chip");
    expect(rule).toContain("var(--ht-chip-bg)");
    expect(rule).toContain("var(--ht-vnext-text-soft-2)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
  });

  test(".surface-chip.chip-cwd reuses vnext-text-muted (S37 token)", () => {
    const rule = matchRule(vBlock, ".surface-chip.chip-cwd");
    expect(rule).toContain("var(--ht-vnext-text-muted)");
  });

  test(".surface-bar-btn rest + hover use vnext-text-mute + sidebar-text-strong + chip-bg", () => {
    const rest = matchRule(vBlock, ".surface-bar-btn");
    expect(rest).toContain("var(--ht-vnext-text-mute)");

    const hover = matchRule(vBlock, ".surface-bar-btn:hover");
    expect(hover).toContain("var(--ht-sidebar-text-strong)");
    expect(hover).toContain("var(--ht-chip-bg)");
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
