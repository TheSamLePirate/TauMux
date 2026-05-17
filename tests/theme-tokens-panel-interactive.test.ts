// P7 S28 — Cluster H, .panel-interactive + drag-handle + dragging
// shadow + title text-shadow.
//
// The .panel-interactive amber-tinted hover state, the drag handle's
// amber gradient + zinc bg, the deeper dragging-state shadow, and
// the title's text-shadow halo together cover ~14 literals. 4 new
// tokens minted + 5 cross-component reuses (amber alphas harmonised
// onto the existing --ht-notify-amber-* family with ≤1% delta).

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
  "--ht-panel-interactive-shadow",
  "--ht-panel-drag-shadow-strong",
  "--ht-panel-handle-bg",
  "--ht-notify-amber-wash",
];

describe("theme-token migration — panel interactive + drag handle (P7 S28)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".panel-interactive harmonises onto the amber-tint + amber family", () => {
    // There are two `.panel-interactive` rules — the first is a multi-
    // selector transform-only override; the second has the migrated
    // border + shadow. Find the one that defines border-right-color.
    expect(indexCss).toMatch(
      /\n\.panel-interactive \{\s*\n\s*border-right-color:\s*var\(--ht-notify-amber-tint\)/,
    );
    expect(indexCss).toMatch(
      /\n\.panel-interactive \{[^}]*border-bottom-color:\s*var\(--ht-notify-amber\)/,
    );
    expect(indexCss).toMatch(
      /\n\.panel-interactive \{[^}]*box-shadow:[^;]*var\(--ht-panel-interactive-shadow\)/,
    );
  });

  test(".panel.panel-dragging deeper shadow uses the new token", () => {
    // Multi-selector rule — grep the whole block.
    expect(indexCss).toMatch(
      /\.panel\.panel-dragging,\s*\n\s*\.panel\.panel-resizing\s*\{[^}]*box-shadow:[^;]*var\(--ht-panel-drag-shadow-strong\)/,
    );
  });

  test(".panel-drag-handle gradient + bg + border use new + reused tokens", () => {
    const handle = matchRule(indexCss, ".panel-drag-handle");
    expect(handle).toContain("var(--ht-notify-amber-wash)");
    expect(handle).toContain("var(--ht-panel-handle-bg)");
    // Inset highlights reuse existing white-overlay tokens.
    expect(handle).toContain("var(--ht-agent-row-bg-hover)");
    expect(handle).toContain("var(--ht-package-header-bg-hover)");
  });

  test(".panel-title text-shadow reuses --ht-notify-amber-flash + --ht-agent-row-bg-hover", () => {
    const title = matchRule(indexCss, ".panel-title");
    expect(title).toContain("var(--ht-notify-amber-flash)");
    expect(title).toContain("var(--ht-agent-row-bg-hover)");
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
