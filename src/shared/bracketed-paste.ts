/**
 * Bracketed paste framing (DEC private mode 2004).
 *
 * ## Why this module exists
 *
 * When an application turns on `DECSET 2004` it is telling the terminal
 * "wrap anything the user pastes in `ESC[200~` … `ESC[201~` so I can tell
 * it apart from typing." Line editors use that to insert a multi-line
 * block into the buffer *without* executing each line; agent CLIs use it
 * to collapse a paste into a single attachment.
 *
 * τ-mux used to write clipboard text straight into the PTY with no
 * framing at all, because ⌘V is intercepted in the webview
 * (`index.ts` → `clipboardPaste`) and handled natively on the bun side —
 * which bypasses xterm's own `paste()`, the only code path that would
 * have bracketed it. The visible symptom: pasting a 20-line block into
 * Claude Code submitted 20 separate prompts. Same for `zsh`, `psql`,
 * `python`, and every other line editor.
 *
 * The framing decision belongs to the *application*, never to us: we
 * mirror `decPrivateModes.bracketedPasteMode` as the PTY stream has
 * actually set it (read off the headless mirror in `SessionManager`).
 * When the app has not asked for brackets, we send the bare text — the
 * old behaviour, which is correct for a plain shell prompt.
 *
 * ## Newline normalisation
 *
 * `\r\n` and `\n` both become `\r`, bracketed or not. This matches
 * xterm.js (`prepareTextForTerminal`), iTerm2 and Ghostty: a terminal's
 * input convention is CR for Return, because that is the byte a keyboard
 * produces. Skipping this is how a paste of Windows-CRLF text ends up
 * submitting twice per line.
 *
 * ## Marker stripping is a security control, not tidiness
 *
 * A payload containing a literal `ESC[201~` would close the bracket early
 * and let the remainder of the paste be interpreted as *typing* — in a
 * shell, that means arbitrary command execution from a crafted clipboard.
 * xterm.js does not strip these; we do. Both markers go, in both
 * directions, always — they carry no legitimate meaning inside pasted
 * text.
 *
 * ## Size limits
 *
 * Counted in UTF-16 code units (JS string length), not bytes. The
 * distinction only matters for non-ASCII payloads, where a char is worth
 * up to 4 bytes — so the effective byte ceiling is higher than the
 * nominal number. That is deliberate: this is a guard against pasting a
 * whole file by accident, and an approximate ceiling costs nothing while
 * an exact one would mean encoding the payload twice.
 */

export const PASTE_BEGIN = "\x1b[200~";
export const PASTE_END = "\x1b[201~";

/**
 * Hard ceiling. A paste larger than this is refused outright rather than
 * truncated: when the app is *not* in bracketed mode, a truncated paste
 * is a truncated command line, and half of `rm -rf ~/project/build` is a
 * materially different command from the whole of it. Refusing is the only
 * safe failure mode.
 */
export const PASTE_MAX_CHARS = 1_000_000;

/** Ask before pasting more than this. Either threshold trips it. */
export const PASTE_CONFIRM_CHARS = 50_000;
export const PASTE_CONFIRM_LINES = 500;

/** Both paste markers, for stripping. Global so `replace` takes every hit. */
const MARKER_RE = /\x1b\[20[01]~/g;

/** `\r\n` | `\n` → `\r`. A lone `\r` is already correct and is left alone. */
export function normalizePasteNewlines(text: string): string {
  return text.replace(/\r\n|\n/g, "\r");
}

/** Remove any embedded `ESC[200~` / `ESC[201~` so a payload cannot break
 *  out of its own bracket. See the security note in the module header. */
export function stripPasteMarkers(text: string): string {
  return text.replace(MARKER_RE, "");
}

/**
 * Turn clipboard text into the exact bytes to write to the PTY.
 *
 * `bracketed` must be the application's *live* DEC 2004 state, not a
 * guess — pass `false` and the text goes through as if typed, which is
 * what a bare shell prompt wants.
 */
export function framePaste(text: string, bracketed: boolean): string {
  const body = normalizePasteNewlines(stripPasteMarkers(text));
  return bracketed ? PASTE_BEGIN + body + PASTE_END : body;
}

/** Line count as the *user* would count it, i.e. after normalisation, so
 *  CRLF text is not double-counted. An empty string is zero lines. */
export function countPasteLines(text: string): number {
  if (!text) return 0;
  let lines = 1;
  const normalized = normalizePasteNewlines(text);
  for (let i = 0; i < normalized.length; i++) {
    if (normalized.charCodeAt(i) === 13) lines++;
  }
  return lines;
}

export interface PasteSizeVerdict {
  /** Over `PASTE_MAX_CHARS` — refuse, do not truncate. */
  readonly refuse: boolean;
  /** Over a confirm threshold — ask first. Never set when `refuse` is. */
  readonly confirm: boolean;
  readonly chars: number;
  readonly lines: number;
}

export function classifyPasteSize(text: string): PasteSizeVerdict {
  const chars = text.length;
  const lines = countPasteLines(text);
  const refuse = chars > PASTE_MAX_CHARS;
  return {
    refuse,
    confirm:
      !refuse && (chars > PASTE_CONFIRM_CHARS || lines > PASTE_CONFIRM_LINES),
    chars,
    lines,
  };
}

/** Human-readable size for dialogs and toasts — "1,204 lines · 87 KB". */
export function describePasteSize(verdict: PasteSizeVerdict): string {
  const kb = verdict.chars / 1024;
  const size =
    kb >= 1024
      ? `${(kb / 1024).toFixed(1)} MB`
      : kb >= 1
        ? `${Math.round(kb)} KB`
        : `${verdict.chars} chars`;
  const lines =
    verdict.lines === 1 ? "1 line" : `${verdict.lines.toLocaleString()} lines`;
  return `${lines} · ${size}`;
}
