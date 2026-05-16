// Triple-A H.6 / S3+S7 — verify the telegram outbound cap and chatId
// allow-list. Backfill from Phase 0 audit (PR 10).
//
// `sendTelegramAndBroadcast` is module-private in src/bun/index.ts;
// exercising it would require booting the full process. Pin the
// invariants via source inspection — sufficient to catch the
// regression we're guarding (a refactor that loosens the cap or
// drops the allow-list).

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(import.meta.dir, "..", "src", "bun", "index.ts"),
  "utf-8",
);

describe("[S3] telegram outbound 4096-char cap", () => {
  it("declares TELEGRAM_MAX_TEXT_LEN = 4096 at module scope", () => {
    expect(SRC).toMatch(/const TELEGRAM_MAX_TEXT_LEN\s*=\s*4096/);
  });

  it("drops the send when text exceeds the cap and logs the length", () => {
    // The check shape:
    //   if (text.length > TELEGRAM_MAX_TEXT_LEN) {
    //     console.warn(`… text length ${text.length} exceeds …`);
    //     return;
    //   }
    expect(SRC).toMatch(
      /text\.length\s*>\s*TELEGRAM_MAX_TEXT_LEN[\s\S]*?console\.warn[\s\S]*?text length[\s\S]*?TELEGRAM_MAX_TEXT_LEN/,
    );
  });
});

describe("[S7] telegram chatId allow-list (mirror-path bypass guard)", () => {
  it("declares an `allowUnknownChat` opt so internal callers can opt in", () => {
    expect(SRC).toMatch(/allowUnknownChat\?:\s*boolean/);
  });

  it("rejects unknown chatIds unless allowUnknownChat is set", () => {
    // The check shape: `if (!opts.allowUnknownChat) { ... known.has(chatId) ... return; }`
    expect(SRC).toMatch(
      /if\s*\(!opts\.allowUnknownChat\)[\s\S]*?listChats\(\)[\s\S]*?known\.has\(chatId\)/,
    );
  });

  it("logs the rejected chatId in the drop message", () => {
    expect(SRC).toContain("chatId");
    expect(SRC).toMatch(
      /\[telegram\] send dropped[\s\S]*?chatId[\s\S]*?allow-list/,
    );
  });
});
