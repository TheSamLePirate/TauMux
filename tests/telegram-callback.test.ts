// Plan #08 coverage — callback_query parsing, button-aware sends,
// inline-keyboard dispatch, allow-list rejection, and the
// notification_links round-trip in TelegramDatabase.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { TelegramDatabase } from "../src/bun/telegram-db";
import {
  parseRawUpdate,
  TelegramService,
  type TelegramTransport,
  type TelegramUpdate,
  type TelegramCallbackInfo,
} from "../src/bun/telegram-service";

let dir: string;
let db: TelegramDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ht-tg-cb-"));
  db = new TelegramDatabase(join(dir, "telegram.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

interface CallbackStub {
  transport: TelegramTransport;
  pushUpdate(u: TelegramUpdate): void;
  sent: Array<{
    chatId: string;
    text: string;
    replyMarkup?: { inline_keyboard: unknown };
  }>;
  acked: string[];
}

/** Fixture transport mirroring the one in `telegram-service.test.ts`
 *  but augmented with the new `answerCallbackQuery` capture and
 *  reply_markup recording so we can assert what landed on the wire. */
function makeStub(): CallbackStub {
  const queue: TelegramUpdate[] = [];
  const waiters: ((updates: TelegramUpdate[]) => void)[] = [];
  const sent: CallbackStub["sent"] = [];
  const acked: string[] = [];

  return {
    sent,
    acked,
    pushUpdate(u) {
      queue.push(u);
      const w = waiters.shift();
      if (w) {
        const drained = queue.splice(0, queue.length);
        w(drained);
      }
    },
    transport: {
      async getUpdates({ signal }) {
        if (queue.length > 0) return queue.splice(0, queue.length);
        return new Promise<TelegramUpdate[]>((resolve, reject) => {
          waiters.push(resolve);
          signal.addEventListener(
            "abort",
            () => {
              const i = waiters.indexOf(resolve);
              if (i !== -1) waiters.splice(i, 1);
              const err = new Error("aborted");
              (err as { name?: string }).name = "AbortError";
              reject(err);
            },
            { once: true },
          );
        });
      },
      async sendMessage({ chatId, text, replyMarkup }) {
        sent.push({
          chatId,
          text,
          replyMarkup: replyMarkup as { inline_keyboard: unknown } | undefined,
        });
        return { ok: true, messageId: sent.length };
      },
      async answerCallbackQuery({ callbackQueryId }) {
        acked.push(callbackQueryId);
        return { ok: true };
      },
      async getMe() {
        return { ok: true, username: "TestBot" };
      },
    },
  };
}

// ── parseRawUpdate(callback_query) ───────────────────────────────

describe("parseRawUpdate — callback_query payloads", () => {
  test("decodes a well-formed callback_query into the typed shape", () => {
    const raw = {
      update_id: 42,
      callback_query: {
        id: "cb-1",
        data: "continue|notif:7",
        from: {
          id: 8446656662,
          first_name: "Olivier",
          username: "olivvein",
        },
        message: {
          message_id: 100,
          chat: { id: 12345 },
        },
      },
    };
    const got = parseRawUpdate(raw);
    expect(got).not.toBeNull();
    expect(got!.callbackQuery).toEqual({
      id: "cb-1",
      fromUserId: "8446656662",
      fromName: "Olivier",
      chatId: "12345",
      messageId: 100,
      data: "continue|notif:7",
    });
  });

  test("rejects callback_query missing the parent message", () => {
    const raw = {
      update_id: 43,
      callback_query: {
        id: "cb-2",
        data: "ok|x",
        from: { id: 1 },
      },
    };
    const got = parseRawUpdate(raw);
    expect(got!.callbackQuery).toBeUndefined();
  });

  test("rejects callback_query missing data", () => {
    const raw = {
      update_id: 44,
      callback_query: {
        id: "cb-3",
        from: { id: 1 },
        message: { message_id: 1, chat: { id: 1 } },
      },
    };
    const got = parseRawUpdate(raw);
    expect(got!.callbackQuery).toBeUndefined();
  });

  test("rejects payloads without an update_id", () => {
    const got = parseRawUpdate({ callback_query: {} });
    expect(got).toBeNull();
  });

  test("preserves the message + callback_query when both are present", () => {
    const raw = {
      update_id: 50,
      message: {
        message_id: 9,
        chat: { id: 12 },
        from: { id: 7, first_name: "Alice" },
        text: "hi",
        date: 1700000000,
      },
      callback_query: {
        id: "cb-50",
        data: "ok|notif:1",
        from: { id: 7 },
        message: { message_id: 100, chat: { id: 12 } },
      },
    };
    const got = parseRawUpdate(raw);
    expect(got!.message).toBeDefined();
    expect(got!.callbackQuery).toBeDefined();
  });
});

// ── service dispatch ─────────────────────────────────────────────

describe("TelegramService — callback dispatch", () => {
  test("emits onCallback for an allowed-list user and acks the query", async () => {
    const stub = makeStub();
    const calls: TelegramCallbackInfo[] = [];
    const service = new TelegramService({
      token: "t",
      allowedUserIds: "8446656662",
      db,
      transport: stub.transport,
      onCallback: (info) => calls.push(info),
    });
    service.start();

    stub.pushUpdate({
      updateId: 10,
      callbackQuery: {
        id: "cb-A",
        fromUserId: "8446656662",
        fromName: "Olivier",
        chatId: "1",
        messageId: 100,
        data: "continue|notif:1",
      },
    });

    // Tick the event loop until the service has handled the update.
    await waitFor(() => calls.length === 1, 1000);
    await service.stop();

    expect(calls[0]).toMatchObject({
      callbackQueryId: "cb-A",
      fromUserId: "8446656662",
      data: "continue|notif:1",
      messageId: 100,
    });
    expect(stub.acked).toEqual(["cb-A"]);
  });

  test("drops callback from non-allow-listed user and acks with 'Not authorised'", async () => {
    const stub = makeStub();
    const calls: TelegramCallbackInfo[] = [];
    const service = new TelegramService({
      token: "t",
      allowedUserIds: "8446656662",
      db,
      transport: stub.transport,
      onCallback: (info) => calls.push(info),
    });
    service.start();

    stub.pushUpdate({
      updateId: 11,
      callbackQuery: {
        id: "cb-B",
        fromUserId: "9999999",
        fromName: "Stranger",
        chatId: "1",
        messageId: 100,
        data: "stop|notif:1",
      },
    });

    // The reject path still calls answerCallbackQuery (for UX); wait for ack.
    await waitFor(() => stub.acked.length === 1, 1000);
    await service.stop();

    expect(calls.length).toBe(0);
    expect(stub.acked).toEqual(["cb-B"]);
  });
});

// ── service sendMessageWithButtons ───────────────────────────────

describe("TelegramService.sendMessageWithButtons", () => {
  test("attaches reply_markup.inline_keyboard on the wire", async () => {
    const stub = makeStub();
    const service = new TelegramService({
      token: "t",
      allowedUserIds: "8446656662",
      db,
      transport: stub.transport,
    });
    await service.sendMessageWithButtons("123", "Build done", [
      [
        { text: "OK", callback_data: "ok|n:1" },
        { text: "Continue", callback_data: "continue|n:1" },
      ],
    ]);
    expect(stub.sent.length).toBe(1);
    expect(stub.sent[0]!.chatId).toBe("123");
    expect(stub.sent[0]!.text).toBe("Build done");
    expect(stub.sent[0]!.replyMarkup).toEqual({
      inline_keyboard: [
        [
          { text: "OK", callback_data: "ok|n:1" },
          { text: "Continue", callback_data: "continue|n:1" },
        ],
      ],
    });
  });

  test("persists the outbound message with the assigned tgMessageId", async () => {
    const stub = makeStub();
    const service = new TelegramService({
      token: "t",
      allowedUserIds: "",
      db,
      transport: stub.transport,
    });
    const persisted = await service.sendMessageWithButtons("9", "hello", [
      [{ text: "OK", callback_data: "ok|x" }],
    ]);
    expect(persisted.tgMessageId).toBe(1);
    expect(persisted.text).toBe("hello");
    expect(persisted.direction).toBe("out");
  });
});

// ── notification_links round-trip ────────────────────────────────

describe("TelegramDatabase — notification_links", () => {
  test("link / get round-trip preserves notification + surface ids", () => {
    db.linkNotification({
      chatId: "1",
      tgMessageId: 100,
      notificationId: "notif:42",
      surfaceId: "surface:3",
    });
    const got = db.getNotificationLink("1", 100);
    expect(got).toEqual({
      notificationId: "notif:42",
      surfaceId: "surface:3",
    });
  });

  test("missing link returns null without throwing", () => {
    expect(db.getNotificationLink("1", 999)).toBeNull();
  });

  test("relink overwrites prior targets (idempotent on the key)", () => {
    db.linkNotification({
      chatId: "1",
      tgMessageId: 100,
      notificationId: "notif:1",
    });
    db.linkNotification({
      chatId: "1",
      tgMessageId: 100,
      notificationId: "notif:2",
      surfaceId: "surface:7",
    });
    expect(db.getNotificationLink("1", 100)).toEqual({
      notificationId: "notif:2",
      surfaceId: "surface:7",
    });
  });

  test("pruneOldNotificationLinks drops rows older than the cutoff", () => {
    db.linkNotification({
      chatId: "1",
      tgMessageId: 1,
      notificationId: "old",
      ts: 1000,
    });
    db.linkNotification({
      chatId: "1",
      tgMessageId: 2,
      notificationId: "new",
      ts: 5000,
    });
    const dropped = db.pruneOldNotificationLinks(2000);
    expect(dropped).toBe(1);
    expect(db.getNotificationLink("1", 1)).toBeNull();
    expect(db.getNotificationLink("1", 2)).not.toBeNull();
  });

  test("pruneOldNotificationLinks returns 0 when nothing matches", () => {
    db.linkNotification({
      chatId: "1",
      tgMessageId: 1,
      notificationId: "x",
      ts: 9999,
    });
    expect(db.pruneOldNotificationLinks(1000)).toBe(0);
  });

  test("surface_id is optional and persists as null", () => {
    db.linkNotification({
      chatId: "1",
      tgMessageId: 5,
      notificationId: "n",
    });
    expect(db.getNotificationLink("1", 5)).toEqual({
      notificationId: "n",
      surfaceId: null,
    });
  });
});

/** Poll a predicate until it's true or `timeoutMs` elapses. Lets tests
 *  await async event-loop work that the long-poll service does
 *  internally without sprinkling sleeps. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: timed out");
    }
    await Bun.sleep(5);
  }
}
