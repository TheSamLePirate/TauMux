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
    expect(tokens).toContain("--ht-ask-sheet-bg: #1e2a35");
    expect(tokens).not.toContain("--ht-ask-sheet-bg: rgba");

    const sheet = matchRule(indexCss, ".ask-user-sheet");
    expect(sheet).toContain("var(--ht-ask-sheet-bg)");
    expect(sheet).toContain("var(--ht-ask-sheet-border)");
    expect(sheet).toContain("var(--ht-ask-sheet-shadow)");
  });

  // Rewritten alongside the z-index scale. The assertion used to be
  // `z > 2147483000`, which pinned the *implementation* (a near-max int)
  // rather than the requirement. The requirement is an ordering: a
  // blocking human-in-the-loop prompt must out-stack the ordinary modals.
  //
  // Ask-user now sits on --z-modal-nested, and the ordering is checked
  // against the scale itself so this test fails if someone renumbers a
  // layer without thinking about ask-user.
  test("ask-user overlay sits above palette/settings", () => {
    const overlay = matchRule(indexCss, ".ask-user-overlay");
    expect(overlay).toContain("z-index: var(--z-modal-nested)");

    const scale = matchRule(indexCss, ":root");
    const layer = (name: string): number => {
      const raw = new RegExp(`--z-${name}:\\s*(\\d+);`).exec(scale)?.[1];
      expect(raw).toBeDefined();
      return Number(raw);
    };

    // Ask-user's layer must beat the layer the palette and settings use.
    expect(layer("modal-nested")).toBeGreaterThan(layer("modal"));
    expect(matchRule(indexCss, ".palette-overlay")).toContain(
      "z-index: var(--z-modal)",
    );
    expect(matchRule(indexCss, ".settings-overlay")).toContain(
      "z-index: var(--z-modal)",
    );
  });

  // Every overlay draws its stacking from the scale rather than from a
  // hand-picked literal. Before this, the overlays used 200 / 210 / 1800 /
  // 1900 / 1900 / 2000 / 2010 / 10000 / 2147483600 — which contained a
  // genuine tie (.settings-overlay and .surface-context-menu both at
  // 1900, so paint order decided) and left the Process Manager and Pane
  // Info panels at 200/210, below every other modal in the app.
  test("all modal overlays stack via the z-index scale", () => {
    const overlays = [
      ".process-manager-overlay",
      ".surface-details-overlay",
      ".prompt-overlay",
      ".settings-overlay",
      ".palette-overlay",
      ".kbd-cheatsheet",
      ".ask-user-overlay",
      ".surface-context-menu",
      ".toast-container",
    ];
    for (const sel of overlays) {
      const rule = matchRule(indexCss, sel);
      expect(rule, `${sel} should use a --z-* token`).toMatch(
        /z-index:\s*var\(--z-[a-z-]+\)/,
      );
    }
  });

  // Toasts are the one thing allowed above a modal: they are transient
  // and never take focus. Everything else must sit below the modals.
  test("toasts stay above modals; chrome stays below them", () => {
    const scale = matchRule(indexCss, ":root");
    const layer = (name: string): number => {
      const raw = new RegExp(`--z-${name}:\\s*(\\d+);`).exec(scale)?.[1];
      expect(raw, `--z-${name} should be defined`).toBeDefined();
      return Number(raw);
    };
    expect(layer("toast")).toBeGreaterThan(layer("modal-nested"));
    expect(layer("modal")).toBeGreaterThan(layer("titlebar"));
    expect(layer("titlebar")).toBeGreaterThan(layer("sidebar"));
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
