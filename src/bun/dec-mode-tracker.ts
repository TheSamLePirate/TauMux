/**
 * Track a handful of DEC private modes straight off the PTY byte stream.
 *
 * ## Why not just ask the headless terminal
 *
 * `SessionManager` keeps a `@xterm/headless` mirror per surface, and it
 * parses every mode correctly, so reading `modes.bracketedPasteMode` off
 * it was the obvious first implementation. Two problems:
 *
 *   1. **Cost.** A full terminal emulator parses, allocates cells,
 *      reflows and maintains scrollback for every byte — in the main
 *      process, alongside the metadata poller and the socket server.
 *      Paying that to answer one boolean is absurd.
 *   2. **Layering.** The mirror exists only so web-mirror clients
 *      rejoining mid-stream get a state-correct replay. Making paste
 *      framing depend on it means an optional, off-by-default subsystem
 *      silently becomes load-bearing — and the moment someone gates the
 *      mirror on the web server (which is the right thing to do), ⌘V
 *      quietly stops bracketing.
 *
 * So: a scanner that knows about nothing except `CSI ? … h/l`.
 *
 * ## Split sequences
 *
 * A PTY read can end anywhere, including halfway through an escape
 * sequence. The scanner keeps a short tail across writes so
 * `"\x1b[?20"` + `"04h"` is still seen as one set. The tail is bounded;
 * a pathologically long parameter list overflows it and the mode is
 * missed, which degrades to "not set" — the safe direction for every
 * mode here.
 */

/** `CSI ? <params> h|l` — the set/reset form for private modes. */
const MODE_RE = /\x1b\[\?([\d;]*)([hl])/g;

/** Longest partial sequence carried between writes. `CSI ? 1049;2004;25;1006 h`
 *  is ~25 bytes; 64 leaves generous headroom without unbounded retention. */
const MAX_CARRY = 64;

export class DecPrivateModeTracker {
  private readonly modes = new Set<number>();
  private readonly watched: ReadonlySet<number>;
  private carry = "";

  /** `watched` is the set of mode numbers worth remembering. Anything
   *  else is parsed and discarded, so the state stays O(1). */
  constructor(watched: Iterable<number>) {
    this.watched = new Set(watched);
  }

  /** Feed one PTY chunk. Cheap when the chunk contains no mode changes,
   *  which is nearly always. */
  write(chunk: string): void {
    if (!chunk) return;

    // Fast path: no CSI-private introducer anywhere in the carry or the
    // chunk means nothing here can be a mode change. Streaming output is
    // overwhelmingly this case, and `indexOf` on a short needle is far
    // cheaper than running the regex.
    if (this.carry.length === 0 && chunk.indexOf("\x1b[?") === -1) {
      this.carry = tailCarry(chunk, 0);
      return;
    }

    const buf = this.carry + chunk;
    let lastEnd = 0;
    MODE_RE.lastIndex = 0;
    for (let m = MODE_RE.exec(buf); m !== null; m = MODE_RE.exec(buf)) {
      this.apply(m[1] ?? "", m[2] === "h");
      lastEnd = m.index + m[0].length;
    }
    this.carry = tailCarry(buf, lastEnd);
  }

  private apply(params: string, set: boolean): void {
    for (const part of params.split(";")) {
      if (!part) continue;
      const mode = Number(part);
      if (!this.watched.has(mode)) continue;
      if (set) this.modes.add(mode);
      else this.modes.delete(mode);
    }
  }

  isSet(mode: number): boolean {
    return this.modes.has(mode);
  }

  /** Forget everything — used when a surface's program exits and the
   *  next one starts from the terminal's default modes. */
  reset(): void {
    this.modes.clear();
    this.carry = "";
  }
}

/**
 * The trailing fragment worth keeping: everything from the last `ESC`
 * that appears after the final complete match, capped at `MAX_CARRY`.
 *
 * Anything before `lastEnd` has already been consumed, and an `ESC` that
 * begins some other kind of sequence is carried harmlessly — it simply
 * never matches.
 */
function tailCarry(buf: string, lastEnd: number): string {
  const start = Math.max(lastEnd, buf.length - MAX_CARRY);
  const tail = buf.slice(start);
  const esc = tail.lastIndexOf("\x1b");
  return esc === -1 ? "" : tail.slice(esc);
}

/** Bracketed paste. The one mode the paste path needs. */
export const MODE_BRACKETED_PASTE = 2004;
