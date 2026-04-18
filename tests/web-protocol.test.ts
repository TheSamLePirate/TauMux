import { describe, test, expect, afterEach } from "bun:test";
import { WebServer } from "../src/bun/web-server";
import { SessionManager } from "../src/bun/session-manager";
import { WEB_PROTOCOL_VERSION } from "../src/shared/web-protocol";
import type { SurfaceMetadata } from "../src/shared/types";

const TEST_PORT = 18924;

interface Env {
  v: number;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

function makeMetadata(
  overrides: Partial<SurfaceMetadata> = {},
): SurfaceMetadata {
  return {
    pid: 1,
    foregroundPid: 1,
    cwd: "/tmp",
    tree: [],
    listeningPorts: [],
    git: null,
    packageJson: null,
    updatedAt: Date.now(),
    ...overrides,
  };
}

async function collectMessages(
  url: string,
  count: number,
  timeoutMs = 2000,
): Promise<{ messages: Env[]; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages: Env[] = [];
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      messages.push(JSON.parse(e.data) as Env);
      if (messages.length >= count) resolve({ messages, ws });
    };
    ws.onerror = () => reject(new Error("ws error"));
    setTimeout(() => resolve({ messages, ws }), timeoutMs);
  });
}

describe("web protocol v2", () => {
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
      activeWorkspaceId?: string | null;
      workspaces?: {
        id: string;
        name: string;
        color: string;
        surfaceIds: string[];
        focusedSurfaceId: string | null;
        layout: { type: "leaf"; surfaceId: string };
      }[];
    } = {},
  ): { surfaceId: string; server: WebServer } {
    sessions = new SessionManager();
    const surfaceId = sessions.createSurface(80, 24);
    server = new WebServer(
      TEST_PORT,
      sessions,
      () => ({
        focusedSurfaceId: surfaceId,
        workspaces: opts.workspaces ?? [],
        activeWorkspaceId: opts.activeWorkspaceId ?? null,
      }),
      () => surfaceId,
    );
    server.start();
    return { surfaceId, server };
  }

  test("hello carries protocol version, session id, and full snapshot shape", async () => {
    startServer();
    const { messages, ws } = await collectMessages(
      `ws://127.0.0.1:${TEST_PORT}`,
      1,
    );
    const hello = messages[0]!;
    expect(hello.v).toBe(WEB_PROTOCOL_VERSION);
    expect(hello.seq).toBe(0);
    expect(hello.type).toBe("hello");
    const p = hello.payload as Record<string, unknown>;
    expect(typeof p["sessionId"]).toBe("string");
    expect((p["sessionId"] as string).length).toBeGreaterThan(0);
    expect(typeof p["serverInstanceId"]).toBe("string");
    expect(p["protocolVersion"]).toBe(WEB_PROTOCOL_VERSION);
    expect(Array.isArray(p["capabilities"])).toBe(true);
    const snap = p["snapshot"] as Record<string, unknown>;
    for (const key of [
      "nativeViewport",
      "surfaces",
      "workspaces",
      "activeWorkspaceId",
      "focusedSurfaceId",
      "sidebarVisible",
      "metadata",
      "panels",
      "notifications",
      "logs",
      "status",
      "progress",
    ]) {
      expect(snap).toHaveProperty(key);
    }
    ws.close();
  });

  test("snapshot replays metadata, notifications, and logs captured before connect", async () => {
    const { surfaceId, server: srv } = startServer();
    const meta = makeMetadata({ cwd: "/home/alice" });
    srv.sendSurfaceMetadata(surfaceId, meta);
    srv.sendNotification("notif:1", "Build failed", "tsc error on line 12");
    srv.sendSidebarAction("log", {
      workspaceId: "ws",
      level: "warning",
      message: "slow compile",
    });

    const { messages, ws } = await collectMessages(
      `ws://127.0.0.1:${TEST_PORT}`,
      1,
    );
    const hello = messages[0]!;
    const snap = (hello.payload as Record<string, unknown>)[
      "snapshot"
    ] as Record<string, unknown>;
    const metadata = snap["metadata"] as Record<string, SurfaceMetadata>;
    expect(metadata[surfaceId]).toBeDefined();
    expect(metadata[surfaceId]!.cwd).toBe("/home/alice");
    const notifs = snap["notifications"] as { title: string }[];
    expect(notifs.length).toBe(1);
    expect(notifs[0]!.title).toBe("Build failed");
    const logs = snap["logs"] as { level: string; message: string }[];
    expect(logs.length).toBe(1);
    expect(logs[0]!.level).toBe("warning");
    ws.close();
  });

  test("sequence numbers are strictly monotonic per connection", async () => {
    const { server: srv } = startServer();
    const { messages, ws } = await collectMessages(
      `ws://127.0.0.1:${TEST_PORT}`,
      1,
    );
    await Bun.sleep(30);
    // Emit a handful of broadcasts; each should bump seq by one.
    srv.sendNotification("id:n1", "n1", "");
    srv.sendNotification("id:n2", "n2", "");
    srv.sendNotification("id:n3", "n3", "");
    srv.sendNotificationClear();
    await Bun.sleep(150);

    // We already got hello (seq=0). Now collect the rest.
    // Reuse the open ws — wire a new message handler.
    const extra: Env[] = [];
    ws.onmessage = (e) => {
      if (typeof e.data === "string") extra.push(JSON.parse(e.data) as Env);
    };
    await Bun.sleep(100);

    expect(messages[0]!.seq).toBe(0);
    // Any subsequent envelopes must have strictly increasing seq.
    const all = [...messages, ...extra];
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.seq).toBe(all[i - 1]!.seq + 1);
    }
    ws.close();
  });

  test("legacy flat client messages still route (for conservative forward-compat)", async () => {
    const { surfaceId } = startServer();
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws error"));
    });
    // Flat client message (no envelope) — server should still accept it.
    ws.send(JSON.stringify({ type: "stdin", surfaceId, data: "x" }));
    await Bun.sleep(50);
    ws.close();
    // If the flat message crashed the handler the server would be in a bad
    // state; we assert the server remains running.
    expect(server!.running).toBe(true);
  });

  test("sideband binary frames carry v and seq in the header", async () => {
    const { surfaceId, server: srv } = startServer();
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    ws.binaryType = "arraybuffer";
    const headers: Record<string, unknown>[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws error"));
    });
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        const buf = new Uint8Array(e.data);
        const dv = new DataView(e.data);
        const hLen = dv.getUint32(0, false);
        const hdr = JSON.parse(
          new TextDecoder().decode(buf.subarray(4, 4 + hLen)),
        );
        headers.push(hdr);
      }
    };

    // Give the server time to flush hello before we expect the binary.
    await Bun.sleep(50);
    srv.broadcastSidebandBinary(
      surfaceId,
      "panel-1",
      new Uint8Array([1, 2, 3]),
    );
    await Bun.sleep(100);

    expect(headers.length).toBeGreaterThan(0);
    const hdr = headers[0]!;
    expect(hdr["v"]).toBe(WEB_PROTOCOL_VERSION);
    expect(hdr["type"]).toBe("sidebandData");
    expect(typeof hdr["seq"]).toBe("number");
    expect(hdr["surfaceId"]).toBe(surfaceId);
    expect(hdr["id"]).toBe("panel-1");
    ws.close();
  });
});
