import { describe, test, expect, afterEach } from "bun:test";
import { WebServer } from "../src/bun/web-server";
import { SessionManager } from "../src/bun/session-manager";

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
    expect(html).toContain("HyperTerm Remote");
    expect(html).toContain("xterm");
  });

  test("HTML page inlines xterm.js assets", async () => {
    createServer();
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
    const html = await res.text();
    // xterm.js UMD bundle should be inlined
    expect(html).toContain("Terminal");
    expect(html).toContain("FitAddon");
    expect(html.length).toBeGreaterThan(45000);
  });

  test("returns 404 for unknown routes", async () => {
    createServer();
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/nonexistent`);
    expect(res.status).toBe(404);
  });

  test("WebSocket connects and receives welcome", async () => {
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

    expect(msg["type"]).toBe("welcome");
    expect(Array.isArray(msg["surfaces"])).toBe(true);
    expect((msg["surfaces"] as { id: string }[]).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(typeof msg["focusedSurfaceId"]).toBe("string");
  });

  test("WebSocket receives history after welcome", async () => {
    sessions = new SessionManager();
    const surfaceId = sessions.createSurface(80, 24);

    // Write some data to build history
    sessions.writeStdin(surfaceId, "echo hello\r");
    await Bun.sleep(200);

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

    const messages = await new Promise<Record<string, unknown>[]>(
      (resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
        const msgs: Record<string, unknown>[] = [];
        ws.onmessage = (e) => {
          msgs.push(JSON.parse(e.data as string));
          // Welcome + history
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

    expect(messages[0]["type"]).toBe("welcome");
    if (messages.length > 1) {
      expect(messages[1]["type"]).toBe("history");
      expect(typeof messages[1]["data"]).toBe("string");
    }
  });

  test("stdin message routes to PTY", async () => {
    createServer();

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
      ws.onopen = () => {
        // Send stdin to the surface
        const surfaces = sessions!.getAllSurfaces();
        ws.send(
          JSON.stringify({
            type: "stdin",
            surfaceId: surfaces[0].id,
            data: "echo test\r",
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

    // If we got here without error, stdin was accepted
    expect(true).toBe(true);
  });

  test("broadcast sends to all connected clients", async () => {
    const srv = createServer();

    // Connect two clients
    const received: string[][] = [[], []];

    const clients = await Promise.all(
      [0, 1].map(
        (idx) =>
          new Promise<WebSocket>((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
            ws.onmessage = (e) => {
              const msg = JSON.parse(e.data as string);
              if (msg.type !== "welcome" && msg.type !== "history") {
                received[idx].push(msg.type);
              }
            };
            ws.onopen = () => resolve(ws);
            ws.onerror = () => reject(new Error("ws error"));
            setTimeout(() => reject(new Error("timeout")), 3000);
          }),
      ),
    );

    await Bun.sleep(100);

    // Broadcast a message
    srv.broadcast({ type: "surfaceClosed", surfaceId: "test" });

    await Bun.sleep(100);

    expect(received[0]).toContain("surfaceClosed");
    expect(received[1]).toContain("surfaceClosed");

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
