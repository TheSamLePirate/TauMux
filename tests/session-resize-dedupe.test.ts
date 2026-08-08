/**
 * Redundant resizes must not reach the PTY.
 *
 * `applyLayout()` calls `onResize` for every pane on every full layout
 * pass — workspace switch, sidebar toggle, settings apply, font change,
 * divider mouse-up — and `fitSurfaceTerminal` deliberately no-ops when
 * the grid is unchanged, so the overwhelming majority of those carry
 * dimensions that are already in force. Forwarding them means
 * `TIOCSWINSZ`, which means SIGWINCH to the foreground process group,
 * which for a full-screen TUI means a complete repaint. Switching
 * workspaces used to make every agent pane in the destination redraw.
 *
 * The dedupe lives in `SessionManager.resize` so the PTY, the headless
 * mirror and the fd-5 sideband event all share one definition of "the
 * size actually changed".
 */
import { describe, test, expect, afterEach } from "bun:test";
import { SessionManager } from "../src/bun/session-manager";

describe("SessionManager.resize dedupe", () => {
  let sessions: SessionManager;

  afterEach(() => {
    sessions?.destroy();
  });

  /** Count PTY-level resizes while still performing them, so the
   *  manager's own cols/rows bookkeeping stays real. */
  function spyOnResize(surface: {
    pty: { resize: (c: number, r: number) => void };
  }) {
    const calls: [number, number][] = [];
    const real = surface.pty.resize.bind(surface.pty);
    surface.pty.resize = (cols: number, rows: number) => {
      calls.push([cols, rows]);
      real(cols, rows);
    };
    return calls;
  }

  test("a repeated resize at the same dimensions hits the PTY once", () => {
    sessions = new SessionManager("/bin/sh");
    const id = sessions.createSurface(80, 24);
    const calls = spyOnResize(sessions.getSurface(id)!);

    sessions.resize(id, 120, 40);
    for (let i = 0; i < 20; i++) sessions.resize(id, 120, 40);

    expect(calls).toEqual([[120, 40]]);
  });

  test("resizing to the spawn dimensions is a no-op", () => {
    // The common case on a workspace switch: nothing moved, so the
    // fit produces exactly what the PTY already has.
    sessions = new SessionManager("/bin/sh");
    const id = sessions.createSurface(80, 24);
    const calls = spyOnResize(sessions.getSurface(id)!);

    sessions.resize(id, 80, 24);

    expect(calls).toEqual([]);
  });

  test("a real change still gets through, in both axes", () => {
    sessions = new SessionManager("/bin/sh");
    const id = sessions.createSurface(80, 24);
    const calls = spyOnResize(sessions.getSurface(id)!);

    sessions.resize(id, 100, 24); // cols only
    sessions.resize(id, 100, 30); // rows only
    sessions.resize(id, 90, 20); // both
    sessions.resize(id, 90, 20); // duplicate — dropped

    expect(calls).toEqual([
      [100, 24],
      [100, 30],
      [90, 20],
    ]);
  });

  test("the PTY's reported size tracks the last real resize", () => {
    sessions = new SessionManager("/bin/sh");
    const id = sessions.createSurface(80, 24);

    sessions.resize(id, 132, 43);
    sessions.resize(id, 132, 43);

    const pty = sessions.getSurface(id)!.pty;
    expect(pty.cols).toBe(132);
    expect(pty.rows).toBe(43);
  });

  test("the sideband resize event fires only on real changes", () => {
    sessions = new SessionManager("/bin/sh");
    const id = sessions.createSurface(80, 24);
    const surface = sessions.getSurface(id)!;

    const events: unknown[] = [];
    // eventWriter is created only when fd 5 is wired; if it is missing
    // there is nothing to assert and the PTY-level count above already
    // covers the contract.
    if (!surface.eventWriter) return;
    surface.eventWriter.send = (event: unknown) => {
      events.push(event);
    };

    sessions.resize(id, 100, 30);
    sessions.resize(id, 100, 30);
    sessions.resize(id, 100, 31);

    expect(events).toEqual([
      { id: "__terminal__", event: "resize", cols: 100, rows: 30 },
      { id: "__terminal__", event: "resize", cols: 100, rows: 31 },
    ]);
  });

  test("an unknown surface id is inert", () => {
    sessions = new SessionManager("/bin/sh");
    expect(() => sessions.resize("surface:nope", 80, 24)).not.toThrow();
  });
});
