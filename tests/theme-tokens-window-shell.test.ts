// P7 S36 chunk 2 — Cluster H, t3 window-theme shell base colours.
// 6 new --ht-window-* tokens for the high-alpha dark-grey holds
// used by the window theme's panel / titlebar / sidebar / surface
// / modal-overlay / toast backgrounds. These are deliberately
// opaque (0.94 – 0.99) so the desktop never bleeds through.
// Grouped under the --ht-window-* namespace so a future palette
// swap repaints the shell in one place.

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
  "--ht-window-titlebar-bg",
  "--ht-window-sidebar-bg",
  "--ht-window-surface-bg",
  "--ht-window-surface-bar-bg",
  "--ht-window-modal-overlay-bg",
  "--ht-window-toast-bg",
];

// Scope assertions to the t3 override block.
const T3_BLOCK_MARK = "/* Final alignment: exact t3code-style dark shell";
const t3End = indexCss.indexOf(T3_BLOCK_MARK);
if (t3End < 0) throw new Error("t3 block marker not found");
const t3Start = indexCss.lastIndexOf("#titlebar {", t3End);
if (t3Start < 0) throw new Error("t3 block start not found");
const t3Block = indexCss.slice(t3Start, t3End);

describe("theme-token migration — window-shell base colours (P7 S36 chunk 2)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("#titlebar (t3 override) uses titlebar-bg token", () => {
    const rule = matchRule(t3Block, "#titlebar");
    expect(rule).toContain("var(--ht-window-titlebar-bg)");
    expect(rule).not.toContain("rgba(23, 26, 33, 0.94)");
  });

  test("#sidebar (t3 override) uses sidebar-bg token", () => {
    const rule = matchRule(t3Block, "#sidebar");
    expect(rule).toContain("var(--ht-window-sidebar-bg)");
  });

  test(".surface-container (t3 override) uses surface-bg token", () => {
    const rule = matchRule(t3Block, ".surface-container");
    expect(rule).toContain("var(--ht-window-surface-bg)");
  });

  test(".surface-bar (t3 override) uses surface-bar-bg token", () => {
    const rule = matchRule(t3Block, ".surface-bar");
    expect(rule).toContain("var(--ht-window-surface-bar-bg)");
  });

  test("modal overlay multi-selector uses modal-overlay-bg token", () => {
    expect(t3Block).toMatch(
      /\.process-manager-overlay,\s*\n\.surface-details-overlay,\s*\n\.settings-overlay,\s*\n\.palette-overlay,\s*\n\.prompt-overlay \{[^}]*var\(--ht-window-modal-overlay-bg\)/,
    );
  });

  test(".toast (t3 override) uses toast-bg token", () => {
    const rule = matchRule(t3Block, ".toast");
    expect(rule).toContain("var(--ht-window-toast-bg)");
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
