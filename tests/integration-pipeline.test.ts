import { describe, test, expect, afterEach } from "bun:test";
import { SessionManager } from "../src/bun/session-manager";
import { SurfaceMetadataPoller } from "../src/bun/surface-metadata";
import type { SurfaceMetadata } from "../src/shared/types";

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

// NOTE on sideband integration: we deliberately do NOT drive fd 3 via
// an interactive shell's `>&3` redirect here. macOS /bin/sh and
// /bin/bash reject writes to the pipe-backed fd 3 under our spawn
// config with "Bad file descriptor" — fd 3 is present in /dev/fd but
// the shell's own redirect parser refuses it (it reports
// r--r----- permissions on the synthetic /dev/fd/3 node). The production
// code path that exercises fd 3 always writes from a child
// process (TS/Python demo scripts) using Bun.write(Bun.file(fd), ...)
// or os.fdopen(3, 'w'), which does work — see scripts/test_cpu.ts and
// scripts/hyperterm.py. The SidebandParser's behavior on byte streams
// is covered comprehensively in tests/sideband-parser.test.ts
// (~400 lines, every frame type); the SessionManager→parser wiring is
// 3 lines of glue that just forwards onMeta/onData. What's left to
// cover end-to-end is the metadata-polling loop wired to a real PTY,
// which is what this file focuses on.

describe("integration: SurfaceMetadataPoller against real PTY", () => {
  let sessions: SessionManager | null = null;
  let poller: SurfaceMetadataPoller | null = null;

  afterEach(() => {
    poller?.stop();
    poller = null;
    sessions?.destroy();
    sessions = null;
  });

  test("first tick populates a snapshot that includes the surface pid", async () => {
    sessions = new SessionManager("/bin/sh");
    const id = sessions.createSurface(80, 24);
    const pid = sessions.getSurface(id)!.pty.pid!;
    expect(pid).toBeGreaterThan(0);

    // Tight poll interval so the initial + 1-2 backup ticks fire fast.
    poller = new SurfaceMetadataPoller(sessions, 200);

    const snapshots: SurfaceMetadata[] = [];
    poller.onMetadata = (_id, meta) => snapshots.push(meta);

    poller.start();

    // Wait for a snapshot with the surface's pid in its tree.
    await waitFor(
      () =>
        snapshots.some(
          (s) => s.pid === pid && s.tree.some((n) => n.pid === pid),
        ),
      6000,
    );

    const s = snapshots.find(
      (x) => x.pid === pid && x.tree.some((n) => n.pid === pid),
    )!;
    expect(s.pid).toBe(pid);
    expect(s.tree.length).toBeGreaterThan(0);
    // The root of the tree is the shell PID we spawned.
    expect(s.tree[0]!.pid).toBe(pid);
    // getSnapshot() reflects the same data.
    const live = poller.getSnapshot(id)!;
    expect(live).toBeDefined();
    expect(live.pid).toBe(pid);
  }, 20000);

  test("snapshot gets dropped when the surface is closed", async () => {
    sessions = new SessionManager("/bin/sh");
    const id = sessions.createSurface(80, 24);
    poller = new SurfaceMetadataPoller(sessions, 200);
    poller.start();

    await waitFor(() => poller!.getSnapshot(id) !== null, 6000);
    expect(poller.getSnapshot(id)).not.toBeNull();

    sessions.closeSurface(id);

    // Next tick observes the live-surfaces set no longer includes id
    // and prunes its entry from `this.last`.
    await waitFor(() => poller!.getSnapshot(id) === null, 6000);
    expect(poller.getSnapshot(id)).toBeNull();
  }, 20000);

  test("stop() during a live poll doesn't throw, and start() after is clean", async () => {
    sessions = new SessionManager("/bin/sh");
    sessions.createSurface(80, 24);
    poller = new SurfaceMetadataPoller(sessions, 100);
    poller.start();
    // Don't await — tick is in flight. Calling stop() synchronously
    // tests the `stopped` fence.
    poller.stop();
    // Restart cleanly.
    poller.start();
    // Make sure we get at least one snapshot after restart.
    await waitFor(
      () =>
        sessions!.getAllSurfaces().every((s) => !!poller!.getSnapshot(s.id)),
      6000,
    );
    expect(poller.getSnapshot(sessions.getAllSurfaces()[0]!.id)).not.toBeNull();
  }, 20000);

  test("tracks multiple surfaces independently in a single tick", async () => {
    sessions = new SessionManager("/bin/sh");
    const id1 = sessions.createSurface(80, 24);
    const id2 = sessions.createSurface(80, 24);
    const pid1 = sessions.getSurface(id1)!.pty.pid!;
    const pid2 = sessions.getSurface(id2)!.pty.pid!;
    expect(pid1).not.toBe(pid2);

    poller = new SurfaceMetadataPoller(sessions, 200);
    poller.start();

    await waitFor(
      () =>
        poller!.getSnapshot(id1) !== null && poller!.getSnapshot(id2) !== null,
      6000,
    );

    const s1 = poller.getSnapshot(id1)!;
    const s2 = poller.getSnapshot(id2)!;
    expect(s1.pid).toBe(pid1);
    expect(s2.pid).toBe(pid2);
    // Trees are disjoint — each surface should root at its own pid.
    expect(s1.tree.some((n) => n.pid === pid1)).toBe(true);
    expect(s2.tree.some((n) => n.pid === pid2)).toBe(true);
    expect(s1.tree.some((n) => n.pid === pid2)).toBe(false);
    expect(s2.tree.some((n) => n.pid === pid1)).toBe(false);
  }, 20000);
});
