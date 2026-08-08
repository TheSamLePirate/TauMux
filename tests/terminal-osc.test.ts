/**
 * OSC 9 routing and BEL throttling.
 *
 * The interesting part is the dialect split: OSC 9 carries ConEmu
 * progress (`9;4;…`) *and* iTerm2 notifications (`9;<message>`) on the
 * same number. τ-mux used to register a handler that decoded progress
 * and returned `false` for everything else — with no other OSC 9 handler
 * registered, that silently dropped every notification an agent CLI sent
 * on its "iterm2" channel.
 */
import { describe, test, expect, afterEach } from "bun:test";
import {
  BELL_THROTTLE_MS,
  handleOsc9,
  installTerminalOscHandlers,
  setOscClockForTest,
  type TerminalOscHooks,
} from "../src/views/terminal/terminal-osc";
import type { Osc94Update } from "../src/views/terminal/osc-progress";

interface Recorded {
  titles: string[];
  progress: Osc94Update[];
  notes: string[];
  bells: number;
}

function hooks(
  over: Partial<TerminalOscHooks> = {},
): TerminalOscHooks & { rec: Recorded } {
  const rec: Recorded = { titles: [], progress: [], notes: [], bells: 0 };
  return {
    rec,
    onTitle: (t) => rec.titles.push(t),
    onProgress: (p) => rec.progress.push(p),
    onNotify: (m) => rec.notes.push(m),
    onBell: () => rec.bells++,
    isProgressEnabled: () => true,
    isNotifyEnabled: () => true,
    ...over,
  };
}

describe("handleOsc9 — dialect routing", () => {
  test("ConEmu progress is decoded, not treated as a message", () => {
    const h = hooks();
    expect(handleOsc9("4;1;42", h)).toBe(true);
    expect(h.rec.progress).toEqual([{ state: "normal", value: 42 }]);
    expect(h.rec.notes).toEqual([]);
  });

  test("iTerm2 notification text reaches onNotify", () => {
    const h = hooks();
    expect(handleOsc9("Build finished", h)).toBe(true);
    expect(h.rec.notes).toEqual(["Build finished"]);
    expect(h.rec.progress).toEqual([]);
  });

  test("ConEmu 9;9 (set cwd) is swallowed, not announced", () => {
    // τ-mux gets cwd from the metadata poller. The point of handling it
    // is to stop a path being shown to the user as a notification.
    const h = hooks();
    expect(handleOsc9("9;/Users/me/project", h)).toBe(true);
    expect(h.rec.notes).toEqual([]);
    expect(h.rec.progress).toEqual([]);
  });

  test("disabling progress does not turn it into a notification", () => {
    // Opting out of progress must not opt you in to popups.
    const h = hooks({ isProgressEnabled: () => false });
    expect(handleOsc9("4;1;42", h)).toBe(false);
    expect(h.rec.notes).toEqual([]);
    expect(h.rec.progress).toEqual([]);
  });

  test("disabling notifications still consumes the sequence", () => {
    // Returning false would leave the payload to be echoed as text.
    const h = hooks({ isNotifyEnabled: () => false });
    expect(handleOsc9("Build finished", h)).toBe(true);
    expect(h.rec.notes).toEqual([]);
  });

  test("an empty payload is consumed and ignored", () => {
    const h = hooks();
    expect(handleOsc9("   ", h)).toBe(true);
    expect(h.rec.notes).toEqual([]);
  });

  test("a very long message is capped", () => {
    const h = hooks();
    handleOsc9("x".repeat(5000), h);
    expect(h.rec.notes[0]!.length).toBe(500);
  });

  test("message text is trimmed", () => {
    const h = hooks();
    handleOsc9("  spaced  ", h);
    expect(h.rec.notes).toEqual(["spaced"]);
  });
});

describe("installTerminalOscHandlers", () => {
  afterEach(() => setOscClockForTest());

  /** Minimal xterm stand-in exposing only what the module feature-detects. */
  function fakeTerm(opts: { bell?: boolean; osc?: boolean; title?: boolean }) {
    let bellCb: (() => void) | null = null;
    let titleCb: ((t: string) => void) | null = null;
    let oscCb: ((body: string) => boolean) | null = null;
    return {
      term: {
        ...(opts.title
          ? { onTitleChange: (cb: (t: string) => void) => (titleCb = cb) }
          : {}),
        ...(opts.bell ? { onBell: (cb: () => void) => (bellCb = cb) } : {}),
        ...(opts.osc
          ? {
              parser: {
                registerOscHandler: (
                  _id: number,
                  cb: (body: string) => boolean,
                ) => (oscCb = cb),
              },
            }
          : {}),
      },
      ringBell: () => bellCb?.(),
      setTitle: (t: string) => titleCb?.(t),
      sendOsc9: (body: string) => oscCb?.(body),
    };
  }

  test("titles are trimmed and capped", () => {
    const h = hooks();
    const f = fakeTerm({ title: true });
    installTerminalOscHandlers(f.term, h);
    f.setTitle("  vim src/index.ts  ");
    f.setTitle("y".repeat(200));
    f.setTitle("   ");
    expect(h.rec.titles[0]).toBe("vim src/index.ts");
    expect(h.rec.titles[1]!.length).toBe(60);
    // An all-whitespace title is dropped, not published as "".
    expect(h.rec.titles.length).toBe(2);
  });

  test("BEL is throttled per terminal", () => {
    let now = 1_000_000;
    setOscClockForTest(() => now);
    const h = hooks();
    const f = fakeTerm({ bell: true });
    installTerminalOscHandlers(f.term, h);

    f.ringBell();
    expect(h.rec.bells).toBe(1);

    // A program ringing in a tight loop must not mint a notification
    // per byte — each one would be persisted and Telegram-forwarded.
    for (let i = 0; i < 500; i++) f.ringBell();
    expect(h.rec.bells).toBe(1);

    now += BELL_THROTTLE_MS;
    f.ringBell();
    expect(h.rec.bells).toBe(2);
  });

  test("each terminal throttles independently", () => {
    const now = 1_000_000;
    setOscClockForTest(() => now);
    const h = hooks();
    const a = fakeTerm({ bell: true });
    const b = fakeTerm({ bell: true });
    installTerminalOscHandlers(a.term, h);
    installTerminalOscHandlers(b.term, h);

    a.ringBell();
    b.ringBell();
    expect(h.rec.bells).toBe(2);
  });

  test("OSC 9 is registered and routed", () => {
    const h = hooks();
    const f = fakeTerm({ osc: true });
    installTerminalOscHandlers(f.term, h);
    expect(f.sendOsc9("Done")).toBe(true);
    expect(h.rec.notes).toEqual(["Done"]);
  });

  test("a terminal implementing none of the hooks is safe", () => {
    // The happy-dom SurfaceManager mock is exactly this.
    const h = hooks();
    expect(() => installTerminalOscHandlers({}, h)).not.toThrow();
    expect(h.rec).toEqual({ titles: [], progress: [], notes: [], bells: 0 });
  });
});
