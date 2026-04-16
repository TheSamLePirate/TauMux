import { describe, test, expect, afterEach } from "bun:test";
import { SessionManager } from "../src/bun/session-manager";

async function waitFor(
  fn: () => boolean,
  timeout = 5000,
  interval = 50,
): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor timed out after ${timeout}ms`);
    }
    await Bun.sleep(interval);
  }
}

describe("SessionManager", () => {
  let sessions: SessionManager;

  afterEach(() => {
    sessions?.destroy();
  });

  test("creates a surface with valid id and PID", () => {
    sessions = new SessionManager("/bin/sh");
    const id = sessions.createSurface(80, 24);
    expect(id).toStartWith("surface:");
    expect(sessions.getSurface(id)).toBeDefined();
    expect(sessions.getSurface(id)!.pty.pid).toBeGreaterThan(0);
  });

  test("creates multiple surfaces with unique ids", () => {
    sessions = new SessionManager("/bin/sh");
    const id1 = sessions.createSurface(80, 24);
    const id2 = sessions.createSurface(80, 24);
    expect(id1).not.toBe(id2);
    expect(sessions.surfaceCount).toBe(2);
  });

  test("routes stdout by surfaceId", async () => {
    sessions = new SessionManager("/bin/sh");
    const received: { surfaceId: string; data: string }[] = [];
    sessions.onStdout = (surfaceId, data) => {
      received.push({ surfaceId, data });
    };

    const id = sessions.createSurface(80, 24);
    sessions.writeStdin(id, "echo ROUTED\n");

    await waitFor(() =>
      received.some((r) => r.surfaceId === id && r.data.includes("ROUTED")),
    );
    const match = received.find(
      (r) => r.surfaceId === id && r.data.includes("ROUTED"),
    );
    expect(match).toBeDefined();
  });

  test("closes a surface and fires callback", async () => {
    sessions = new SessionManager("/bin/sh");
    let closedId: string | null = null;
    sessions.onSurfaceClosed = (id) => {
      closedId = id;
    };

    const id = sessions.createSurface(80, 24);
    expect(sessions.surfaceCount).toBe(1);

    sessions.closeSurface(id);
    expect(sessions.surfaceCount).toBe(0);
    expect(closedId).toBe(id);
  });

  test("surface closes when shell exits", async () => {
    sessions = new SessionManager("/bin/sh");
    let closedId: string | null = null;
    sessions.onSurfaceClosed = (id) => {
      closedId = id;
    };

    const id = sessions.createSurface(80, 24);
    sessions.writeStdin(id, "exit 0\n");

    await waitFor(() => closedId === id, 5000);
    expect(closedId).toBe(id);
    expect(sessions.surfaceCount).toBe(0);
  });

  test("resize routes to correct surface and updates tracked dims", () => {
    sessions = new SessionManager("/bin/sh");
    const id1 = sessions.createSurface(80, 24);
    const id2 = sessions.createSurface(80, 24);

    sessions.resize(id1, 120, 40);

    // Verify the resize actually propagated to the PTY, and stayed
    // scoped to id1. A silent no-op here was the H3 bug — so we
    // assert on the observable state, not just absence-of-throw.
    expect(sessions.getSurface(id1)!.pty.cols).toBe(120);
    expect(sessions.getSurface(id1)!.pty.rows).toBe(40);
    expect(sessions.getSurface(id2)!.pty.cols).toBe(80);
    expect(sessions.getSurface(id2)!.pty.rows).toBe(24);
  });

  test("resize on non-existent surface does not throw", () => {
    sessions = new SessionManager("/bin/sh");
    expect(() => sessions.resize("bogus", 120, 40)).not.toThrow();
  });

  test("getAllSurfaces returns every created surface by id", () => {
    sessions = new SessionManager("/bin/sh");
    const a = sessions.createSurface(80, 24);
    const b = sessions.createSurface(80, 24);
    const c = sessions.createSurface(80, 24);

    const all = sessions.getAllSurfaces();
    expect(all.length).toBe(3);
    const ids = all.map((s) => s.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(ids).toContain(c);
    // Each surface has a live PID distinct from the others.
    const pids = all.map((s) => s.pty.pid);
    expect(new Set(pids).size).toBe(3);
    for (const p of pids) expect(typeof p).toBe("number");
  });

  test("renameSurface updates the stored title", () => {
    sessions = new SessionManager("/bin/sh");
    const id = sessions.createSurface(80, 24);

    sessions.renameSurface(id, "Server");

    expect(sessions.getSurface(id)?.title).toBe("Server");
  });

  test("destroy cleans up all surfaces", () => {
    sessions = new SessionManager("/bin/sh");
    sessions.createSurface(80, 24);
    sessions.createSurface(80, 24);

    sessions.destroy();
    expect(sessions.surfaceCount).toBe(0);
  });

  test("writeStdin to non-existent surface does not throw", () => {
    sessions = new SessionManager("/bin/sh");
    expect(() => sessions.writeStdin("bogus", "test")).not.toThrow();
  });

  test("closeSurface on non-existent surface does not throw", () => {
    sessions = new SessionManager("/bin/sh");
    expect(() => sessions.closeSurface("bogus")).not.toThrow();
  });

  test("uses custom cwd (and records it on the surface)", async () => {
    sessions = new SessionManager("/bin/sh");
    const received: string[] = [];
    sessions.onStdout = (_, data) => {
      received.push(data);
    };

    const id = sessions.createSurface(80, 24, "/tmp");
    // Surface records the validated cwd. On macOS /tmp resolves via
    // realpath to /private/tmp — accept either.
    expect(sessions.getSurface(id)!.cwd).toMatch(/(^|\/)tmp$/);

    sessions.writeStdin(id, "pwd\n");
    await waitFor(() => received.some((d) => d.includes("/tmp")));
    expect(received.some((d) => d.includes("/tmp"))).toBe(true);
  });

  test("rejects bogus cwd and falls back to HOME", () => {
    sessions = new SessionManager("/bin/sh");
    const id = sessions.createSurface(
      80,
      24,
      "/definitely/not/a/real/path-xyz",
    );
    const home = process.env["HOME"] || "/";
    // Never honors a nonexistent path from a caller.
    expect(sessions.getSurface(id)!.cwd).toBe(home);
  });

  test("writeStdin to known surface reaches the shell (round-trip)", async () => {
    sessions = new SessionManager("/bin/sh");
    const received: string[] = [];
    sessions.onStdout = (_, data) => {
      received.push(data);
    };
    const id = sessions.createSurface(80, 24);
    sessions.writeStdin(id, "echo HYPERTERM_RX\n");
    await waitFor(() => received.some((d) => d.includes("HYPERTERM_RX")));
    // And the PID we own stayed the same across the write.
    const s = sessions.getSurface(id)!;
    expect(typeof s.pty.pid).toBe("number");
    expect(s.pty.pid).toBeGreaterThan(0);
  });

  test("destroy tears down PTYs (pid becomes null on destroyed PTY)", () => {
    sessions = new SessionManager("/bin/sh");
    const id1 = sessions.createSurface(80, 24);
    const id2 = sessions.createSurface(80, 24);
    const pty1 = sessions.getSurface(id1)!.pty;
    const pty2 = sessions.getSurface(id2)!.pty;
    expect(pty1.pid).toBeGreaterThan(0);
    expect(pty2.pid).toBeGreaterThan(0);

    sessions.destroy();

    // Surfaces are unregistered; the PTY instances themselves are
    // destroyed (pid cleared). This is the contract index.ts relies on
    // during graceful shutdown.
    expect(sessions.surfaceCount).toBe(0);
    expect(pty1.pid).toBeNull();
    expect(pty2.pid).toBeNull();
  });
});
