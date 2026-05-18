// P7 S38 chunk 2 — Cluster H, vNext port-chip green palette +
// close-btn peach-red hover palette.
//
// 8 new --ht-vnext-* tokens. Port (mossy green, softer than the
// --ht-badge-success #86efac family — chip is hover-info rather
// than prominent running-state badge):
//   --port-fg          #9ed3ab
//   --port-fg-hover    #cbeed0
//   --port-bg          0.12 alpha
//   --port-border      0.18 alpha  (also reused as hover bg)
//   --port-border-hover 0.28 alpha
// Close-btn (warmer peach-red than --ht-sem-error #f87171 — the
// chrominance shift signals "close, not error"):
//   --close-hover-fg   #ff9b8f
//   --close-hover-bg   0.12 alpha
//   --close-hover-border 0.18 alpha
//
// chip-git color-mix is left untouched (the accent-secondary base
// is itself a token, only the inner literals were migrated to
// --ht-package-header-bg-hover + --ht-agent-row-bg-hover-card).

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
  "--ht-vnext-port-fg",
  "--ht-vnext-port-fg-hover",
  "--ht-vnext-port-bg",
  "--ht-vnext-port-border",
  "--ht-vnext-port-border-hover",
  "--ht-vnext-close-hover-fg",
  "--ht-vnext-close-hover-bg",
  "--ht-vnext-close-hover-border",
];

describe("theme-token migration — vNext port-chip + close-btn (P7 S38 chunk 2)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("chip-git multi-selector color-mix uses package-header-bg-hover + agent-row-bg-hover-card", () => {
    expect(indexCss).toMatch(
      /\.surface-chip\.chip-git,\s*\n\.process-manager-git,\s*\n\.workspace-package-bin-chip \{[^}]*var\(--ht-package-header-bg-hover\)[^}]*var\(--ht-agent-row-bg-hover-card\)/,
    );
    expect(indexCss).toMatch(
      /\.surface-chip\.chip-git,\s*\n\.process-manager-git,\s*\n\.workspace-package-bin-chip \{[^}]*\}/,
    );
  });

  test("chip-port multi-selector uses port-fg + port-bg + port-border", () => {
    expect(indexCss).toMatch(
      /\.surface-chip\.chip-port,\s*\n\.workspace-port-chip,\s*\n\.process-manager-port \{[^}]*var\(--ht-vnext-port-fg\)/,
    );
    expect(indexCss).toMatch(
      /\.surface-chip\.chip-port,\s*\n\.workspace-port-chip,\s*\n\.process-manager-port \{[^}]*var\(--ht-vnext-port-bg\)/,
    );
    expect(indexCss).toMatch(
      /\.surface-chip\.chip-port,\s*\n\.workspace-port-chip,\s*\n\.process-manager-port \{[^}]*var\(--ht-vnext-port-border\)/,
    );
  });

  test("chip-port hover multi-selector reuses port-border (bg) + port-border-hover + port-fg-hover", () => {
    expect(indexCss).toMatch(
      /\.surface-chip\.chip-port:hover,[^{}]*\{[^}]*var\(--ht-vnext-port-border\)[^}]*var\(--ht-vnext-port-border-hover\)[^}]*var\(--ht-vnext-port-fg-hover\)/,
    );
  });

  test("close-btn :hover multi-selector uses all 3 close-hover-* tokens", () => {
    expect(indexCss).toMatch(
      /\.surface-bar-close:hover,\s*\n\.panel-close-btn:hover,[^{}]*\{[^}]*var\(--ht-vnext-close-hover-fg\)[^}]*var\(--ht-vnext-close-hover-bg\)[^}]*var\(--ht-vnext-close-hover-border\)/,
    );
  });

  test("no stale #9ed3ab / #cbeed0 / #ff9b8f hex literals remain", () => {
    expect(indexCss).not.toContain("#9ed3ab");
    expect(indexCss).not.toContain("#cbeed0");
    expect(indexCss).not.toContain("#ff9b8f");
  });
});
