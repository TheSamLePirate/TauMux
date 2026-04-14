import { describe, test, expect, afterEach } from "bun:test";
import { WebServer } from "../src/bun/web-server";
import { SessionManager } from "../src/bun/session-manager";
import type { SurfaceMetadata } from "../src/shared/types";

const TEST_PORT = 18926;

interface Env {
  v: number;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

function metadata(overrides: Partial<SurfaceMetadata> = {}): SurfaceMetadata {
  return {
    pid: 1,
    foregroundPid: 1,
    cwd: "/",
    tree: [],
    listeningPorts: [],
    git: null,
    packageJson: null,
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("web M7 — coalescing + dedup", () => {
  let server: WebServer | null = null;
  let sessions: SessionManager | null = null;

  afterEach(() => {
    server?.stop();
    server = null;
    sessions?.destroy();
    sessions = null;
  });

  function startServer(): { surfaceId: string; server: WebServer } {
    sessions = new SessionManager();
    const surfaceId = sessions.createSurface(80, 24);
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
    return { surfaceId, server };
  }

  test("many small stdout chunks coalesce into one output envelope", async () => {
    const { surfaceId, server: srv } = startServer();
    const url = `ws://127.0.0.1:${TEST_PORT}/`;
    const ws = new WebSocket(url);
    const received: Env[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws error"));
      ws.onmessage = (e) => {
        if (typeof e.data === "string")
          received.push(JSON.parse(e.data) as Env);
      };
      setTimeout(() => reject(new Error("timeout")), 2000);
    });
    // Wait for hello + history flush so our fine-grained broadcasts don't
    // get tangled with the initial burst.
    await Bun.sleep(60);
    received.length = 0;

    for (let i = 0; i < 20; i++) srv.broadcastStdout(surfaceId, `chunk-${i};`);
    // Default OUTPUT_COALESCE_MS = 16 — wait well past it.
    await Bun.sleep(80);

    const outputs = received.filter((m) => m.type === "output");
    expect(outputs.length).toBe(1);
    const data = (outputs[0]!.payload as { data: string }).data;
    // All chunks are concatenated, in order.
    for (let i = 0; i < 20; i++) {
      expect(data.includes(`chunk-${i};`)).toBe(true);
    }
    ws.close();
  });

  test("identical surface metadata is deduped", async () => {
    const { surfaceId, server: srv } = startServer();
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/`);
    const received: Env[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws error"));
      ws.onmessage = (e) => {
        if (typeof e.data === "string")
          received.push(JSON.parse(e.data) as Env);
      };
      setTimeout(() => reject(new Error("timeout")), 2000);
    });
    await Bun.sleep(40);
    received.length = 0;

    // First push — should broadcast.
    srv.sendSurfaceMetadata(surfaceId, metadata({ cwd: "/home/a" }));
    // Second push with the same structural payload (different
    // updatedAt) — should be skipped.
    srv.sendSurfaceMetadata(surfaceId, metadata({ cwd: "/home/a" }));
    // Third push changes a field — should broadcast.
    srv.sendSurfaceMetadata(surfaceId, metadata({ cwd: "/home/b" }));

    await Bun.sleep(40);
    const metas = received.filter((m) => m.type === "surfaceMetadata");
    expect(metas.length).toBe(2);
    expect(
      (metas[0]!.payload as { metadata: { cwd: string } }).metadata.cwd,
    ).toBe("/home/a");
    expect(
      (metas[1]!.payload as { metadata: { cwd: string } }).metadata.cwd,
    ).toBe("/home/b");
    ws.close();
  });

  test("output crossing the soft cap flushes immediately", async () => {
    const { surfaceId, server: srv } = startServer();
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/`);
    const received: Env[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws error"));
      ws.onmessage = (e) => {
        if (typeof e.data === "string")
          received.push(JSON.parse(e.data) as Env);
      };
      setTimeout(() => reject(new Error("timeout")), 2000);
    });
    await Bun.sleep(40);
    received.length = 0;

    // One chunk well over the 8 KB soft cap — should be sent without
    // waiting for the coalesce timer to elapse.
    const big = "x".repeat(16 * 1024);
    srv.broadcastStdout(surfaceId, big);
    // Intentionally read before OUTPUT_COALESCE_MS elapses.
    await Bun.sleep(8);

    const outputs = received.filter((m) => m.type === "output");
    expect(outputs.length).toBeGreaterThanOrEqual(1);
    ws.close();
  });
});
