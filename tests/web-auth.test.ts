import { describe, test, expect, afterEach } from "bun:test";
import { WebServer } from "../src/bun/web-server";
import { SessionManager } from "../src/bun/session-manager";

const TEST_PORT = 18927;

describe("web mirror auth", () => {
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
      bind?: "127.0.0.1" | "0.0.0.0";
      token?: string;
    } = {},
  ): WebServer {
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
      () => true,
      opts.bind ?? "127.0.0.1",
      opts.token ?? "",
    );
    server.start();
    return server;
  }

  test("GET / without token returns 401 when auth is configured", async () => {
    startServer({ token: "s3cret" });
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
    expect(res.status).toBe(401);
  });

  test("GET / with wrong token returns 401", async () => {
    startServer({ token: "s3cret" });
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/?t=nope`);
    expect(res.status).toBe(401);
  });

  test("every response carries security headers (H.2 / S6)", async () => {
    startServer({ token: "" });
    for (const path of ["/", "/manifest.json", "/sw.js", "/no-such-path"]) {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}${path}`);
      expect(
        res.headers.get("x-frame-options"),
        `missing X-Frame-Options on ${path}`,
      ).toBe("DENY");
      expect(
        res.headers.get("x-content-type-options"),
        `missing nosniff on ${path}`,
      ).toBe("nosniff");
      expect(
        res.headers.get("referrer-policy"),
        `missing referrer-policy on ${path}`,
      ).toBe("no-referrer");
      expect(
        res.headers.get("content-security-policy"),
        `missing CSP on ${path}`,
      ).toContain("frame-ancestors 'none'");
      expect(
        res.headers.get("permissions-policy"),
        `missing permissions-policy on ${path}`,
      ).toContain("camera=()");
      // drain so the connection closes cleanly
      await res.arrayBuffer();
    }
  });

  test("401 on auth failure also carries security headers", async () => {
    startServer({ token: "s3cret" });
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/?t=wrong`);
    expect(res.status).toBe(401);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    await res.arrayBuffer();
  });

  test("GET / with correct token returns 200", async () => {
    startServer({ token: "s3cret" });
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/?t=s3cret`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("τ-mux Remote");
  });

  test("Authorization: Bearer header is accepted", async () => {
    startServer({ token: "s3cret" });
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/`, {
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(res.status).toBe(200);
  });

  test("WS upgrade without token is rejected (401)", async () => {
    startServer({ token: "s3cret" });
    const result = await new Promise<"open" | "err">((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
      ws.onopen = () => resolve("open");
      ws.onerror = () => resolve("err");
      ws.onclose = () => resolve("err");
      setTimeout(() => resolve("err"), 500);
    });
    // Bun's client sees either an error or a 401-close on upgrade
    // rejection. Either way, never "open".
    expect(result).toBe("err");
  });

  test("WS upgrade with valid token connects", async () => {
    startServer({ token: "s3cret" });
    const result = await new Promise<"open" | "err">((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/?t=s3cret`);
      ws.onopen = () => {
        ws.close();
        resolve("open");
      };
      ws.onerror = () => resolve("err");
      setTimeout(() => resolve("err"), 1000);
    });
    expect(result).toBe("open");
  });

  test("No token means open access (back-compat)", async () => {
    startServer();
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
    expect(res.status).toBe(200);
  });
});
