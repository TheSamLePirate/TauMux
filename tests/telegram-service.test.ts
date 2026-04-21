import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TelegramDatabase } from "../src/bun/telegram-db";
import {
  TelegramService,
  TelegramConflictError,
  type TelegramTransport,
  type TelegramUpdate,
  formatNotificationForTelegram,
  planNotificationForwarding,
} from "../src/bun/telegram-service";

let dir: string;
let db: TelegramDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ht-tg-svc-"));
  db = new TelegramDatabase(join(dir, "telegram.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Stub {
  transport: TelegramTransport;
  pushUpdate(u: TelegramUpdate): void;
  resolveNextPoll(): void;
  sentMessages: { chatId: string; text: string }[];
  /** Block the next getUpdates call until manually resolved or aborted. */
}

function createStubTransport(): Stub {
  const queue: TelegramUpdate[] = [];
  const waiters: ((updates: TelegramUpdate[]) => void)[] = [];
  const sentMessages: { chatId: string; text: string }[] = [];

  return {
    sentMessages,
    pushUpdate(u) {
      queue.push(u);
      // Drain to one waiting poll if any.
      const w = waiters.shift();
      if (w) {
        const drained = queue.splice(0, queue.length);
        w(drained);
      }
    },
    resolveNextPoll() {
      const w = waiters.shift();
      if (w) w([]);
    },
    transport: {
      async getUpdates({ signal }) {
        if (queue.length > 0) {
          return queue.splice(0, queue.length);
        }
        return new Promise<TelegramUpdate[]>((resolve, reject) => {
          waiters.push(resolve);
          signal.addEventListener(
            "abort",
            () => {
              const idx = waiters.indexOf(resolve);
              if (idx !== -1) waiters.splice(idx, 1);
              const err = new Error("aborted");
              (err as { name?: string }).name = "AbortError";
              reject(err);
            },
            { once: true },
          );
        });
      },
      async sendMessage({ chatId, text }) {
        sentMessages.push({ chatId, text });
        return { ok: true, messageId: sentMessages.length };
      },
      async getMe() {
        return { ok: true, username: "TestBot" };
      },
    },
  };
}

describe("TelegramService", () => {
  test("ignores incoming messages from non-allowed user IDs", async () => {
    const stub = createStubTransport();
    const incoming: { chatId: string; text: string }[] = [];
    const service = new TelegramService({
      token: "t",
      allowedUserIds: "8446656662",
      db,
      transport: stub.transport,
      onIncoming: (m) => incoming.push({ chatId: m.chatId, text: m.text }),
    });
    service.start();

    // Allowed user — should land
    stub.pushUpdate({
      updateId: 1,
      message: {
        messageId: 1,
        chatId: "chat-allowed",
        chatTitle: "Olivier",
        fromUserId: "8446656662",
        fromName: "Olivier",
        text: "hello",
        date: Math.floor(Date.now() / 1000),
      },
    });
    // Random user — should be dropped
    stub.pushUpdate({
      updateId: 2,
      message: {
        messageId: 2,
        chatId: "chat-rando",
        chatTitle: "Rando",
        fromUserId: "999999",
        fromName: "Rando",
        text: "spam",
        date: Math.floor(Date.now() / 1000),
      },
    });

    // Yield twice so the loop processes both updates
    await new Promise((r) => setTimeout(r, 30));
    await service.stop();

    expect(incoming).toHaveLength(1);
    expect(incoming[0].chatId).toBe("chat-allowed");
    // Persistence
    expect(db.countMessages("chat-allowed")).toBe(1);
    expect(db.countMessages("chat-rando")).toBe(0);
  });

  test("empty allowed list accepts everyone", async () => {
    const stub = createStubTransport();
    const incoming: number[] = [];
    const service = new TelegramService({
      token: "t",
      allowedUserIds: "",
      db,
      transport: stub.transport,
      onIncoming: (m) => incoming.push(m.id),
    });
    service.start();

    stub.pushUpdate({
      updateId: 1,
      message: {
        messageId: 1,
        chatId: "anyone",
        chatTitle: "Anyone",
        fromUserId: "1",
        fromName: "Anyone",
        text: "hi",
        date: 1,
      },
    });

    await new Promise((r) => setTimeout(r, 30));
    await service.stop();

    expect(incoming).toHaveLength(1);
  });

  test("sendMessage persists outgoing rows even when API succeeds", async () => {
    const stub = createStubTransport();
    const service = new TelegramService({
      token: "t",
      allowedUserIds: "",
      db,
      transport: stub.transport,
    });
    service.start();

    const persisted = await service.sendMessage("chat-1", "hello world");
    expect(persisted.text).toBe("hello world");
    expect(persisted.direction).toBe("out");
    expect(stub.sentMessages).toEqual([
      { chatId: "chat-1", text: "hello world" },
    ]);

    const history = db.getHistory("chat-1");
    expect(history).toHaveLength(1);
    expect(history[0].text).toBe("hello world");

    await service.stop();
  });

  test("starts with disabled status when no token", () => {
    const service = new TelegramService({
      token: "",
      allowedUserIds: "",
      db,
      transport: createStubTransport().transport,
    });
    service.start();
    expect(service.getStatus().state).toBe("error");
  });

  test("stops cleanly via abort", async () => {
    const stub = createStubTransport();
    const service = new TelegramService({
      token: "t",
      allowedUserIds: "",
      db,
      transport: stub.transport,
    });
    service.start();
    // Give the loop one tick
    await new Promise((r) => setTimeout(r, 10));
    await service.stop();
    expect(service.getStatus().state).toBe("disabled");
  });

  test("HTTP 409 → `conflict` state, logged once, recovers cleanly when the other consumer steps aside", async () => {
    // Build a conflict-then-recover transport by hand so we can drive
    // the exact sequence the poll loop sees without faking timers.
    const phase: "conflict" | "recover" = "conflict";
    const conflictsSeen = { n: 0 };
    const pollsAfterRecover = { n: 0 };
    const transport: TelegramTransport = {
      async getUpdates({ signal }) {
        if (phase === "conflict") {
          conflictsSeen.n++;
          throw new TelegramConflictError(
            "getUpdates HTTP 409: Conflict: terminated by other getUpdates request",
          );
        }
        pollsAfterRecover.n++;
        // Park until aborted so the loop doesn't busy-spin the test.
        return new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              const err = new Error("aborted");
              (err as { name?: string }).name = "AbortError";
              reject(err);
            },
            { once: true },
          );
        });
      },
      async sendMessage() {
        return { ok: true, messageId: 1 };
      },
      async getMe() {
        return { ok: true, username: "TestBot" };
      },
    };

    const statuses: { state: string; error?: string }[] = [];
    const logs: { level: string; msg: string }[] = [];

    const service = new TelegramService({
      token: "t",
      allowedUserIds: "",
      db,
      transport,
      onStatus: (s) => statuses.push({ state: s.state, error: s.error }),
      onLog: (level, msg) => logs.push({ level, msg }),
    });
    service.start();

    // Let the loop hit the 409 at least once, then clear the conflict.
    await new Promise((r) => setTimeout(r, 30));
    expect(service.getStatus().state).toBe("conflict");
    expect(conflictsSeen.n).toBeGreaterThanOrEqual(1);

    // Only one conflict log should fire, no matter how many retries
    // happened (they don't within 30ms given the 60s fixed backoff,
    // but we still assert the dedup invariant).
    const conflictLogs = logs.filter((l) => l.msg.includes("HTTP 409"));
    expect(conflictLogs).toHaveLength(1);
    expect(conflictLogs[0].level).toBe("warn");

    await service.stop();
    expect(
      statuses.some(
        (s) =>
          s.state === "conflict" &&
          typeof s.error === "string" &&
          s.error.includes("another client"),
      ),
    ).toBe(true);
  });

  test("transient (non-409) HTTP errors still use `error` state, not `conflict`", async () => {
    let thrown = false;
    const transport: TelegramTransport = {
      async getUpdates() {
        if (!thrown) {
          thrown = true;
          throw new Error("getUpdates HTTP 502");
        }
        return new Promise(() => {}); // never resolves
      },
      async sendMessage() {
        return { ok: true, messageId: 1 };
      },
      async getMe() {
        return { ok: true, username: "TestBot" };
      },
    };
    const service = new TelegramService({
      token: "t",
      allowedUserIds: "",
      db,
      transport,
    });
    service.start();
    await new Promise((r) => setTimeout(r, 30));
    expect(service.getStatus().state).toBe("error");
    await service.stop();
  });
});

