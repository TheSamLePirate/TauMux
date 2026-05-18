// P7 S31 — Cluster H, sidebar log-item state colours.
//
// 4 .log-item state rules carried Catppuccin-style stamps. 3 new
// --ht-log-* tokens cover warning / error / progress; .success
// reuses --ht-badge-success-fg (exact #86efac match).

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

describe("theme-token migration — sidebar log-item states (P7 S31)", () => {
  test("--ht-log-warning-fg / -error-fg / -progress-fg defined", () => {
    expect(tokens).toContain("--ht-log-warning-fg:");
    expect(tokens).toContain("--ht-log-error-fg:");
    expect(tokens).toContain("--ht-log-progress-fg:");
  });

  test("log-item state rules use the new + reused tokens", () => {
    const success = matchRule(indexCss, ".log-item.success");
    expect(success).toContain("var(--ht-badge-success-fg)");

    const warning = matchRule(indexCss, ".log-item.warning");
    expect(warning).toContain("var(--ht-log-warning-fg)");
    expect(warning).not.toContain("#facc15");

    const error = matchRule(indexCss, ".log-item.error");
    expect(error).toContain("var(--ht-log-error-fg)");

    const progress = matchRule(indexCss, ".log-item.progress");
    expect(progress).toContain("var(--ht-log-progress-fg)");
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
