import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MAX_MESSAGES_PER_CHAT,
  TelegramDatabase,
} from "../src/bun/telegram-db";

let dir: string;
let dbPath: string;
let db: TelegramDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ht-tg-db-"));
  dbPath = join(dir, "telegram.db");
  db = new TelegramDatabase(dbPath);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("TelegramDatabase", () => {
  test("inserts and reads back chronologically", () => {
    const t = Date.now();
    db.insertMessage({
      chatId: "c1",
      direction: "in",
      text: "hello",
      ts: t,
      tgMessageId: 1,
      fromUserId: "u1",
      fromName: "Alice",
    });
    db.insertMessage({
      chatId: "c1",
      direction: "out",
      text: "hi back",
      ts: t + 1000,
    });
    const history = db.getHistory("c1", 10);
    expect(history.map((m) => m.text)).toEqual(["hello", "hi back"]);
    expect(history[0].direction).toBe("in");
    expect(history[1].direction).toBe("out");
  });

  test("getHistory paginates with `before`", () => {
    for (let i = 0; i < 20; i++) {
      db.insertMessage({
        chatId: "c1",
        direction: "in",
        text: `msg ${i}`,
        ts: i,
      });
    }
    const recent = db.getHistory("c1", 5);
    expect(recent.map((m) => m.text)).toEqual([
      "msg 15",
      "msg 16",
      "msg 17",
      "msg 18",
      "msg 19",
    ]);
    const earlier = db.getHistory("c1", 5, recent[0].id);
    expect(earlier.map((m) => m.text)).toEqual([
      "msg 10",
      "msg 11",
      "msg 12",
      "msg 13",
      "msg 14",
    ]);
  });

  test("trims chats above MAX_MESSAGES_PER_CHAT", () => {
    const limit = MAX_MESSAGES_PER_CHAT;
    // Inserts run inside a single transaction so 10k+ rows finish well
    // under the default test timeout. Each bare insert is a full fsync
    // on WAL otherwise.
    const total = limit + 25;
    const run = () => {
      for (let i = 0; i < total; i++) {
        db.insertMessage({
          chatId: "c1",
          direction: "in",
          text: String(i),
          ts: i,
        });
      }
    };
    // Wrap in a transaction via the raw Database handle for speed. The
    // test is exercising the trim logic, not per-insert perf.
    // Access private field for the transaction wrapper.
    const rawDb = (
      db as unknown as { db: { transaction: (fn: () => void) => () => void } }
    ).db;
    rawDb.transaction(run)();
    db.flushPendingTrims();
    expect(db.countMessages("c1")).toBe(limit);
    const newest = db.getHistory("c1", 1);
    expect(newest[0].text).toBe(String(total - 1));
  });

  test("upsertChat deduplicates and tracks lastSeen", () => {
    db.upsertChat({ id: "c1", name: "Alice", ts: 100 });
    db.upsertChat({ id: "c1", name: "Alice (renamed)", ts: 200 });
    db.upsertChat({ id: "c2", name: "Bob", ts: 50 });
    const chats = db.listChats();
    expect(chats.map((c) => c.id)).toEqual(["c1", "c2"]);
    const c1 = chats.find((c) => c.id === "c1")!;
    expect(c1.name).toBe("Alice (renamed)");
    expect(c1.lastSeen).toBe(200);
  });

  test("MAX is per-chat — separate chats are independent", () => {
    for (let i = 0; i < 5; i++) {
      db.insertMessage({ chatId: "a", direction: "in", text: "a" + i, ts: i });
      db.insertMessage({ chatId: "b", direction: "in", text: "b" + i, ts: i });
    }
    expect(db.countMessages("a")).toBe(5);
    expect(db.countMessages("b")).toBe(5);
  });

  test("inbound dedup by (chat_id, tg_message_id)", () => {
    const first = db.insertMessage({
      chatId: "c1",
      direction: "in",
      text: "hello",
      ts: 100,
      tgMessageId: 42,
      fromUserId: "u1",
      fromName: "Alice",
    });
    expect(first.inserted).toBe(true);
    const dup = db.insertMessage({
      chatId: "c1",
      direction: "in",
      text: "hello (replayed)",
      ts: 200,
      tgMessageId: 42,
      fromUserId: "u1",
      fromName: "Alice",
    });
    expect(dup.inserted).toBe(false);
    expect(dup.message.id).toBe(first.message.id);
    // Source of truth wins — the original text/ts survive.
    const history = db.getHistory("c1");
    expect(history).toHaveLength(1);
    expect(history[0].text).toBe("hello");
  });

  test("outbound rows skip the unique index (tg_message_id IS NULL)", () => {
    // Two failed sends both persist with tgMessageId === null. The
    // partial unique index excludes null rows, so both must land.
    db.insertMessage({ chatId: "c1", direction: "out", text: "a", ts: 1 });
    db.insertMessage({ chatId: "c1", direction: "out", text: "b", ts: 2 });
    expect(db.countMessages("c1")).toBe(2);
  });

  test("kv round-trips and overwrites", () => {
    expect(db.getKv("missing")).toBeNull();
    db.setKv("poll_offset", "123");
    expect(db.getKv("poll_offset")).toBe("123");
    db.setKv("poll_offset", "456");
    expect(db.getKv("poll_offset")).toBe("456");
  });
});