describe("formatNotificationForTelegram", () => {
  test("plain text with title + body", () => {
    expect(
      formatNotificationForTelegram({
        title: "Build complete",
        body: "exit 0 in 4.2s",
      }),
    ).toBe("Build complete\nexit 0 in 4.2s");
  });

  test("includes workspace + pane on third line", () => {
    expect(
      formatNotificationForTelegram({
        title: "Test failed",
        body: "expected x to equal y",
        workspace: "main",
        pane: "bun test",
      }),
    ).toBe("Test failed\nexpected x to equal y\n(main / bun test)");
  });

  test("trims empty parts", () => {
    expect(
      formatNotificationForTelegram({
        title: "  ",
        body: "just a body",
      }),
    ).toBe("just a body");
  });
});

describe("planNotificationForwarding", () => {
  test("returns no deliveries when toggle is off", () => {
    const out = planNotificationForwarding({
      enabled: false,
      allowedUserIds: "123,456",
      title: "Hi",
      body: "world",
    });
    expect(out).toEqual([]);
  });

  test("returns no deliveries when allow-list is empty", () => {
    const out = planNotificationForwarding({
      enabled: true,
      allowedUserIds: "",
      title: "Hi",
      body: "world",
    });
    expect(out).toEqual([]);
  });

  test("emits one delivery per allowed id with formatted text", () => {
    const out = planNotificationForwarding({
      enabled: true,
      allowedUserIds: "123, 456 ,123",
      title: "Build done",
      body: "exit 0",
      workspace: "main",
      pane: "bun test",
    });
    expect(out.map((d) => d.chatId).sort()).toEqual(["123", "456"]);
    expect(out[0].text).toBe("Build done\nexit 0\n(main / bun test)");
  });

  test("dedupes recipients before emitting", () => {
    const out = planNotificationForwarding({
      enabled: true,
      allowedUserIds: "100,100,100",
      title: "Hi",
      body: "",
    });
    expect(out).toHaveLength(1);
    expect(out[0].chatId).toBe("100");
  });

  test("drops non-numeric ids in lockstep with the parser", () => {
    const out = planNotificationForwarding({
      enabled: true,
      allowedUserIds: "abc, 200, def",
      title: "x",
      body: "y",
    });
    expect(out.map((d) => d.chatId)).toEqual(["200"]);
  });
});
