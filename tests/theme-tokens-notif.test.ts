// P7 S19 — Cluster H continuation, notification overlay + sidebar
// notification item region.
//
// The .tau-notif-overlay-* top-right toast stack carried 5 literals
// (card bg-mix, card hover bg-mix, drop shadow, close hover bg,
// overflow chip bg). The sidebar .notification-item history list
// shared 3 more literals (zinc border, near-black bg, 1px inset
// highlight). Both regions migrated to a new --ht-notif-* token group
// (8 tokens). The -bg-mix tokens live inside CSS color-mix() so they
// carry the pre-mix fallback colour.

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
  "--ht-notif-card-bg-mix",
  "--ht-notif-card-bg-hover-mix",
  "--ht-notif-card-shadow",
  "--ht-notif-close-bg-hover",
  "--ht-notif-overflow-bg",
  "--ht-notif-sidebar-border",
  "--ht-notif-sidebar-bg",
  "--ht-notif-sidebar-inset",
];

describe("theme-token migration — notification overlay + sidebar (P7 S19)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("tau-notif-overlay-card uses the new tokens through color-mix()", () => {
    const card = matchRule(indexCss, ".tau-notif-overlay-card");
    expect(card).toContain("var(--ht-notif-card-bg-mix)");
    expect(card).toContain("var(--ht-notif-card-shadow)");
    expect(card).not.toMatch(/rgba\(20,\s*24,\s*30,\s*0\.92\)/);
    expect(card).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.45\)/);

    const hover = matchRule(indexCss, ".tau-notif-overlay-card:hover");
    expect(hover).toContain("var(--ht-notif-card-bg-hover-mix)");
    expect(hover).not.toMatch(/rgba\(28,\s*32,\s*38,\s*0\.95\)/);
  });

  test("tau-notif-overlay-close + overflow use the new tokens", () => {
    const closeHover = matchRule(indexCss, ".tau-notif-overlay-close:hover");
    expect(closeHover).toContain("var(--ht-notif-close-bg-hover)");

    const overflow = matchRule(indexCss, ".tau-notif-overlay-overflow");
    expect(overflow).toContain("var(--ht-notif-overflow-bg)");
    expect(overflow).not.toMatch(/rgba\(20,\s*24,\s*30,\s*0\.85\)/);

    const overflowHover = matchRule(
      indexCss,
      ".tau-notif-overlay-overflow:hover",
    );
    expect(overflowHover).toContain("var(--ht-notif-close-bg-hover)");
  });

  test("sidebar notification-item + log-item use the new sidebar tokens", () => {
    // Multi-selector rule — grep the whole block instead of matchRule.
    expect(indexCss).toMatch(
      /\.notification-item,\s*\n\s*\.log-item\s*\{[^}]*border:\s*1px solid var\(--ht-notif-sidebar-border\)/,
    );
    expect(indexCss).toMatch(
      /\.notification-item,\s*\n\s*\.log-item\s*\{[^}]*background:\s*var\(--ht-notif-sidebar-bg\)/,
    );
    expect(indexCss).toMatch(
      /\.notification-item,\s*\n\s*\.log-item\s*\{[^}]*var\(--ht-notif-sidebar-inset\)/,
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
