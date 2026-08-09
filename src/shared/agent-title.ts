/**
 * Normalise a terminal title emitted by an agent CLI.
 *
 * Claude Code sets the window title to `<glyph> <summary>`, where the
 * glyph is an animated braille spinner while a turn is in flight and a
 * static mark when it is not. Two consequences for τ-mux:
 *
 *  - The pane bar churns. The spinner advances several times a second,
 *    so a title that never changes semantically rewrites itself
 *    constantly, and every consumer downstream (sidebar, Atlas labels,
 *    persisted layout) sees a "new" title each frame. A saved
 *    `layout.json` ends up holding a spinner frame — `⢂ Commit changes`.
 *  - A real signal gets thrown away. The glyph *is* Claude Code telling
 *    us whether it is working, on a channel that keeps reporting even
 *    when the hook bridge is missing or a session predates it.
 *
 * So: split them. The text becomes the title; the glyph becomes state.
 */

/** Braille spinner frames Claude Code cycles while a turn is running.
 *  U+2800–U+28FF is the braille block; the spinner uses the dense
 *  patterns. Matching the whole block is deliberate — the exact frame
 *  set is not ours to pin down and has changed between releases. */
const BRAILLE = /[\u2800-\u28FF]/;

/** Static marks seen at rest: the asterisk operators Claude Code uses,
 *  plus the bullet/star family other CLIs pick. Written as escapes
 *  rather than literals — several have emoji presentation, and the
 *  emoji audit (guideline §0) rightly refuses those in source. */
const STATIC_MARK = new RegExp(
  "[" +
    "\u2731\u2732\u2733\u273B" + // heavy / open asterisk operators
    "\u2726\u2727" + // four-pointed stars
    "\u25CF\u25CB\u2022\u00B7" + // filled + hollow circles, bullets
    "]",
);

export interface AgentTitle {
  /** The title with any leading status glyph removed. */
  text: string;
  /** The glyph that was stripped, or "" when there was none. */
  glyph: string;
  /** True when the glyph is a spinner frame — the agent is working. */
  busy: boolean;
  /** True when a glyph was present at all, i.e. this looks like an
   *  agent-authored title rather than a shell's or an editor's. */
  fromAgent: boolean;
}

/**
 * Split a raw OSC 0/2 title into stable text plus its status glyph.
 *
 * Only a *leading* glyph is stripped, and only when followed by real
 * text: a title that is entirely punctuation, or one whose bullet is in
 * the middle, is left alone. Being conservative matters because this
 * runs on every title from every program, not just agent panes.
 */
export function parseAgentTitle(raw: string): AgentTitle {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { text: "", glyph: "", busy: false, fromAgent: false };
  }

  const first = [...trimmed][0] ?? "";
  const isSpinner = BRAILLE.test(first);
  const isMark = STATIC_MARK.test(first);
  if (!isSpinner && !isMark) {
    return { text: trimmed, glyph: "", busy: false, fromAgent: false };
  }

  const rest = trimmed.slice(first.length).trim();
  if (!rest) {
    // A bare glyph carries state but no name; keep the original so the
    // pane bar doesn't go blank.
    return { text: trimmed, glyph: first, busy: isSpinner, fromAgent: true };
  }
  return { text: rest, glyph: first, busy: isSpinner, fromAgent: true };
}
