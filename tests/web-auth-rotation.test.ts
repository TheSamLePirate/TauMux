// W1-1 (full_app_review_2026-05.md §9.4): setAuthToken applies a token
// change to the LIVE web mirror with no restart, and clears the per-IP
// brute-force buckets so a rotation takes full effect immediately. Before
// this, setAuthToken was dead code — a token added/rotated in Settings
// didn't affect the running server until a restart.

import { describe, test, expect, afterEach } from "bun:test";
import { WebServer } from "../src/bun/web-server";
import { SessionManager } from "../src/bun/session-manager";

const TEST_PORT = 18931;

describe("web mirror auth-token rotation", () => {
  let server: WebServer | null = null;
  let sessions: SessionManager | null = null;

  afterEach(() => {
    server?.stop();
    server = null;
    sessions?.destroy();
    sessions = null;
  });

  function startServer(token: string): WebServer {
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
      "127.0.0.1",
      token,
    );
    server.start();
    return server;
  }

  test("adding a token at runtime makes a tokenless server require auth", async () => {
    const srv = startServer("");
    // No token configured → served.
    const before = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
    expect(before.status).toBe(200);
    await before.arrayBuffer();

    // Rotate in a token live.
    srv.setAuthToken("s3cret");

    const noTok = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
    expect(noTok.status).toBe(401);
    await noTok.arrayBuffer();

    const withTok = await fetch(`http://127.0.0.1:${TEST_PORT}/?t=s3cret`);
    expect(withTok.status).toBe(200);
    await withTok.arrayBuffer();
  });

  test("rotating the token clears the per-IP brute-force cooldown", async () => {
    const srv = startServer("old-token");

    // Trip the throttle: > AUTH_FAIL_LIMIT (10) failed attempts in the
    // window puts this IP into the 429 cooldown.
    let saw429 = false;
    for (let i = 0; i < 14; i++) {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/?t=wrong`);
      if (res.status === 429) saw429 = true;
      await res.arrayBuffer();
    }
    expect(saw429).toBe(true);

    // Rotate the token — this must clear the cooldown bucket so a client
    // presenting the NEW token isn't stuck behind a stale 429.
    srv.setAuthToken("new-token");

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/?t=new-token`);
    expect(res.status).toBe(200);
    await res.arrayBuffer();
  });
});
