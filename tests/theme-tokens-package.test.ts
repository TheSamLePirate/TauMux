// P7 S21 — Cluster H continuation, workspace-package card region.
//
// The .workspace-package + .workspace-package-* rules carried ~7
// literals across the card chrome (bg, border, header hover), the
// type chip (cyan info tint), the bin chip (warn amber tint), and
// the Rust cargo icon (#f38020). Migrated to a new --ht-package-*
// token group (5 tokens) + a `--ht-cargo-icon` token + REUSES the
// S18 --ht-badge-warn-* family for the bin chip.

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
  "--ht-package-bg",
  "--ht-package-border",
  "--ht-package-header-bg-hover",
  "--ht-package-type-bg",
  "--ht-package-type-border",
  "--ht-cargo-icon",
];

describe("theme-token migration — workspace package card (P7 S21)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("workspace-package card uses the new chrome tokens", () => {
    const card = matchRule(indexCss, ".workspace-package");
    expect(card).toContain("var(--ht-package-bg)");
    expect(card).toContain("var(--ht-package-border)");
    expect(card).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.02\)/);

    const headerHover = matchRule(indexCss, ".workspace-package-header:hover");
    expect(headerHover).toContain("var(--ht-package-header-bg-hover)");

    const expanded = matchRule(
      indexCss,
      ".workspace-package.expanded .workspace-package-header",
    );
    expect(expanded).toContain("var(--ht-package-border)");
  });

  test("workspace-package-type chip uses the info-soft tokens", () => {
    const type = matchRule(indexCss, ".workspace-package-type");
    expect(type).toContain("var(--ht-package-type-bg)");
    expect(type).toContain("var(--ht-package-type-border)");
  });

  test("workspace-package-bin-chip reuses the S18 --ht-badge-warn-* family", () => {
    const bin = matchRule(indexCss, ".workspace-package-bin-chip");
    expect(bin).toContain("var(--ht-badge-warn-bg)");
    expect(bin).toContain("var(--ht-badge-warn-border)");
  });

  test("cargo icon uses the rust-orange token (both selectors)", () => {
    // Two selectors carry the cargo icon colour (legacy + sidebar-v2).
    // Both must now use the token.
    const matches = indexCss.match(
      /\.workspace-manifest-cargo \.workspace-package-icon \{[^}]*color:\s*var\(--ht-cargo-icon\)/g,
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
    expect(indexCss).not.toContain("#f38020");
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
