import { describe, test, expect, afterEach } from "bun:test";
import { WebServer } from "../src/bun/web-server";
import { SessionManager } from "../src/bun/session-manager";
import { WEB_PROTOCOL_VERSION } from "../src/shared/web-protocol";

const TEST_PORT = 18925;

interface Env {
  v: number;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

function firstMessage(
  url: string,
  timeoutMs = 2000,
): Promise<{ msg: Env; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      resolve({ msg: JSON.parse(e.data) as Env, ws });
    };
    ws.onerror = () => reject(new Error("ws error"));
    setTimeout(
      () => reject(new Error("timeout waiting for first message")),
      timeoutMs,
    );
  });
}

function collectForMs(ws: WebSocket, ms: number): Promise<Env[]> {
  return new Promise((resolve) => {
    const msgs: Env[] = [];
    ws.onmessage = (e) => {
      if (typeof e.data === "string") msgs.push(JSON.parse(e.data) as Env);
    };
    setTimeout(() => resolve(msgs), ms);
  });
}

describe("web resume flow", () => {
  let server: WebServer | null = null;
  let sessions: SessionManager | null = null;

  afterEach(() => {
    server?.stop();
    server = null;
    sessions?.destroy();
    sessions = null;
  });

  function startServer(
    opts: {
      bufferMaxBytes?: number;
      ttlMs?: number;
    } = {},
  ): { surfaceId: string; server: WebServer } {
    sessions = new SessionManager();
    const surfaceId = sessions.createSurface(80, 24);
    server = new WebServer(
      TEST_PORT,
      sessions,
      () => ({
        focusedSurfaceId: surfaceId,
        workspaces: [],
        activeWorkspaceId: null,
      }),
      () => surfaceId,
    );
    if (opts.bufferMaxBytes !== undefined)
      server.sessionBufferMaxBytes = opts.bufferMaxBytes;
    if (opts.ttlMs !== undefined) server.sessionTtlMs = opts.ttlMs;
    server.start();
    return { surfaceId, server };
  }

  test("reconnect with resume replays only the delta, no hello", async () => {
    const { server: srv } = startServer();

    // First connection — get the session id and the initial seq.
    const { msg: hello, ws: ws1 } = await firstMessage(
      `ws://127.0.0.1:${TEST_PORT}/`,
    );
    expect(hello.type).toBe("hello");
    const sessionId = (hello.payload as Record<string, unknown>)[
      "sessionId"
    ] as string;
    expect(sessionId.length).toBeGreaterThan(0);
    const lastSeq = hello.seq;
    expect(srv.sessionCount).toBe(1);

    // Emit some broadcasts, then drop the ws (simulating a network blip).
    srv.sendNotification("id:a", "a", "");
    srv.sendNotification("id:b", "b", "");
    await Bun.sleep(50);
    ws1.close();
    await Bun.sleep(30);

    // Emit more broadcasts while detached — these must stay buffered.
    srv.sendNotification("id:c", "c", "");
    srv.sendNotification("id:d", "d", "");
    await Bun.sleep(20);

    // Reconnect with resume.
    const resumeUrl = `ws://127.0.0.1:${TEST_PORT}/?resume=${encodeURIComponent(
      sessionId,
    )}&seq=${lastSeq}`;
    const ws2 = new WebSocket(resumeUrl);
    await new Promise<void>((resolve, reject) => {
      ws2.onopen = () => resolve();
      ws2.onerror = () => reject(new Error("ws error"));
      setTimeout(() => reject(new Error("timeout")), 2000);
    });
    const msgs = await collectForMs(ws2, 200);

    // No hello — delta replay only.
    expect(msgs.find((m) => m.type === "hello")).toBeUndefined();
    // All four notifications should be present, in seq order.
    const titles = msgs
      .filter((m) => m.type === "notification")
      .map((m) => (m.payload as { title: string }).title);
    expect(titles).toEqual(["a", "b", "c", "d"]);
    // Seqs strictly increase and start past the original hello seq.
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i]!.seq).toBeGreaterThan(msgs[i - 1]!.seq);
    }
    expect(msgs[0]!.seq).toBeGreaterThan(lastSeq);
    ws2.close();
  });

  test("resume with truncated ring buffer falls back to fresh hello", async () => {
    // Tiny buffer — any broadcast pair overflows it.
    const { server: srv } = startServer({ bufferMaxBytes: 128 });

    const { msg: hello, ws: ws1 } = await firstMessage(
      `ws://127.0.0.1:${TEST_PORT}/`,
    );
    const sessionId = (hello.payload as Record<string, unknown>)[
      "sessionId"
    ] as string;
    const lastSeq = hello.seq;
    ws1.close();
    await Bun.sleep(30);

    // Overflow the cap so the session is marked truncated.
    for (let i = 0; i < 8; i++) {
      srv.sendNotification(
        `id:overflow-${i}`,
        `overflow-${i}`,
        "x".repeat(200),
      );
    }

    const resumeUrl = `ws://127.0.0.1:${TEST_PORT}/?resume=${encodeURIComponent(
      sessionId,
    )}&seq=${lastSeq}`;
    const { msg: second } = await firstMessage(resumeUrl);
    // Truncated — server fell back to hello with a fresh session.
    expect(second.type).toBe("hello");
    const newSessionId = (second.payload as Record<string, unknown>)[
      "sessionId"
    ] as string;
    expect(newSessionId).not.toBe(sessionId);
  });

  test("session is dropped after TTL expiry without reconnect", async () => {
    const { server: srv } = startServer({ ttlMs: 40 });

    const { ws } = await firstMessage(`ws://127.0.0.1:${TEST_PORT}/`);
    expect(srv.sessionCount).toBe(1);
    ws.close();
    // Wait past the TTL.
    await Bun.sleep(120);
    expect(srv.sessionCount).toBe(0);
  });

  test("resume with an unknown sessionId yields a fresh hello", async () => {
    startServer();
    const { msg } = await firstMessage(
      `ws://127.0.0.1:${TEST_PORT}/?resume=bogus&seq=0`,
    );
    expect(msg.type).toBe("hello");
    expect(msg.v).toBe(WEB_PROTOCOL_VERSION);
  });
});
