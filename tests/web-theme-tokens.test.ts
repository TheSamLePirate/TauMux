// Phase 5 / U2 — every default token has an override in both the
// Graphite Light theme and the High Contrast theme.
//
// The risk this test guards: someone adds a new `--ht-…` token to the
// default `:root` block, ships the dark colour, and forgets to map
// it for light + HC. The Graphite Light surface then renders the
// new chrome in the dark colour against a light background — exactly
// the kind of bug a theme system is supposed to prevent.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(
  join(import.meta.dir, "..", "src", "shared", "web-theme-tokens.css"),
  "utf-8",
);

interface Block {
  name: string;
  start: number;
  end: number;
  body: string;
}

/** Match a `:root … { … }` block (the selector may carry `[data-theme=…]`).
 *  Returns the body text + offsets so tests can probe each theme. */
function findBlock(label: string, body: string): Block | null {
  const re = new RegExp(
    `(?::root${label === "default" ? "(?![\\[])" : `\\[data-theme="${label}"\\]`})\\s*\\{`,
    "m",
  );
  const m = re.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
  // Walk to the matching `}` — the block body never contains nested
  // braces (the file is hand-written and uses no @rules inside :root).
  const end = body.indexOf("}", start);
  if (end === -1) return null;
  return { name: label, start, end, body: body.slice(start, end) };
}

function tokensInBlock(block: Block): Set<string> {
  const out = new Set<string>();
  for (const m of block.body.matchAll(/--ht-[a-z0-9-]+/g)) {
    out.add(m[0]);
  }
  return out;
}

describe("[U2] web-theme-tokens — every default token has light + HC overrides", () => {
  const defaultBlock = findBlock("default", CSS);
  const lightBlock = findBlock("graphite-light", CSS);
  const hcBlock = findBlock("high-contrast", CSS);

  it("the three primary blocks exist", () => {
    expect(defaultBlock).not.toBeNull();
    expect(lightBlock).not.toBeNull();
    expect(hcBlock).not.toBeNull();
  });

  it("every --ht-bg-* / --ht-text-* / --ht-border-* / --ht-accent-* token has a light override", () => {
    if (!defaultBlock || !lightBlock) return;
    const defaultTokens = tokensInBlock(defaultBlock);
    const lightTokens = tokensInBlock(lightBlock);
    // Filter to the colour-bearing tokens; shape / motion / typography
    // intentionally stay the same across themes.
    const colourGroups = [
      /^--ht-bg-/,
      /^--ht-text-/,
      /^--ht-border-/,
      /^--ht-accent($|-)/,
      /^--ht-secondary/,
      /^--ht-sem-/,
    ];
    const missing: string[] = [];
    for (const t of defaultTokens) {
      if (!colourGroups.some((re) => re.test(t))) continue;
      if (!lightTokens.has(t)) missing.push(t);
    }
    if (missing.length > 0) {
      throw new Error(
        `[graphite-light] missing token overrides: ${missing.join(", ")}`,
      );
    }
  });

  it("every colour token has a high-contrast override", () => {
    if (!defaultBlock || !hcBlock) return;
    const defaultTokens = tokensInBlock(defaultBlock);
    const hcTokens = tokensInBlock(hcBlock);
    const colourGroups = [
      /^--ht-bg-/,
      /^--ht-text-/,
      /^--ht-border-/,
      /^--ht-accent($|-)/,
      /^--ht-secondary/,
      /^--ht-sem-/,
    ];
    const missing: string[] = [];
    for (const t of defaultTokens) {
      if (!colourGroups.some((re) => re.test(t))) continue;
      if (!hcTokens.has(t)) missing.push(t);
    }
    if (missing.length > 0) {
      throw new Error(
        `[high-contrast] missing token overrides: ${missing.join(", ")}`,
      );
    }
  });

  it("the prefers-color-scheme: light @media block exists for data-theme=system", () => {
    expect(CSS).toMatch(/@media\s*\(prefers-color-scheme:\s*light\)/);
    expect(CSS).toMatch(
      /@media\s*\(prefers-color-scheme:\s*light\)\s*\{[\s\S]*?:root\[data-theme="system"\]/,
    );
  });

  it("the forced-colors: active @media block exists with Canvas/CanvasText keywords", () => {
    expect(CSS).toMatch(/@media\s*\(forced-colors:\s*active\)/);
    // CSS Color Module Level 4 system keywords mapped under
    // forced-colors: Canvas / CanvasText / GrayText / Highlight / LinkText.
    const forcedBlock = CSS.match(
      /@media\s*\(forced-colors:\s*active\)\s*\{[\s\S]*?(?=\n\})/,
    );
    expect(forcedBlock).not.toBeNull();
    const body = forcedBlock![0];
    expect(body).toContain("Canvas");
    expect(body).toContain("CanvasText");
    expect(body).toContain("Highlight");
  });
});
