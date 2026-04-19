import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRpcHandler } from "../src/bun/rpc-handler";
import { TelegramDatabase } from "../src/bun/telegram-db";

const mockSessions = {
  getAllSurfaces: () => [],
  getSurface: () => undefined,
  closeSurface: () => {},
  writeStdin: () => {},
  renameSurface: () => {},
  surfaceCount: 0,
} as any;

let dir: string;
let db: TelegramDatabase;

interface FakeService {
  sendMessage: (chatId: string, text: string) => Promise<unknown>;
  getStatus: () => { state: string; botUsername?: string };
}

function setup(opts: { service?: FakeService } = {}) {
  const handler = createRpcHandler(
    mockSessions,
    () => ({
      focusedSurfaceId: null,
      workspaces: [],
      activeWorkspaceId: null,
    }),
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      telegramDb: db,
      getTelegramService: () =>
        (opts.service as unknown as undefined) ??
        (opts.service as unknown as undefined),
    },
  );
  return { handler };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ht-rpc-tg-"));
  db = new TelegramDatabase(join(dir, "telegram.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("RPC handler — telegram methods", () => {
  test("telegram.chats returns empty initially", () => {
    const { handler } = setup();
    expect(handler("telegram.chats", {})).toEqual({ chats: [] });
  });

  test("telegram.chats returns chats inserted via the db", () => {
    db.upsertChat({ id: "c1", name: "Alice", ts: 100 });
    db.upsertChat({ id: "c2", name: "Bob", ts: 200 });
    const { handler } = setup();
    const result = handler("telegram.chats", {}) as {
      chats: Array<{ id: string; name: string }>;
    };
    expect(result.chats.map((c) => c.id)).toEqual(["c2", "c1"]);
  });

  test("telegram.history returns wire-shaped messages oldest-first", () => {
    db.insertMessage({
      chatId: "c1",
      direction: "in",
      text: "first",
      ts: 100,
      tgMessageId: 1,
    });
    db.insertMessage({
      chatId: "c1",
      direction: "out",
      text: "reply",
      ts: 200,
    });
    const { handler } = setup();
    const result = handler("telegram.history", { chat_id: "c1" }) as {
      messages: Array<{ text: string; tgMessageId: number | null }>;
    };
    expect(result.messages.map((m) => m.text)).toEqual(["first", "reply"]);
    expect(result.messages[0].tgMessageId).toBe(1);
    expect(result.messages[1].tgMessageId).toBeNull();
  });

  test("telegram.history honors limit", () => {
    for (let i = 0; i < 100; i++) {
      db.insertMessage({
        chatId: "c1",
        direction: "in",
        text: `m${i}`,
        ts: i,
      });
    }
    const { handler } = setup();
    const result = handler("telegram.history", {
      chat_id: "c1",
      limit: 5,
    }) as { messages: Array<{ text: string }> };
    expect(result.messages.map((m) => m.text)).toEqual([
      "m95",
      "m96",
      "m97",
      "m98",
      "m99",
    ]);
  });

  test("telegram.status returns disabled when no service", () => {
    const { handler } = setup();
    const result = handler("telegram.status", {}) as {
      status: { state: string };
    };
    expect(result.status.state).toBe("disabled");
  });

  test("telegram.status returns the live service status when set", () => {
    const fake: FakeService = {
      sendMessage: async () => ({}),
      getStatus: () => ({ state: "polling", botUsername: "MyBot" }),
    };
    const { handler } = setup({ service: fake });
    const result = handler("telegram.status", {}) as {
      status: { state: string; botUsername?: string };
    };
    expect(result.status.state).toBe("polling");
    expect(result.status.botUsername).toBe("MyBot");
  });

  test("telegram.send rejects when service is not running", async () => {
    const { handler } = setup();
    await expect(
      handler("telegram.send", {
        chat_id: "c1",
        text: "hi",
      }) as Promise<unknown>,
    ).rejects.toThrow(/not running/);
  });

  test("telegram.send rejects without chat id or text", async () => {
    const fake: FakeService = {
      sendMessage: async () => ({}),
      getStatus: () => ({ state: "polling" }),
    };
    const { handler } = setup({ service: fake });
    await expect(
      handler("telegram.send", { text: "hello" }) as Promise<unknown>,
    ).rejects.toThrow(/chat_id is required/);
    await expect(
      handler("telegram.send", { chat_id: "c1" }) as Promise<unknown>,
    ).rejects.toThrow(/text is required/);
  });

  test("telegram.send forwards to the service and returns wire shape", async () => {
    const sent: { chatId: string; text: string }[] = [];
    const fake: FakeService = {
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text });
        return {
          id: 7,
          chatId,
          direction: "out" as const,
          text,
          ts: 1234,
          tgMessageId: 99,
          fromUserId: null,
          fromName: null,
        };
      },
      getStatus: () => ({ state: "polling" }),
    };
    const { handler } = setup({ service: fake });
    const result = (await handler("telegram.send", {
      chat_id: "c1",
      text: "hi there",
    })) as { id: number; tgMessageId: number; text: string; direction: string };
    expect(sent).toEqual([{ chatId: "c1", text: "hi there" }]);
    expect(result.id).toBe(7);
    expect(result.text).toBe("hi there");
    expect(result.direction).toBe("out");
    expect(result.tgMessageId).toBe(99);
  });
});
