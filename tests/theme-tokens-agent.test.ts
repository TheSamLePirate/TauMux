// P7 S13 — Cluster H continuation, agent panel region.
//
// The .agent-* rules carried 8 fine-tuned white-on-dark rgba literals
// (0.04 / 0.05 / 0.06 / 0.08 / 0.14) for hover backgrounds and the
// message scroller's webkit scrollbar thumb. Migrated to a new
// --ht-agent-* token group so a future palette swap can repaint the
// agent surface in one place — mirroring the ht-sidebar-* / ht-button-*
// migrations from S10 / S12.

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
  "--ht-agent-row-bg-hover",
  "--ht-agent-row-bg-hover-strong",
  "--ht-agent-row-bg-hover-card",
  "--ht-agent-row-bg-hover-bold",
  "--ht-agent-scrollbar-thumb",
  "--ht-agent-scrollbar-thumb-hover",
];

describe("theme-token migration — agent panel (P7 S13)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("agent toolbar / dropdown hover rules use the new tokens", () => {
    const sessionName = matchRule(indexCss, ".agent-session-name:hover");
    expect(sessionName).toContain("var(--ht-agent-row-bg-hover)");
    expect(sessionName).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.04\)/);

    const tbAction = matchRule(indexCss, ".agent-tb-action:hover");
    expect(tbAction).toContain("var(--ht-agent-row-bg-hover)");
    expect(tbAction).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.04\)/);

    const ddItem = matchRule(indexCss, ".agent-dd-item:hover");
    expect(ddItem).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(ddItem).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.06\)/);
  });

  test("agent dialog / slash-item rules use the new tokens", () => {
    const slash = matchRule(indexCss, ".agent-slash-item:hover");
    expect(slash).toContain("var(--ht-agent-row-bg-hover-strong)");

    const opt = matchRule(indexCss, ".agent-dialog-option:hover");
    expect(opt).toContain("var(--ht-agent-row-bg-hover-card)");

    const btn = matchRule(indexCss, ".agent-dialog-btn:hover");
    expect(btn).toContain("var(--ht-agent-row-bg-hover-bold)");
    expect(btn).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.08\)/);
  });

  test("agent message scrollbar uses the new tokens", () => {
    const thumb = matchRule(
      indexCss,
      ".agent-messages::-webkit-scrollbar-thumb",
    );
    expect(thumb).toContain("var(--ht-agent-scrollbar-thumb)");
    expect(thumb).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.08\)/);

    const thumbHover = matchRule(
      indexCss,
      ".agent-messages::-webkit-scrollbar-thumb:hover",
    );
    expect(thumbHover).toContain("var(--ht-agent-scrollbar-thumb-hover)");
    expect(thumbHover).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.14\)/);
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
