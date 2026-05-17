// P7 S14 — Cluster H continuation, telegram pane region.
//
// The .telegram-* rules carried 9 fine-tuned literals for the toolbar
// / composer chrome plus the indigo brand accent on the message-out
// bubble and send button. Migrated to a new --ht-telegram-* token
// group so a future palette swap can repaint the telegram surface in
// one place — mirroring the ht-sidebar-* / ht-button-* / ht-agent-*
// migrations from S10 / S12 / S13. The semantic status pills + msg-
// failed badge stay for a later targeted session.

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
  "--ht-telegram-toolbar-bg",
  "--ht-telegram-input-bg",
  "--ht-telegram-input-border",
  "--ht-telegram-msg-in-bg",
  "--ht-telegram-msg-out-bg",
  "--ht-telegram-msg-out-fg",
  "--ht-telegram-accent-from",
  "--ht-telegram-accent-to",
  "--ht-telegram-send-glow",
];

describe("theme-token migration — telegram pane (P7 S14)", () => {
  for (const name of NEW_TOKENS) {
    test(`token ${name} is defined`, () => {
      expect(tokens).toContain(`${name}:`);
    });
  }

  test("telegram toolbar + chat-select use the new tokens", () => {
    const toolbar = matchRule(indexCss, ".telegram-toolbar");
    expect(toolbar).toContain("var(--ht-telegram-toolbar-bg)");
    expect(toolbar).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.18\)/);

    const select = matchRule(indexCss, ".telegram-chat-select");
    expect(select).toContain("var(--ht-telegram-input-bg)");
    expect(select).toContain("var(--ht-telegram-input-border)");
  });

  test("telegram message bubbles use the new tokens", () => {
    const msgIn = matchRule(indexCss, ".telegram-msg-in");
    expect(msgIn).toContain("var(--ht-telegram-msg-in-bg)");
    expect(msgIn).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.06\)/);

    const msgOut = matchRule(indexCss, ".telegram-msg-out");
    expect(msgOut).toContain("var(--ht-telegram-msg-out-bg)");
    expect(msgOut).toContain("var(--ht-telegram-msg-out-fg)");
    expect(msgOut).not.toMatch(/rgba\(99,\s*102,\s*241,\s*0\.18\)/);
    expect(msgOut).not.toContain("#e0e7ff");
  });

  test("telegram composer + send button use the indigo accent tokens", () => {
    const composer = matchRule(indexCss, ".telegram-composer");
    expect(composer).toContain("var(--ht-telegram-toolbar-bg)");

    const input = matchRule(indexCss, ".telegram-composer-input");
    expect(input).toContain("var(--ht-telegram-input-bg)");
    expect(input).toContain("var(--ht-telegram-input-border)");

    const send = matchRule(indexCss, ".telegram-send-btn");
    expect(send).toContain("var(--ht-telegram-accent-from)");
    expect(send).toContain("var(--ht-telegram-accent-to)");
    expect(send).not.toContain("#6366f1");
    expect(send).not.toContain("#4f46e5");

    const hover = matchRule(indexCss, ".telegram-send-btn:hover");
    expect(hover).toContain("var(--ht-telegram-send-glow)");
    expect(hover).not.toMatch(/rgba\(99,\s*102,\s*241,\s*0\.35\)/);
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
