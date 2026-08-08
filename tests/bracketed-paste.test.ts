/**
 * Bracketed paste (DEC private mode 2004).
 *
 * Two layers, both worth pinning:
 *   1. the pure framing/size helpers in src/shared/bracketed-paste.ts
 *   2. the live wiring — a real PTY turning DEC 2004 on, SessionManager
 *      noticing, and `writePaste` framing accordingly.
 *
 * (2) is what actually regressed before: the helpers can be perfect and
 * still never be reached, which is exactly how the app shipped for
 * months with ⌘V bypassing xterm's own bracketing path.
 */
import { describe, test, expect, afterEach } from "bun:test";
import {
  PASTE_BEGIN,
  PASTE_END,
  PASTE_CONFIRM_LINES,
  PASTE_MAX_CHARS,
  classifyPasteSize,
  countPasteLines,
  describePasteSize,
  framePaste,
  normalizePasteNewlines,
  stripPasteMarkers,
} from "../src/shared/bracketed-paste";
import { SessionManager } from "../src/bun/session-manager";

async function waitFor(
  fn: () => boolean,
  timeout = 5000,
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

describe("normalizePasteNewlines", () => {
  test("CRLF collapses to a single CR", () => {
    // The bug this pins: CRLF text used to submit twice per line.
    expect(normalizePasteNewlines("a\r\nb")).toBe("a\rb");
  });

  test("bare LF becomes CR", () => {
    expect(normalizePasteNewlines("a\nb")).toBe("a\rb");
  });

  test("an existing CR is left alone", () => {
    expect(normalizePasteNewlines("a\rb")).toBe("a\rb");
  });

  test("mixed endings all land on CR", () => {
    expect(normalizePasteNewlines("a\r\nb\nc\rd")).toBe("a\rb\rc\rd");
  });

  test("text with no line breaks is untouched", () => {
    expect(normalizePasteNewlines("plain")).toBe("plain");
  });
});

describe("stripPasteMarkers", () => {
  test("removes an embedded end marker", () => {
    expect(stripPasteMarkers(`a${PASTE_END}b`)).toBe("ab");
  });

  test("removes an embedded begin marker", () => {
    expect(stripPasteMarkers(`a${PASTE_BEGIN}b`)).toBe("ab");
  });

  test("removes every occurrence, not just the first", () => {
    expect(stripPasteMarkers(`${PASTE_END}a${PASTE_END}b${PASTE_END}`)).toBe(
      "ab",
    );
  });

  test("leaves other escape sequences alone", () => {
    expect(stripPasteMarkers("\x1b[31mred\x1b[0m")).toBe("\x1b[31mred\x1b[0m");
  });
});

describe("framePaste", () => {
  test("wraps in DEC 2004 markers when the app asked for it", () => {
    expect(framePaste("hello", true)).toBe(`${PASTE_BEGIN}hello${PASTE_END}`);
  });

  test("sends bare text when the app has not", () => {
    expect(framePaste("hello", false)).toBe("hello");
  });

  test("normalises newlines in both modes", () => {
    expect(framePaste("a\r\nb", false)).toBe("a\rb");
    expect(framePaste("a\r\nb", true)).toBe(`${PASTE_BEGIN}a\rb${PASTE_END}`);
  });

  test("a payload cannot terminate its own bracket", () => {
    // Security case: without stripping, everything after the injected
    // end marker would be interpreted as *typing* — arbitrary command
    // execution from a crafted clipboard.
    const hostile = `safe${PASTE_END}rm -rf /\r`;
    const framed = framePaste(hostile, true);
    expect(framed.indexOf(PASTE_END)).toBe(framed.length - PASTE_END.length);
    expect(framed).toBe(`${PASTE_BEGIN}saferm -rf /\r${PASTE_END}`);
  });

  test("empty text still frames when bracketed", () => {
    expect(framePaste("", true)).toBe(`${PASTE_BEGIN}${PASTE_END}`);
  });
});

describe("countPasteLines", () => {
  test("empty text is zero lines", () => {
    expect(countPasteLines("")).toBe(0);
  });

  test("one line with no terminator", () => {
    expect(countPasteLines("one")).toBe(1);
  });

  test("CRLF is not double-counted", () => {
    expect(countPasteLines("a\r\nb\r\nc")).toBe(3);
  });

  test("a trailing newline opens a new line", () => {
    expect(countPasteLines("a\n")).toBe(2);
  });
});

describe("classifyPasteSize", () => {
  test("an ordinary paste needs neither confirm nor refusal", () => {
    const v = classifyPasteSize("git status\n");
    expect(v.refuse).toBe(false);
    expect(v.confirm).toBe(false);
  });

  test("many short lines trip the line threshold", () => {
    const v = classifyPasteSize("x\n".repeat(PASTE_CONFIRM_LINES + 1));
    expect(v.confirm).toBe(true);
    expect(v.refuse).toBe(false);
  });

  test("a large single line trips the size threshold", () => {
    const v = classifyPasteSize("x".repeat(60_000));
    expect(v.confirm).toBe(true);
    expect(v.refuse).toBe(false);
  });

  test("over the hard cap is refused, never merely confirmed", () => {
    const v = classifyPasteSize("x".repeat(PASTE_MAX_CHARS + 1));
    expect(v.refuse).toBe(true);
    // Refusal and confirmation are mutually exclusive: a caller that
    // only checked `confirm` must not be able to paste a refused blob.
    expect(v.confirm).toBe(false);
  });

  test("exactly at the cap is allowed", () => {
    expect(classifyPasteSize("x".repeat(PASTE_MAX_CHARS)).refuse).toBe(false);
  });
});

describe("describePasteSize", () => {
  test("reports lines and a human size", () => {
    const text = "hello world\n".repeat(1000);
    expect(describePasteSize(classifyPasteSize(text))).toMatch(
      /1,001 lines · \d+ KB/,
    );
  });

  test("singular line reads naturally", () => {
    expect(describePasteSize(classifyPasteSize("hi"))).toStartWith("1 line ·");
  });
});

describe("SessionManager paste framing (live PTY)", () => {
  let sessions: SessionManager;

  afterEach(() => {
    sessions?.destroy();
  });

  /** Record what actually reaches the PTY, still letting it through, so
   *  assertions run against the real write path rather than a stub. */
  function spyOnWrites(surface: { pty: { write: (d: string) => void } }) {
    const writes: string[] = [];
    const realWrite = surface.pty.write.bind(surface.pty);
    surface.pty.write = (data: string) => {
      writes.push(data);
      realWrite(data);
    };
    return writes;
  }

  test("tracks the app's DEC 2004 state and frames only when it is on", async () => {
    sessions = new SessionManager("/bin/sh");
    let out = "";
    sessions.onStdout = (_id, data) => {
      out += data;
    };
    const id = sessions.createSurface(80, 24);
    const surface = sessions.getSurface(id)!;
    const writes = spyOnWrites(surface);

    // Wait for a prompt. Writing before the shell is up merges every
    // buffered write into one command line, which is how the first
    // draft of this test managed to run `twoprintf`.
    await waitFor(() => out.includes("$ ") || out.includes("% "));

    // A bare shell prompt has bracketed paste off.
    expect(sessions.isBracketedPasteMode(id)).toBe(false);
    sessions.writePaste(id, "echo one\n");
    expect(writes.at(-1)).toBe("echo one\r");

    // Now have the child turn DEC 2004 on, the way an agent CLI does at
    // startup. The headless mirror parses it out of the PTY stream —
    // no second parser, no heuristic.
    sessions.writeStdin(id, "printf '\\033[?2004h'\n");
    await waitFor(() => sessions.isBracketedPasteMode(id));

    sessions.writePaste(id, "one\ntwo");
    expect(writes.at(-1)).toBe(`${PASTE_BEGIN}one\rtwo${PASTE_END}`);

    // …and off again when the app restores its modes on exit.
    sessions.writeStdin(id, "\rprintf '\\033[?2004l'\n");
    await waitFor(() => !sessions.isBracketedPasteMode(id));
    sessions.writePaste(id, "one\ntwo");
    expect(writes.at(-1)).toBe("one\rtwo");
  }, 20000);

  test("writeStdin is never framed — typing is not pasting", async () => {
    sessions = new SessionManager("/bin/sh");
    let out = "";
    sessions.onStdout = (_id, data) => {
      out += data;
    };
    const id = sessions.createSurface(80, 24);
    const surface = sessions.getSurface(id)!;

    await waitFor(() => out.includes("$ ") || out.includes("% "));
    sessions.writeStdin(id, "printf '\\033[?2004h'\n");
    await waitFor(() => sessions.isBracketedPasteMode(id));

    const writes = spyOnWrites(surface);

    // `ht send` and keystrokes must stay unframed even with DEC 2004
    // on, or `ht send "npm run dev\r"` would land in the line editor
    // instead of running.
    sessions.writeStdin(id, "echo hi\r");
    expect(writes.at(-1)).toBe("echo hi\r");
  }, 20000);

  test("unknown surface ids are inert", () => {
    sessions = new SessionManager("/bin/sh");
    expect(sessions.isBracketedPasteMode("surface:nope")).toBe(false);
    expect(() => sessions.writePaste("surface:nope", "x")).not.toThrow();
  });
});
