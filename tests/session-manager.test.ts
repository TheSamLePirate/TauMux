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

  test("resize routes to correct surface", async () => {
    sessions = new SessionManager("/bin/sh");
    const id = sessions.createSurface(80, 24);

    // Should not throw
    expect(() => sessions.resize(id, 120, 40)).not.toThrow();
  });

  test("getAllSurfaces returns all surfaces", () => {
    sessions = new SessionManager("/bin/sh");
    sessions.createSurface(80, 24);
    sessions.createSurface(80, 24);
    sessions.createSurface(80, 24);

    expect(sessions.getAllSurfaces().length).toBe(3);
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

  test("uses custom cwd", async () => {
    sessions = new SessionManager("/bin/sh");
    const received: string[] = [];
    sessions.onStdout = (_, data) => {
      received.push(data);
    };

    const id = sessions.createSurface(80, 24, "/tmp");
    sessions.writeStdin(id, "pwd\n");

    await waitFor(() => received.some((d) => d.includes("/tmp")));
    expect(received.some((d) => d.includes("/tmp"))).toBe(true);
  });
});
