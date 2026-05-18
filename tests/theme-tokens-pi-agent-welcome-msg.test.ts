// P7 S42 chunk 1 — Cluster H, pi-agent welcome panel + messages
// (user / assistant / system bubbles, image gallery, streaming
// cursor, messages scrollbar).
//
// 5 new --ht-agent-msg-* / -image-thumb-* tokens:
// - msg-time-fg (0.15 white, dimmest tier)
// - msg-user-grad-top / -bot (cyan 0.1 / 0.06 — discrete gradient
//   stops so the user bubble can rotate independently of assistant)
// - msg-system-bg (amber 0.05 — softer than --ht-notify-amber-soft
//   because this is a flat fill rather than a notif badge)
// - image-thumb-bg (0.25 black hold)
//
// Reuses include the S41 --ht-agent-tb-model-hover-border (cyan
// 0.3 for the welcome glyph drop-shadow + streaming cursor box-
// shadow), --ht-notify-amber-tint (0.45 keyframe), --ht-palette-
// divider + -soft (cyan 0.18/0.14), --ht-notify-amber-soft (0.1
// for msg-system border 0.08), --ht-sidebar-filter-selected-shadow
// (0.28 black for kbd 0.3 shadow), --ht-sidebar-row-bg-stripe
// (msg-assistant bg 0.025 exact), --ht-agent-row-bg-hover (assistant
// border 0.04), plus the white-alpha vocabulary for kbd/btn/thumb.

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
  "--ht-agent-msg-time-fg",
  "--ht-agent-msg-user-grad-top",
  "--ht-agent-msg-user-grad-bot",
  "--ht-agent-msg-system-bg",
  "--ht-agent-image-thumb-bg",
];

describe("theme-token migration — pi-agent welcome + messages (P7 S42 chunk 1)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test(".agent-welcome-glyph drop-shadow reuses S41 tb-model-hover-border", () => {
    const rule = matchRule(indexCss, ".agent-welcome-glyph");
    expect(rule).toContain("var(--ht-agent-tb-model-hover-border)");
    expect(rule).not.toContain("rgba(111, 233, 255,0.3)");
  });

  test(".agent-welcome-shortcut kbd uses agent-row-bg-hover-card + panel-border-soft + filter-selected-shadow", () => {
    const rule = matchRule(indexCss, ".agent-welcome-shortcut kbd");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-sidebar-filter-selected-shadow)");
  });

  test(".agent-welcome-btn + hover reuse package-header-bg-hover + palette-divider", () => {
    const rest = matchRule(indexCss, ".agent-welcome-btn");
    expect(rest).toContain("var(--ht-package-header-bg-hover)");

    const hover = matchRule(indexCss, ".agent-welcome-btn:hover");
    expect(hover).toContain("var(--ht-agent-row-bg-hover-card)");
    expect(hover).toContain("var(--ht-palette-divider)");
  });

  test(".agent-msg-time uses msg-time-fg", () => {
    const rule = matchRule(indexCss, ".agent-msg-time");
    expect(rule).toContain("var(--ht-agent-msg-time-fg)");
  });

  test(".agent-msg-user uses gradient tokens + palette-divider-soft border", () => {
    const rule = matchRule(indexCss, ".agent-msg-user");
    expect(rule).toContain("var(--ht-agent-msg-user-grad-top)");
    expect(rule).toContain("var(--ht-agent-msg-user-grad-bot)");
    expect(rule).toContain("var(--ht-palette-divider-soft)");
  });

  test(".agent-msg-assistant uses sidebar-row-bg-stripe + agent-row-bg-hover", () => {
    const rule = matchRule(indexCss, ".agent-msg-assistant");
    expect(rule).toContain("var(--ht-sidebar-row-bg-stripe)");
    expect(rule).toContain("var(--ht-agent-row-bg-hover)");
  });

  test(".agent-msg-system uses msg-system-bg + notify-amber-soft", () => {
    const rule = matchRule(indexCss, ".agent-msg-system");
    expect(rule).toContain("var(--ht-agent-msg-system-bg)");
    expect(rule).toContain("var(--ht-notify-amber-soft)");
  });

  test(".agent-image-thumb uses panel-border-soft + image-thumb-bg", () => {
    const rule = matchRule(indexCss, ".agent-image-thumb");
    expect(rule).toContain("var(--ht-panel-border-soft)");
    expect(rule).toContain("var(--ht-agent-image-thumb-bg)");
  });

  test(".agent-cursor box-shadow reuses S41 tb-model-hover-border", () => {
    const rule = matchRule(indexCss, ".agent-cursor");
    expect(rule).toContain("var(--ht-agent-tb-model-hover-border)");
  });

  test(".agent-messages scrollbar-color uses agent-row-bg-hover-card", () => {
    const rule = matchRule(indexCss, ".agent-messages");
    expect(rule).toContain("var(--ht-agent-row-bg-hover-card)");
  });

  test("agent-glyph-pulse keyframe reuses tb-model-hover-border + notify-amber-tint", () => {
    expect(indexCss).toMatch(
      /@keyframes agent-glyph-pulse[^}]*0%,[^}]*var\(--ht-agent-tb-model-hover-border\)/,
    );
    expect(indexCss).toMatch(
      /@keyframes agent-glyph-pulse[^{}]*\{[^{}]*\{[^}]*\}[^{}]*\{[^}]*var\(--ht-notify-amber-tint\)/,
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
