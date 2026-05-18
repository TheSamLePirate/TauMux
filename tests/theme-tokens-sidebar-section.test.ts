// P7 S31 — Cluster H, sidebar section header / toggle / caret /
// count / badge / clear region.
//
// 3 new --ht-sidebar-section-* tokens cover the section-specific
// brightness ladder (0.56 / 0.58 / 0.9 zinc alphas) that sits between
// the existing sidebar-text-dim (0.42) + sidebar-text-soft (0.68).
// Plus heavy cross-component reuse: --ht-pm-card-border for the top
// divider, --ht-agent-row-bg-hover for toggle hover bg, --ht-sidebar-
// text-mute for the caret rest fg (2% delta), --ht-button-bg for the
// count chip bg, --ht-workspace-dot-shadow for the badge shadow,
// --text-strong for the badge fg, --ht-sidebar-text-dim for the
// clear rest fg (3% delta), --ht-sem-error + --ht-pm-kill-bg for
// the clear hover state.

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
  "--ht-sidebar-section-text",
  "--ht-sidebar-section-text-hover",
  "--ht-sidebar-section-count-fg",
];

describe("theme-token migration — sidebar section header (P7 S31)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".sidebar-section-header uses the new text token + reuses --ht-pm-card-border", () => {
    // Three `.sidebar-section-header` rules — the first two are
    // multi-selector layout-only blocks (line 939 + 943). The third
    // (line ~3450) is the styled one. Grep the standalone selector
    // with the migrated color line.
    expect(indexCss).toMatch(
      /\n\.sidebar-section-header \{[^}]*color:\s*var\(--ht-sidebar-section-text\)/,
    );
    expect(indexCss).toMatch(
      /\n\.sidebar-section-header \{[^}]*border-top:\s*0\.5px solid var\(--ht-pm-card-border\)/,
    );
  });

  test(".sidebar-section-toggle hover + caret use new tokens + agent-row-bg reuse", () => {
    const hover = matchRule(indexCss, ".sidebar-section-toggle:hover");
    expect(hover).toContain("var(--ht-agent-row-bg-hover)");
    expect(hover).toContain("var(--ht-sidebar-section-text-hover)");

    const caret = matchRule(indexCss, ".sidebar-section-caret");
    expect(caret).toContain("var(--ht-sidebar-text-mute)");

    const caretHover = matchRule(
      indexCss,
      ".sidebar-section-toggle:hover .sidebar-section-caret",
    );
    expect(caretHover).toContain("var(--ht-sidebar-section-text-hover)");
  });

  test(".sidebar-section-count uses count-fg token + --ht-button-bg", () => {
    const count = matchRule(indexCss, ".sidebar-section-count");
    expect(count).toContain("var(--ht-sidebar-section-count-fg)");
    expect(count).toContain("var(--ht-button-bg)");
  });

  test(".sidebar-section-badge uses --text-strong + --ht-workspace-dot-shadow", () => {
    const badge = matchRule(indexCss, ".sidebar-section-badge");
    expect(badge).toContain("var(--text-strong)");
    expect(badge).toContain("var(--ht-workspace-dot-shadow)");
    expect(badge).not.toContain("#fff");
  });

  test(".sidebar-section-clear + hover reuse sidebar-text-dim + sem-error + pm-kill-bg", () => {
    const clear = matchRule(indexCss, ".sidebar-section-clear");
    expect(clear).toContain("var(--ht-sidebar-text-dim)");

    const clearHover = matchRule(indexCss, ".sidebar-section-clear:hover");
    expect(clearHover).toContain("var(--ht-sem-error)");
    expect(clearHover).toContain("var(--ht-pm-kill-bg)");
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
