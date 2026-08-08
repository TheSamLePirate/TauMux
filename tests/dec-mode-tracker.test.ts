/**
 * DEC private mode tracking off the raw PTY stream.
 *
 * This exists so paste framing does not depend on the headless xterm
 * mirror, which is an optional, off-by-default subsystem. The split
 * matters: gating that mirror on the web server (which Phase 2 does)
 * would otherwise have silently stopped ⌘V from bracketing.
 *
 * The chunk-splitting cases are the point — a PTY read ends wherever the
 * kernel says it does, including halfway through an escape sequence.
 */
import { describe, test, expect } from "bun:test";
import {
  DecPrivateModeTracker,
  MODE_BRACKETED_PASTE,
} from "../src/bun/dec-mode-tracker";

function tracker(modes: number[] = [MODE_BRACKETED_PASTE]) {
  return new DecPrivateModeTracker(modes);
}

describe("basic set / reset", () => {
  test("starts unset", () => {
    expect(tracker().isSet(MODE_BRACKETED_PASTE)).toBe(false);
  });

  test("CSI ? 2004 h sets", () => {
    const t = tracker();
    t.write("\x1b[?2004h");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(true);
  });

  test("CSI ? 2004 l resets", () => {
    const t = tracker();
    t.write("\x1b[?2004h");
    t.write("\x1b[?2004l");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(false);
  });

  test("last write wins across many flips", () => {
    const t = tracker();
    for (let i = 0; i < 10; i++) t.write("\x1b[?2004h\x1b[?2004l");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(false);
    t.write("\x1b[?2004h");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(true);
  });

  test("reset() forgets everything", () => {
    const t = tracker();
    t.write("\x1b[?2004h");
    t.reset();
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(false);
  });
});

describe("multi-parameter sequences", () => {
  test("mode inside a list is picked up", () => {
    // What an agent CLI actually emits at startup.
    const t = tracker();
    t.write("\x1b[?1049;2004;1006h");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(true);
  });

  test("reset inside a list is picked up", () => {
    const t = tracker();
    t.write("\x1b[?1049;2004h");
    t.write("\x1b[?25;2004;1006l");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(false);
  });

  test("unwatched modes are ignored, not stored", () => {
    const t = tracker();
    t.write("\x1b[?1049h\x1b[?25h\x1b[?1006h");
    expect(t.isSet(1049)).toBe(false);
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(false);
  });

  test("several watched modes are tracked independently", () => {
    const t = tracker([2004, 2026]);
    t.write("\x1b[?2004h");
    expect(t.isSet(2004)).toBe(true);
    expect(t.isSet(2026)).toBe(false);
    t.write("\x1b[?2026h\x1b[?2004l");
    expect(t.isSet(2004)).toBe(false);
    expect(t.isSet(2026)).toBe(true);
  });
});

describe("sequences split across PTY reads", () => {
  test("split mid-parameter", () => {
    const t = tracker();
    t.write("\x1b[?20");
    t.write("04h");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(true);
  });

  test("split immediately after ESC", () => {
    const t = tracker();
    t.write("\x1b");
    t.write("[?2004h");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(true);
  });

  test("split before the final byte", () => {
    const t = tracker();
    t.write("\x1b[?2004");
    t.write("h");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(true);
  });

  test("one byte at a time", () => {
    const t = tracker();
    for (const ch of "prompt$ \x1b[?2004h") t.write(ch);
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(true);
  });

  test("split around surrounding output", () => {
    const t = tracker();
    t.write("some output\x1b[?20");
    t.write("04h more output\n");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(true);
  });

  test("a split reset is seen too", () => {
    const t = tracker();
    t.write("\x1b[?2004h");
    t.write("\x1b[?2004");
    t.write("l");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(false);
  });
});

describe("noise tolerance", () => {
  test("plain output never sets a mode", () => {
    const t = tracker();
    t.write("total 42\ndrwxr-xr-x  8 me staff 256 Aug  8 12:00 .\n");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(false);
  });

  test("colour and cursor sequences are not mistaken for modes", () => {
    const t = tracker();
    t.write("\x1b[31mred\x1b[0m\x1b[2J\x1b[H\x1b[1;1H");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(false);
  });

  test("a non-private CSI with the same number is ignored", () => {
    // `CSI 2004 h` (no `?`) is a different, ANSI-mode sequence.
    const t = tracker();
    t.write("\x1b[2004h");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(false);
  });

  test("the literal text of a bracketed paste does not set the mode", () => {
    // ESC[200~ … ESC[201~ contains no `CSI ?` form; make sure the
    // scanner does not get confused by the payload it helps produce.
    const t = tracker();
    t.write("\x1b[200~echo hi\x1b[201~");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(false);
  });

  test("empty writes are harmless", () => {
    const t = tracker();
    t.write("");
    t.write("\x1b[?2004h");
    t.write("");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(true);
  });

  test("an empty parameter list is ignored", () => {
    const t = tracker();
    t.write("\x1b[?h");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(false);
  });
});

describe("carry is bounded", () => {
  test("a long run of ESCs does not accumulate state", () => {
    // Regression guard: an unbounded carry would grow with the stream.
    const t = tracker();
    for (let i = 0; i < 1000; i++) t.write("\x1b");
    t.write("[?2004h");
    // The final ESC still forms a valid sequence with the next chunk.
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(true);
  });

  test("a huge chunk with the mode at the very end is still seen", () => {
    const t = tracker();
    t.write("x".repeat(500_000) + "\x1b[?2004h");
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(true);
  });

  test("a mode set before a huge chunk survives it", () => {
    const t = tracker();
    t.write("\x1b[?2004h");
    t.write("x".repeat(500_000));
    expect(t.isSet(MODE_BRACKETED_PASTE)).toBe(true);
  });
});
