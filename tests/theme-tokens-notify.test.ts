// P7 S9 — theme-token migration kick-off.
//
// Pins the migration so a future refactor can't silently re-introduce
// the hard-coded amber/cyan rgba into the notify-glow keyframes (which
// would defeat the high-contrast / light-mode override path).
//
// Two-pronged check:
//   1. The expected token symbols exist in web-theme-tokens.css.
//   2. The migrated keyframes in index.css reference var(--ht-notify-…)
//      and contain no rgba(255, 197, 107) / rgba(111, 233, 255) literals.

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
  "--ht-sem-error-tint",
  "--ht-notify-amber",
  "--ht-notify-amber-soft",
  "--ht-notify-amber-strong",
  "--ht-notify-amber-solid",
  "--ht-notify-amber-tint",
  "--ht-notify-amber-transparent",
  "--ht-notify-cyan",
  "--ht-notify-cyan-soft",
  "--ht-notify-cyan-solid",
  "--ht-notify-cyan-tint",
  "--ht-notify-cyan-glow",
];

describe("theme-token migration — notify cue (P7 S9)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined in web-theme-tokens.css`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("notify-glow-pulse uses the amber token set instead of literal rgba", () => {
    const block = matchKeyframe(indexCss, "notify-glow-pulse");
    expect(block).not.toBeNull();
    expect(block).toContain("--ht-notify-amber");
    // The literal rgba(255, 197, 107, …) hex form must not survive in
    // this keyframe — that's the regression we're guarding against.
    expect(block).not.toMatch(/rgba\(255,\s*197,\s*107/);
  });

  test("notify-glow-pulse-human uses the cyan token set instead of literal rgba", () => {
    const block = matchKeyframe(indexCss, "notify-glow-pulse-human");
    expect(block).not.toBeNull();
    expect(block).toContain("--ht-notify-cyan");
    expect(block).not.toMatch(/rgba\(111,\s*233,\s*255/);
  });

  test("notification-glow-pulse uses the amber token set", () => {
    const block = matchKeyframe(indexCss, "notification-glow-pulse");
    expect(block).not.toBeNull();
    expect(block).toContain("--ht-notify-amber");
    expect(block).not.toMatch(/rgba\(255,\s*197,\s*107/);
  });

  test("notification-dismiss hover references the semantic error tokens", () => {
    // Find the .notification-dismiss:hover block and confirm the
    // tokens are in play. The literal `#f87171` must not survive.
    const idx = indexCss.indexOf(".notification-dismiss:hover");
    expect(idx).toBeGreaterThan(-1);
    const slice = indexCss.slice(idx, idx + 400);
    expect(slice).toContain("var(--ht-sem-error)");
    expect(slice).toContain("var(--ht-sem-error-tint)");
    expect(slice).not.toContain("#f87171");
  });
});

/** Pull the body of `@keyframes <name> { … }` out of a CSS string.
 *  Returns null when the keyframe isn't found. */
function matchKeyframe(css: string, name: string): string | null {
  const re = new RegExp(`@keyframes\\s+${name}\\s*\\{`, "g");
  const m = re.exec(css);
  if (!m) return null;
  // Balanced-brace walk: assumes valid CSS, which the real file is.
  let depth = 1;
  let i = re.lastIndex;
  while (depth > 0 && i < css.length) {
    const ch = css[i++];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return css.slice(m.index, i);
}
