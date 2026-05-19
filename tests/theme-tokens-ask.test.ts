// P7 S17 — Cluster H continuation, ask-user modal + workspace ask
// badge region.
//
// The .ask-user-* rules + the sidebar .workspace-ask-badge share a
// trust-boundary visual identity (cyan modal accent + danger-red
// banner / button family). 17 literals migrated to a new --ht-ask-*
// token group (14 tokens) so a future palette swap can repaint the
// modal in one place — mirroring the ht-palette-* migration from S16.

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
  "--ht-ask-scrim-bg",
  "--ht-ask-sheet-bg",
  "--ht-ask-sheet-border",
  "--ht-ask-sheet-shadow",
  "--ht-ask-codebox-bg",
  "--ht-ask-codebox-border",
  "--ht-ask-danger-bg",
  "--ht-ask-danger-fg",
  "--ht-ask-danger-banner-bg",
  "--ht-ask-danger-banner-fg",
  "--ht-ask-danger-banner-border",
  "--ht-ask-badge-bg",
  "--ht-ask-badge-border",
  "--ht-ask-badge-fg",
];

describe("theme-token migration — ask-user modal + workspace badge (P7 S17)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("ask-user overlay + sheet chrome use the new tokens", () => {
    const overlay = matchRule(indexCss, ".ask-user-overlay");
    expect(overlay).toContain("var(--ht-ask-scrim-bg)");
    expect(overlay).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.42\)/);
    expect(tokens).toContain("--ht-ask-scrim-bg: rgba(0, 0, 0, 0.86)");
    expect(tokens).toContain("--ht-ask-sheet-bg: #0f161a");
    expect(tokens).not.toContain("--ht-ask-sheet-bg: rgba");

    const sheet = matchRule(indexCss, ".ask-user-sheet");
    expect(sheet).toContain("var(--ht-ask-sheet-bg)");
    expect(sheet).toContain("var(--ht-ask-sheet-border)");
    expect(sheet).toContain("var(--ht-ask-sheet-shadow)");
  });

  test("ask-user overlay sits above palette/settings and notification rings", () => {
    const overlay = matchRule(indexCss, ".ask-user-overlay");
    const z = /z-index:\s*(\d+)/.exec(overlay)?.[1];
    expect(z).toBeDefined();
    expect(Number(z)).toBeGreaterThan(2147483000);
  });

  test("ask-user overlay is visible by default to avoid rAF transparency races", () => {
    const overlay = matchRule(indexCss, ".ask-user-overlay");
    expect(overlay).toContain("opacity: 1");
  });

  test("ask-user codebox uses the new tokens", () => {
    const code = matchRule(indexCss, ".ask-user-codebox");
    expect(code).toContain("var(--ht-ask-codebox-bg)");
    expect(code).toContain("var(--ht-ask-codebox-border)");
  });

  test("ask-user danger banner + danger button use the new tokens", () => {
    const banner = matchRule(indexCss, ".ask-user-unsafe-banner");
    expect(banner).toContain("var(--ht-ask-danger-banner-bg)");
    expect(banner).toContain("var(--ht-ask-danger-banner-fg)");
    expect(banner).toContain("var(--ht-ask-danger-banner-border)");

    const danger = matchRule(indexCss, ".ask-user-btn-danger");
    expect(danger).toContain("var(--ht-ask-danger-bg)");
    expect(danger).toContain("var(--ht-ask-danger-fg)");
    expect(danger).not.toContain("#18020a");
  });

  test("workspace-ask-badge uses the new tokens", () => {
    const badge = matchRule(indexCss, ".workspace-ask-badge");
    expect(badge).toContain("var(--ht-ask-badge-bg)");
    expect(badge).toContain("var(--ht-ask-badge-border)");
    expect(badge).toContain("var(--ht-ask-badge-fg)");
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
