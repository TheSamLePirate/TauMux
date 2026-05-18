// P7 S37 chunk 2 — Cluster H, vNext UI overrides for process-manager
// / surface-details region (extends the S37 chunk 1 vNext text scale).
//
// 2 new --ht-vnext-text-* tokens: --text-section-h (0.46 — uppercase
// summary / h3 / th labels, intentionally one tier below text-mute
// 0.48 so it reads as metadata) and --text-emph (0.94 — brightest
// zinc, used for workspace names + notification titles + dd values).
//
// Cross-component reuse: --ht-agent-row-bg-hover-card (0.06 white
// for workspace border), --ht-package-header-bg-hover (0.03 white
// for workspace + workspace-header + th bg), --ht-agent-row-bg-hover
// (0.04 white for table row dividers). 10 literals migrated.

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

const NEW_TOKENS = ["--ht-vnext-text-section-h", "--ht-vnext-text-emph"];

// Same vNext block scope as chunk 1.
const T3_FINAL_MARK = "/* Final alignment: exact t3code-style dark shell";
const t3FinalIdx = indexCss.indexOf(T3_FINAL_MARK);
if (t3FinalIdx < 0) throw new Error("t3 final-alignment marker not found");
const vEnd = indexCss.lastIndexOf("#titlebar {", t3FinalIdx);
if (vEnd < 0) throw new Error("t3 #titlebar anchor not found");
const vStart = indexCss.lastIndexOf(".palette-input-row {", vEnd);
if (vStart < 0) throw new Error("vNext block start not found");
const vBlock = indexCss.slice(vStart, vEnd);

describe("theme-token migration — vNext PM / surface-details overrides (P7 S37 chunk 2)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".process-manager-summary + .surface-details-section h3 use text-section-h", () => {
    expect(vBlock).toMatch(
      /\.process-manager-summary,\s*\n\.surface-details-section h3 \{[^}]*var\(--ht-vnext-text-section-h\)/,
    );
  });

  test(".process-manager-workspace + section border reuse agent-row-bg-hover-card", () => {
    expect(vBlock).toMatch(
      /\.process-manager-workspace,\s*\n\.surface-details-section \{[^}]*var\(--ht-agent-row-bg-hover-card\)/,
    );
  });

  test(".process-manager-workspace bg + workspace-header bg reuse package-header-bg-hover", () => {
    const ws = matchRule(vBlock, ".process-manager-workspace");
    expect(ws).toContain("var(--ht-package-header-bg-hover)");

    const wsh = matchRule(vBlock, ".process-manager-workspace-header");
    expect(wsh).toContain("var(--ht-package-header-bg-hover)");
  });

  test("workspace-name / surface-title / dd / notification-title use text-emph", () => {
    expect(vBlock).toMatch(
      /\.process-manager-workspace-name,\s*\n\.process-manager-surface-title,\s*\n\.surface-details-dl dd,\s*\n\.notification-title \{[^}]*var\(--ht-vnext-text-emph\)/,
    );
  });

  test("table row dividers reuse agent-row-bg-hover", () => {
    expect(vBlock).toMatch(
      /\.process-manager-table th,\s*\n\.process-manager-table td,[^{}]*\{[^}]*var\(--ht-agent-row-bg-hover\)/,
    );
  });

  test("table th uses text-section-h + package-header-bg-hover", () => {
    expect(vBlock).toMatch(
      /\.process-manager-table th,\s*\n\.surface-details-table th \{[^}]*var\(--ht-vnext-text-section-h\)/,
    );
    expect(vBlock).toMatch(
      /\.process-manager-table th,\s*\n\.surface-details-table th \{[^}]*var\(--ht-package-header-bg-hover\)/,
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
