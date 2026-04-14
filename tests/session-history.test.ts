import { describe, test, expect, afterEach } from "bun:test";
import { SessionManager } from "../src/bun/session-manager";

describe("SessionManager history replay (xterm headless)", () => {
  let sessions: SessionManager | null = null;

  afterEach(() => {
    sessions?.destroy();
    sessions = null;
  });

  // The SessionManager wires pty.onStdout inside createSurface, so any
  // data we inject must go through the pty-exposed onStdout callback we
  // capture from the surface's pty instance. In a real run this is
  // driven by the child process; for a deterministic test we poke the
  // headless terminal directly by forcing data through onStdout.

  function feed(surfaceId: string, data: string) {
    const surface = sessions!.getSurface(surfaceId);
    if (!surface) throw new Error(`no surface ${surfaceId}`);
    // Dispatch via the pty's own onStdout plumbing so the headless write
    // happens inside SessionManager.
    surface.pty.onStdout?.(data);
  }

  test("history reconstructs terminal state, not raw bytes", async () => {
    sessions = new SessionManager();
    const id = sessions.createSurface(80, 24);
    // An ANSI-coloured line, a cursor move, and another write. A raw
    // replay would echo these bytes verbatim; serialize() normalises
    // them into a valid terminal state.
    feed(id, "\x1b[31mred text\x1b[0m\r\n");
    feed(id, "\x1b[1;1HAt origin\r\n");
    feed(id, "plain after\r\n");
    // Give xterm-headless an event-loop tick to flush its write queue.
    await Bun.sleep(10);

    const history = sessions.getOutputHistory(id);
    expect(typeof history).toBe("string");
    expect(history.length).toBeGreaterThan(0);
    // serialize() emits SGR sequences as part of reconstructing state,
    // so we should still see some ESC bytes in the output.
    expect(history.includes("\x1b[")).toBe(true);
  });

  test("history is empty for an unknown surface", () => {
    sessions = new SessionManager();
    expect(sessions.getOutputHistory("surface:bogus")).toBe("");
  });

  test("resize flows to the headless terminal without throwing", async () => {
    sessions = new SessionManager();
    const id = sessions.createSurface(80, 24);
    feed(id, "hello\r\n");
    // Should not throw even though we're not hooked to a real PTY.
    expect(() => sessions!.resize(id, 132, 40)).not.toThrow();
    await Bun.sleep(5);
    const history = sessions.getOutputHistory(id);
    expect(history.length).toBeGreaterThan(0);
  });

  test("closeSurface disposes headless without crashing", async () => {
    sessions = new SessionManager();
    const id = sessions.createSurface(80, 24);
    feed(id, "bye\r\n");
    await Bun.sleep(5);
    sessions.closeSurface(id);
    expect(sessions.getOutputHistory(id)).toBe("");
  });

  test("byte-buffer fallback still works when getOutputHistory is called after many writes", async () => {
    sessions = new SessionManager();
    const id = sessions.createSurface(80, 24);
    // Fill with enough writes to exercise the scrollback path.
    for (let i = 0; i < 200; i++) feed(id, `line ${i}\r\n`);
    await Bun.sleep(20);
    const history = sessions.getOutputHistory(id);
    // Should contain at least one of the recent lines.
    expect(history.includes("line 199")).toBe(true);
  });
});
