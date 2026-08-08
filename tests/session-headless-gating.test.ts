/**
 * The headless mirror is built with the web mirror, not with the surface.
 *
 * It exists so a web client joining mid-stream gets a terminal-state-
 * correct replay. When nobody can ask for that replay, running a full
 * terminal emulator per surface — parse, cells, reflow, 2000 lines of
 * scrollback — in the main process is pure overhead, and agent CLIs are
 * chatty producers.
 *
 * The load-bearing part these tests protect: paste framing must keep
 * working with the mirror off. It reads `DecPrivateModeTracker`, not the
 * mirror, and this is where that stays true.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { SessionManager } from "../src/bun/session-manager";
import { PASTE_BEGIN, PASTE_END } from "../src/shared/bracketed-paste";

async function waitFor(
  fn: () => boolean,
  timeout = 8000,
  interval = 25,
): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor timed out after ${timeout}ms`);
    }
    await Bun.sleep(interval);
  }
}

describe("headless mirror gating", () => {
  let sessions: SessionManager;

  afterEach(() => {
    sessions?.destroy();
  });

  test("surfaces start without a mirror", () => {
    sessions = new SessionManager("/bin/sh");
    const id = sessions.createSurface(80, 24);
    expect(sessions.getSurface(id)!.headless).toBeNull();
    expect(sessions.getSurface(id)!.serializer).toBeNull();
  });

  test("enabling builds one for every existing surface", () => {
    sessions = new SessionManager("/bin/sh");
    const a = sessions.createSurface(80, 24);
    const b = sessions.createSurface(80, 24);
    sessions.setHeadlessMirrorEnabled(true);
    expect(sessions.getSurface(a)!.headless).not.toBeNull();
    expect(sessions.getSurface(b)!.headless).not.toBeNull();
  });

  test("surfaces created while enabled get one at spawn", () => {
    sessions = new SessionManager("/bin/sh");
    sessions.setHeadlessMirrorEnabled(true);
    const id = sessions.createSurface(80, 24);
    expect(sessions.getSurface(id)!.headless).not.toBeNull();
  });

  test("disabling tears them down", () => {
    sessions = new SessionManager("/bin/sh");
    sessions.setHeadlessMirrorEnabled(true);
    const id = sessions.createSurface(80, 24);
    sessions.setHeadlessMirrorEnabled(false);
    expect(sessions.getSurface(id)!.headless).toBeNull();
    expect(sessions.getSurface(id)!.serializer).toBeNull();
  });

  test("re-enabling is idempotent, not a rebuild", () => {
    sessions = new SessionManager("/bin/sh");
    const id = sessions.createSurface(80, 24);
    sessions.setHeadlessMirrorEnabled(true);
    const first = sessions.getSurface(id)!.headless;
    sessions.setHeadlessMirrorEnabled(true);
    expect(sessions.getSurface(id)!.headless).toBe(first);
  });

  test("enabling backfills from the raw history buffer", async () => {
    // A client connecting to a long-running pane must not get a blank
    // screen. The raw byte history is always kept, so it can seed the
    // freshly-built mirror.
    sessions = new SessionManager("/bin/sh");
    let out = "";
    sessions.onStdout = (_id, d) => {
      out += d;
    };
    const id = sessions.createSurface(80, 24);
    await waitFor(() => out.includes("$ ") || out.includes("% "));
    sessions.writeStdin(id, "echo BACKFILL_MARKER\n");
    await waitFor(() => out.includes("BACKFILL_MARKER"));

    sessions.setHeadlessMirrorEnabled(true);
    // xterm parses writes asynchronously, so the backfill lands a tick
    // or two later. Nothing depends on it being synchronous — a client
    // asks for history over a socket, which is already several ticks
    // away — but the wait has to be explicit here.
    await waitFor(() =>
      sessions.getOutputHistory(id).includes("BACKFILL_MARKER"),
    );
    expect(sessions.getOutputHistory(id)).toContain("BACKFILL_MARKER");
  }, 20000);

  test("history still replays with the mirror off", async () => {
    // Falls back to the raw byte buffer — less fidelity, never nothing.
    sessions = new SessionManager("/bin/sh");
    let out = "";
    sessions.onStdout = (_id, d) => {
      out += d;
    };
    const id = sessions.createSurface(80, 24);
    await waitFor(() => out.includes("$ ") || out.includes("% "));
    sessions.writeStdin(id, "echo RAW_MARKER\n");
    await waitFor(() => out.includes("RAW_MARKER"));

    expect(sessions.getSurface(id)!.headless).toBeNull();
    expect(sessions.getOutputHistory(id)).toContain("RAW_MARKER");
  }, 20000);

  test("paste framing works with the mirror off", async () => {
    // The regression this whole split exists to prevent: gating the
    // mirror must not silently stop ⌘V from bracketing.
    sessions = new SessionManager("/bin/sh");
    let out = "";
    sessions.onStdout = (_id, d) => {
      out += d;
    };
    const id = sessions.createSurface(80, 24);
    const surface = sessions.getSurface(id)!;
    expect(surface.headless).toBeNull();

    await waitFor(() => out.includes("$ ") || out.includes("% "));
    sessions.writeStdin(id, "printf '\\033[?2004h'\n");
    await waitFor(() => sessions.isBracketedPasteMode(id));

    const writes: string[] = [];
    const realWrite = surface.pty.write.bind(surface.pty);
    surface.pty.write = (data: string) => {
      writes.push(data);
      realWrite(data);
    };
    sessions.writePaste(id, "one\ntwo");
    expect(writes.at(-1)).toBe(`${PASTE_BEGIN}one\rtwo${PASTE_END}`);
  }, 20000);

  test("output written while disabled reaches a later-enabled mirror", async () => {
    // The stdout closure captured a null mirror at spawn time; it has to
    // re-read the surface so a mid-life enable actually starts feeding.
    sessions = new SessionManager("/bin/sh");
    let out = "";
    sessions.onStdout = (_id, d) => {
      out += d;
    };
    const id = sessions.createSurface(80, 24);
    await waitFor(() => out.includes("$ ") || out.includes("% "));

    sessions.setHeadlessMirrorEnabled(true);
    sessions.writeStdin(id, "echo AFTER_ENABLE\n");
    await waitFor(() => out.includes("AFTER_ENABLE"));
    await waitFor(() => sessions.getOutputHistory(id).includes("AFTER_ENABLE"));
    expect(sessions.getOutputHistory(id)).toContain("AFTER_ENABLE");
  }, 20000);
});
