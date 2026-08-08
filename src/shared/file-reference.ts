/**
 * `path:line:col` references in terminal output.
 *
 * Agent CLIs, compilers, test runners, linters and stack traces all speak
 * this dialect constantly — `src/bun/index.ts:2058`,
 * `tests/foo.test.ts:12:5`. In τ-mux they are the one kind of link that
 * points at something the app can already *open*: it ships a CodeMirror
 * editor pane. Everywhere else they are dead text you retype.
 *
 * Pure and DOM-free so the matching rules can be tested exhaustively —
 * which matters, because the failure mode of a greedy matcher is
 * underlining half a sentence and stealing the click.
 */

export interface FileReference {
  /** Path exactly as it appeared — resolution against a cwd is the
   *  caller's job, since only it knows the surface's directory. */
  path: string;
  line: number | null;
  column: number | null;
  /** Offsets within the scanned string, for turning into a link range. */
  start: number;
  end: number;
}

/**
 * A path followed by an optional `:line` and `:col`.
 *
 * Deliberately conservative — it requires evidence that the token is a
 * path rather than a word:
 *
 *   - a `/` somewhere (`src/index.ts`, `/abs/path`, `./rel`), **or**
 *   - a file extension of 1–8 word characters (`index.ts`, `Makefile.am`)
 *
 * so ordinary prose (`see line 42`, `error:12`) is not underlined. A
 * bare `README` is not matched: without a separator or an extension
 * there is nothing to distinguish it from a word, and a false positive
 * that swallows a click is worse than a missed link.
 */
// The `(?![A-Za-z0-9_])` after the extension is load-bearing: without
// it, `word.extensionthatistoolong` matches its first 8 characters and
// underlines `word.extensio` — a bounded quantifier truncates rather
// than rejects unless the end is anchored.
const FILE_REF_RE =
  /(?:^|[\s"'`(<[\]|])((?:~|\.{1,2})?[/\w.@+-]*(?:\/[\w.@+-]+)+|[\w.@+-]+\.[A-Za-z0-9_]{1,8}(?![A-Za-z0-9_]))(?::(\d+))?(?::(\d+))?/g;

/** Trailing characters that are punctuation around a reference rather
 *  than part of it: `see foo.ts:12,` / `(bar.ts:3)` / `baz.ts.` */
const TRAILING_JUNK = /[.,;:!?)\]}>'"`]+$/;

/**
 * Every file reference in `text`, left to right.
 *
 * `text` is normally one terminal row. Callers strip escape sequences
 * first — xterm hands us rendered cell text, so there is nothing to
 * strip in practice.
 */
export function findFileReferences(text: string): FileReference[] {
  const out: FileReference[] = [];
  FILE_REF_RE.lastIndex = 0;
  for (let m = FILE_REF_RE.exec(text); m !== null; m = FILE_REF_RE.exec(text)) {
    const raw = m[1];
    if (!raw) continue;

    // The leading boundary is a captured delimiter, not part of the
    // match we want to underline.
    const start = m.index + m[0].indexOf(raw);
    let path = raw;

    // Strip trailing punctuation, but only when there is no line number
    // after it — `foo.ts:12` ends in a digit and needs no trimming.
    const hasLine = m[2] !== undefined;
    if (!hasLine) {
      const trimmed = path.replace(TRAILING_JUNK, "");
      if (!trimmed) continue;
      path = trimmed;
    }

    // A lone `.` or `..` is a directory reference, not a file.
    if (path === "." || path === "..") continue;
    // Reject things that are only punctuation or only a dot-extension.
    if (!/[A-Za-z0-9]/.test(path)) continue;

    const line = m[2] ? Number(m[2]) : null;
    const column = m[3] ? Number(m[3]) : null;
    const end =
      start +
      path.length +
      (m[2] ? m[2].length + 1 : 0) +
      (m[3] ? m[3].length + 1 : 0);

    out.push({ path, line, column, start, end });
    // Continue scanning *after* this reference so adjacent ones both
    // match; the leading-boundary group would otherwise consume the
    // separator the next match needs.
    FILE_REF_RE.lastIndex = end;
  }
  return out;
}

/** Absolute, `~`, and explicitly-relative paths look like paths on their
 *  own; a bare `src/x.ts` needs the surface's cwd to mean anything. */
export function isAbsoluteish(path: string): boolean {
  return path.startsWith("/") || path.startsWith("~");
}
