// P7 S23 — Cluster H continuation, titlebar gradient + sidebar header
// text ladder region.
//
// 13 literals migrated across the titlebar 2-stop gradient, the
// sidebar title / subtitle / footer / server pills / empty state.
// Adds 10 new tokens. The .sidebar-title-count REUSES --ht-button-bg
// (exact 0.055 white-overlay alpha match — same intent as the small
// icon button background).

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
  "--ht-titlebar-gradient-top",
  "--ht-titlebar-gradient-bottom",
  "--ht-sidebar-text-strong",
  "--ht-sidebar-text-soft",
  "--ht-sidebar-text-soft-2",
  "--ht-sidebar-text-mute",
  "--ht-sidebar-text-dim",
  "--ht-sidebar-footer-divider",
  "--ht-sidebar-pill-bg-hover",
  "--ht-sidebar-server-online-fg",
];

describe("theme-token migration — titlebar gradient + sidebar header (P7 S23)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("titlebar gradient uses the two new tokens", () => {
    expect(indexCss).toContain(
      "linear-gradient(180deg, var(--ht-titlebar-gradient-top), var(--ht-titlebar-gradient-bottom))",
    );
    // The literals #0d1317 / #0a0e11 still appear in the §5 window-
    // shell comment above the titlebar rule (which audit:theming
    // strips before scanning) — only the production rule must be
    // migrated. Assert there are no non-comment matches.
    const stripped = indexCss.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toContain("#0d1317");
    expect(stripped).not.toContain("#0a0e11");
  });

  test("sidebar title + subtitle + footer use the new sidebar-text tokens", () => {
    const title = matchRule(indexCss, ".sidebar-title");
    expect(title).toContain("var(--ht-sidebar-text-strong)");
    expect(title).not.toMatch(/rgba\(243,\s*246,\s*253,\s*0\.98\)/);

    const titleCount = matchRule(indexCss, ".sidebar-title-count");
    // Cross-component reuse — count chip pulls the small-button bg.
    expect(titleCount).toContain("var(--ht-button-bg)");
    expect(titleCount).toContain("var(--ht-sidebar-text-soft)");

    const subtitle = matchRule(indexCss, ".sidebar-subtitle");
    expect(subtitle).toContain("var(--ht-sidebar-text-mute)");

    const footer = matchRule(indexCss, ".sidebar-footer");
    expect(footer).toContain("var(--ht-sidebar-footer-divider)");

    // The second `.sidebar-empty` rule (line ~824) is the styled
    // one — the first is a transition-only override. Just grep
    // the whole file for the migrated color line.
    expect(indexCss).toMatch(
      /\.sidebar-empty\s*\{[^}]*color:\s*var\(--ht-sidebar-text-dim\)/,
    );
  });

  test("sidebar server pill + label + url use the new tokens", () => {
    const pillHover = matchRule(indexCss, ".sidebar-server-pill:hover");
    expect(pillHover).toContain("var(--ht-sidebar-pill-bg-hover)");

    const label = matchRule(indexCss, ".sidebar-server-label");
    expect(label).toContain("var(--ht-sidebar-text-soft-2)");

    const url = matchRule(indexCss, ".sidebar-server-url");
    expect(url).toContain("var(--ht-sidebar-text-mute)");

    const online = matchRule(
      indexCss,
      ".sidebar-server-dot.online ~ .sidebar-server-url",
    );
    expect(online).toContain("var(--ht-sidebar-server-online-fg)");
    expect(online).not.toContain("#a6e3a1");
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
