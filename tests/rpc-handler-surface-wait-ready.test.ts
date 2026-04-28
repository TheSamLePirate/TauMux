// E.1 — surface RPC startup-race queue + surface.wait_ready.
//
// Before: surface.kill_port / surface.open_port threw "no metadata yet"
// the moment they fired before the metadata poller's first tick.
// After: both methods poll the cache for up to 2s before failing.
// surface.wait_ready exposes the same wait as an explicit method
// callers can invoke to synchronize.
//
// We don't spin up the real SurfaceMetadataPoller (it would force
// SessionManager + ps + lsof for every test) — instead we hand the RPC
// handler a stub that exposes `getSnapshot` and lets us flip its
// answer at known times.

import { describe, test, expect, afterEach } from "bun:test";
import { SessionManager } from "../src/bun/session-manager";
import { createRpcHandler, type AppState } from "../src/bun/rpc-handler";
import type { SurfaceMetadata } from "../src/shared/types";
import type { SurfaceMetadataPoller } from "../src/bun/surface-metadata";

function makeState(): AppState {
  return {
    focusedSurfaceId: "surface:1",
    workspaces: [
      {
        id: "ws:1",
        name: "Test",
        color: "#89b4fa",
        surfaceIds: ["surface:1"],
        focusedSurfaceId: "surface:1",
        layout: { type: "leaf", surfaceId: "surface:1" },
      },
    ],
    activeWorkspaceId: "ws:1",
  };
}

function fakeMetadata(): SurfaceMetadata {
  return {
    pid: 999,
    foregroundPid: 1000,
    cwd: "/tmp",
    tree: [{ pid: 1000, ppid: 999, command: "test", cpu: 0, rssKb: 0 }],
    listeningPorts: [{ pid: 1000, port: 3000, proto: "tcp", address: "*" }],
    git: null,
    packageJson: null,
    cargoToml: null,
    updatedAt: Date.now(),
  };
}

/** Minimal stub: only the methods our handlers call. Cast to the full
 *  type at the boundary — the rest of SurfaceMetadataPoller is unused. */
function pollerStub(initial: SurfaceMetadata | null = null) {
  let current: SurfaceMetadata | null = initial;
  const stub = {
    getSnapshot: (_id: string) => current,
    setSnapshot: (m: SurfaceMetadata | null) => {
      current = m;
    },
  };
  return stub;
}

describe("surface.wait_ready (E.1)", () => {
  let sessions: SessionManager;
  afterEach(() => {
    sessions?.destroy();
  });

  function setup(initial: SurfaceMetadata | null) {
    sessions = new SessionManager("/bin/sh");
    const stub = pollerStub(initial);
    const handler = createRpcHandler(
      sessions,
      makeState,
      () => {},
      undefined,
      stub as unknown as SurfaceMetadataPoller,
    );
    return { handler, stub };
  }

  test("returns the snapshot immediately when already cached", async () => {
    const { handler } = setup(fakeMetadata());
    const result = await handler("surface.wait_ready", {
      surface_id: "surface:1",
      timeout_ms: 500,
    });
    expect(result).toBeDefined();
    expect((result as SurfaceMetadata).pid).toBe(999);
  });

  test("returns null after timeout if no metadata ever arrives", async () => {
    const { handler } = setup(null);
    const start = Date.now();
    const result = await handler("surface.wait_ready", {
      surface_id: "surface:1",
      timeout_ms: 250,
    });
    const elapsed = Date.now() - start;
    expect(result).toBeNull();
    // Should respect the requested timeout (with some slack for the
    // poll interval — we sleep 100 ms between checks).
    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(800);
  });

  test("resolves once metadata appears mid-wait", async () => {
    const { handler, stub } = setup(null);
    setTimeout(() => stub.setSnapshot(fakeMetadata()), 200);
    const result = await handler("surface.wait_ready", {
      surface_id: "surface:1",
      timeout_ms: 1000,
    });
    expect(result).not.toBeNull();
    expect((result as SurfaceMetadata).pid).toBe(999);
  });
});

describe("surface.open_port — startup-race queue (E.1)", () => {
  let sessions: SessionManager;
  afterEach(() => {
    sessions?.destroy();
  });

  test("waits for metadata instead of throwing immediately", async () => {
    sessions = new SessionManager("/bin/sh");
    const stub = pollerStub(null);
    const dispatched: { action: string; payload: Record<string, unknown> }[] =
      [];
    const handler = createRpcHandler(
      sessions,
      makeState,
      (action, payload) => dispatched.push({ action, payload }),
      undefined,
      stub as unknown as SurfaceMetadataPoller,
    );

    // Simulate the poller's first tick landing 150 ms after the caller
    // invokes us. Pre-fix this would have thrown immediately.
    setTimeout(() => stub.setSnapshot(fakeMetadata()), 150);

    const result = (await handler("surface.open_port", {
      surface_id: "surface:1",
    })) as { url: string; port: number };

    expect(result.port).toBe(3000);
    expect(result.url).toBe("http://localhost:3000");
    expect(dispatched[0]?.action).toBe("openExternal");
  });

  test("throws a clearer error when the wait window expires", async () => {
    sessions = new SessionManager("/bin/sh");
    const stub = pollerStub(null);
    const handler = createRpcHandler(
      sessions,
      makeState,
      () => {},
      undefined,
      stub as unknown as SurfaceMetadataPoller,
    );
    // No setSnapshot — metadata never arrives. The handler default
    // wait is 2 s; this test bypasses that by going through the public
    // surface (which uses the default) and verifies the new wording.
    await expect(
      handler("surface.open_port", { surface_id: "surface:1" }),
    ).rejects.toThrow(/surface metadata unavailable/);
  }, 5000);
});
