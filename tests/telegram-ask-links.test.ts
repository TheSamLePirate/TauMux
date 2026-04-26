// Plan #10 commit B — coverage for the two new link tables on
// TelegramDatabase: `ask_user_links` (button-driven kinds) and
// `text_reply_links` (force_reply kind=text). Pure-state SQLite —
// no transport, no service.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TelegramDatabase } from "../src/bun/telegram-db";

let dir: string;
let db: TelegramDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ht-tg-ask-links-"));
  db = new TelegramDatabase(join(dir, "telegram.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("ask_user_links", () => {
  test("link / get round-trip preserves request id + kind", () => {
    db.linkAskUser({
      chatId: "1",
      tgMessageId: 100,
      requestId: "req:42",
      kind: "yesno",
    });
    expect(db.getAskUserLink("1", 100)).toEqual({
      requestId: "req:42",
      kind: "yesno",
    });
  });

  test("missing link returns null", () => {
    expect(db.getAskUserLink("1", 999)).toBeNull();
  });

  test("relink overwrites prior request id (idempotent on key)", () => {
    db.linkAskUser({
      chatId: "1",
      tgMessageId: 100,
      requestId: "req:1",
      kind: "yesno",
    });
    db.linkAskUser({
      chatId: "1",
      tgMessageId: 100,
      requestId: "req:2",
      kind: "choice",
    });
    expect(db.getAskUserLink("1", 100)).toEqual({
      requestId: "req:2",
      kind: "choice",
    });
  });

  test("getAskUserLinksForRequest returns every fan-out target", () => {
    db.linkAskUser({
      chatId: "user:A",
      tgMessageId: 100,
      requestId: "req:1",
      kind: "yesno",
    });
    db.linkAskUser({
      chatId: "user:B",
      tgMessageId: 200,
      requestId: "req:1",
      kind: "yesno",
    });
    db.linkAskUser({
      chatId: "user:C",
      tgMessageId: 300,
      requestId: "req:other",
      kind: "yesno",
    });
    const got = db
      .getAskUserLinksForRequest("req:1")
      .map((r) => r.chatId)
      .sort();
    expect(got).toEqual(["user:A", "user:B"]);
  });

  test("getAskUserLinksForRequest returns empty array when no rows", () => {
    expect(db.getAskUserLinksForRequest("nope")).toEqual([]);
  });

  test("pruneOldAskUserLinks drops rows older than the cutoff", () => {
    db.linkAskUser({
      chatId: "1",
      tgMessageId: 1,
      requestId: "old",
      kind: "yesno",
      ts: 1000,
    });
    db.linkAskUser({
      chatId: "1",
      tgMessageId: 2,
      requestId: "new",
      kind: "yesno",
      ts: 5000,
    });
    expect(db.pruneOldAskUserLinks(2000)).toBe(1);
    expect(db.getAskUserLink("1", 1)).toBeNull();
    expect(db.getAskUserLink("1", 2)).not.toBeNull();
  });
});

describe("text_reply_links", () => {
  test("link / get round-trip preserves request id", () => {
    db.linkTextReply({
      chatId: "1",
      tgMessageId: 100,
      requestId: "req:42",
    });
    expect(db.getTextReplyLink("1", 100)).toEqual({ requestId: "req:42" });
  });

  test("missing link returns null", () => {
    expect(db.getTextReplyLink("1", 999)).toBeNull();
  });

  test("pruneOldTextReplyLinks drops aged rows", () => {
    db.linkTextReply({
      chatId: "1",
      tgMessageId: 1,
      requestId: "old",
      ts: 100,
    });
    db.linkTextReply({
      chatId: "1",
      tgMessageId: 2,
      requestId: "new",
      ts: 9999,
    });
    expect(db.pruneOldTextReplyLinks(1000)).toBe(1);
    expect(db.getTextReplyLink("1", 1)).toBeNull();
    expect(db.getTextReplyLink("1", 2)).not.toBeNull();
  });
});

describe("dropAllLinksForRequest", () => {
  test("drops both ask_user_links and text_reply_links for the same request", () => {
    db.linkAskUser({
      chatId: "user:A",
      tgMessageId: 1,
      requestId: "req:1",
      kind: "yesno",
    });
    db.linkAskUser({
      chatId: "user:A",
      tgMessageId: 2,
      requestId: "req:keep",
      kind: "yesno",
    });
    db.linkTextReply({
      chatId: "user:A",
      tgMessageId: 3,
      requestId: "req:1",
    });
    db.dropAllLinksForRequest("req:1");
    expect(db.getAskUserLink("user:A", 1)).toBeNull();
    expect(db.getTextReplyLink("user:A", 3)).toBeNull();
    expect(db.getAskUserLink("user:A", 2)).not.toBeNull();
  });

  test("is a no-op for an unknown request id", () => {
    db.linkAskUser({
      chatId: "1",
      tgMessageId: 1,
      requestId: "alive",
      kind: "yesno",
    });
    db.dropAllLinksForRequest("ghost");
    expect(db.getAskUserLink("1", 1)).not.toBeNull();
  });
});
