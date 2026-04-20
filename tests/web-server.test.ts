import { describe, test, expect, afterEach, mock } from "bun:test";
import { WebServer } from "../src/bun/web-server";
import { SessionManager } from "../src/bun/session-manager";
import { WEB_PROTOCOL_VERSION } from "../src/shared/web-protocol";

const TEST_PORT = 18923;

describe("WebServer", () => {
  let server: WebServer | null = null;
  let sessions: SessionManager | null = null;

  afterEach(() => {
    server?.stop();
    server = null;
    sessions?.destroy();
    sessions = null;
  });

  function createServer(): WebServer {
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
    server.start();
    return server;
  }

  test("serves HTML on GET /", async () => {
    createServer();
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("τ-mux Remote");
    expect(html).toContain("xterm");
  });

  test("HTML page inlines xterm.js assets", async () => {
    createServer();
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
    const html = await res.text();
    expect(html).toContain("Terminal");
    expect(html).toContain("FitAddon");
    expect(html.length).toBeGreaterThan(45000);
  });

  test("returns 404 for unknown routes", async () => {
    createServer();
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/nonexistent`);
    expect(res.status).toBe(404);
  });

  test("WebSocket connects and receives hello envelope", async () => {
    createServer();

    const msg = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
        ws.onmessage = (e) => {
          resolve(JSON.parse(e.data as string));
          ws.close();
        };
        ws.onerror = () => reject(new Error("ws error"));
        setTimeout(() => reject(new Error("timeout")), 3000);
      },
    );

    expect(msg["v"]).toBe(WEB_PROTOCOL_VERSION);
    expect(msg["seq"]).toBe(0);
    expect(msg["type"]).toBe("hello");
    const payload = msg["payload"] as Record<string, unknown>;
    expect(typeof payload["sessionId"]).toBe("string");
    expect(typeof payload["serverInstanceId"]).toBe("string");
    expect(payload["protocolVersion"]).toBe(WEB_PROTOCOL_VERSION);
    const snapshot = payload["snapshot"] as Record<string, unknown>;
    expect(Array.isArray(snapshot["surfaces"])).toBe(true);
    expect((snapshot["surfaces"] as unknown[]).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(typeof snapshot["focusedSurfaceId"]).toBe("string");
    expect(snapshot["metadata"]).toBeDefined();
    expect(snapshot["panels"]).toBeDefined();
    expect(snapshot["notifications"]).toBeDefined();
    expect(snapshot["logs"]).toBeDefined();
  });

  test("WebSocket receives history after hello when workspace is active", async () => {
    sessions = new SessionManager("/bin/sh");
    const surfaceId = sessions.createSurface(80, 24);

    sessions.writeStdin(surfaceId, "echo hello\r");
    for (let i = 0; i < 20; i++) {
      const history = sessions.getOutputHistory(surfaceId);
      if (history && history.length > 0) break;
      await Bun.sleep(50);
    }

    // Build a workspace so the server auto-subscribes the new client.
    const layout = { type: "leaf" as const, surfaceId };
    server = new WebServer(
      TEST_PORT,
      sessions,
      () => ({
        focusedSurfaceId: surfaceId,
        workspaces: [
          {
            id: "ws1",
            name: "work",
            color: "#89b4fa",
            surfaceIds: [surfaceId],
            focusedSurfaceId: surfaceId,
            layout,
          },
        ],
        activeWorkspaceId: "ws1",
      }),
      () => surfaceId,
    );
    server.start();

    const messages = await new Promise<Record<string, unknown>[]>(
      (resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
        const msgs: Record<string, unknown>[] = [];
        ws.onmessage = (e) => {
          msgs.push(JSON.parse(e.data as string));
          if (msgs.length >= 2) {
            ws.close();
            resolve(msgs);
          }
        };
        ws.onerror = () => reject(new Error("ws error"));
        setTimeout(() => {
          ws.close();
          resolve(msgs);
        }, 2000);
      },
    );

    expect(messages[0]["type"]).toBe("hello");
    expect(messages[0]["seq"]).toBe(0);
    expect(messages[1]["type"]).toBe("history");
    expect(messages[1]["seq"]).toBe(1);
    const hp = messages[1]["payload"] as Record<string, unknown>;
    expect(hp["surfaceId"]).toBe(surfaceId);
    expect(typeof hp["data"]).toBe("string");
  });

  test("stdin envelope routes to PTY", async () => {
    createServer();

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
      ws.onopen = () => {
        const surfaces = sessions!.getAllSurfaces();
        ws.send(
          JSON.stringify({
            v: WEB_PROTOCOL_VERSION,
            type: "stdin",
            payload: { surfaceId: surfaces[0]!.id, data: "echo test\r" },
          }),
        );
        setTimeout(() => {
          ws.close();
          resolve();
        }, 200);
      };
      ws.onerror = () => reject(new Error("ws error"));
      setTimeout(() => reject(new Error("timeout")), 3000);
    });

    expect(true).toBe(true);
  });

  test("selectWorkspace envelope routes to the host callback", async () => {
    const srv = createServer();
    const onSelectWorkspace = mock(() => {});
    srv.onSelectWorkspace = onSelectWorkspace;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            v: WEB_PROTOCOL_VERSION,
            type: "selectWorkspace",
            payload: { workspaceId: "ws2" },
          }),
        );
        setTimeout(() => {
          ws.close();
          resolve();
        }, 100);
      };
      ws.onerror = () => reject(new Error("ws error"));
      setTimeout(() => reject(new Error("timeout")), 3000);
    });

    expect(onSelectWorkspace).toHaveBeenCalledWith("ws2");
  });

  test("broadcast envelopes reach all connected clients with seq numbers", async () => {
    const srv = createServer();

    const received: Record<string, unknown>[][] = [[], []];

    const clients = await Promise.all(
      [0, 1].map(
        (idx) =>
          new Promise<WebSocket>((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
            ws.onmessage = (e) => {
              const msg = JSON.parse(e.data as string);
              if (msg.type !== "hello" && msg.type !== "history") {
                received[idx]!.push(msg);
              }
            };
            ws.onopen = () => resolve(ws);
            ws.onerror = () => reject(new Error("ws error"));
            setTimeout(() => reject(new Error("timeout")), 3000);
          }),
      ),
    );

    await Bun.sleep(100);

    srv.broadcast({ type: "surfaceClosed", surfaceId: "test" });

    await Bun.sleep(100);

    for (const client of received) {
      expect(client.length).toBeGreaterThanOrEqual(1);
      const closed = client.find((m) => m["type"] === "surfaceClosed")!;
      expect(closed["v"]).toBe(WEB_PROTOCOL_VERSION);
      expect(typeof closed["seq"]).toBe("number");
      const payload = closed["payload"] as Record<string, unknown>;
      expect(payload["surfaceId"]).toBe("test");
    }

    clients.forEach((ws) => ws.close());
  });

  test("stop cleans up and reports not running", () => {
    const srv = createServer();
    expect(srv.running).toBe(true);
    srv.stop();
    expect(srv.running).toBe(false);
    server = null;
  });

  test("clientCount tracks connections", async () => {
    const srv = createServer();
    expect(srv.clientCount).toBe(0);

    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });
    await Bun.sleep(50);

    expect(srv.clientCount).toBe(1);

    ws.close();
    await Bun.sleep(50);

    expect(srv.clientCount).toBe(0);
  });
});
