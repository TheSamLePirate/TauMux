// P7 S15 — Cluster H continuation, titlebar toolbar icon button +
// sidebar inset shadow region.
//
// The #titlebar .toolbar-icon-btn rule and the #sidebar inset-shadow
// carried 5 fine-tuned literals (resting fg, cyan + white :hover
// drop-shadow pair, sidebar inset highlight, reduced-transparency
// fallback bg). Migrated to a new --ht-titlebar-* token group + one
// --ht-sidebar-* token so a future palette swap can repaint the
// titlebar in one place.

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
  "--ht-titlebar-toolbar-fg",
  "--ht-titlebar-toolbar-hover-glow-cyan",
  "--ht-titlebar-toolbar-hover-glow-white",
  "--ht-sidebar-inset-shadow",
  "--ht-sidebar-reduced-transparency-bg",
];

describe("theme-token migration — titlebar toolbar + sidebar inset (P7 S15)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("titlebar toolbar resting + hover glow use the new tokens", () => {
    const resting = matchRule(indexCss, "#titlebar .toolbar-icon-btn");
    expect(resting).toContain("var(--ht-titlebar-toolbar-fg)");
    expect(resting).not.toMatch(/rgba\(244,\s*244,\s*245,\s*0\.58\)/);

    // The .ht-icon child rule lives under a combined selector group; just
    // grep the whole file for the migrated drop-shadow pair.
    expect(indexCss).toContain(
      "drop-shadow(0 0 12px var(--ht-titlebar-toolbar-hover-glow-cyan))",
    );
    expect(indexCss).toContain(
      "drop-shadow(0 0 3px var(--ht-titlebar-toolbar-hover-glow-white))",
    );
    expect(indexCss).not.toMatch(
      /drop-shadow\([^)]*rgba\(111,\s*233,\s*255,\s*0\.34\)/,
    );
  });

  test("sidebar inset shadow + reduced-transparency fallback use the new tokens", () => {
    const sidebar = matchRule(indexCss, "#sidebar");
    expect(sidebar).toContain("var(--ht-sidebar-inset-shadow)");
    expect(sidebar).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.02\)/);

    // The @media block doesn't match through matchRule because it has
    // a different selector wrapper — grep the whole file.
    expect(indexCss).toContain(
      "background: var(--ht-sidebar-reduced-transparency-bg);",
    );
    // The literal #151720 must not survive anywhere except inside the
    // token block (which is in web-theme-tokens.css, a separate file).
    expect(indexCss).not.toContain("#151720");
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
