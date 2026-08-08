/**
 * Keyboard sequences xterm.js 6.0 cannot produce on its own.
 *
 * ## The gap
 *
 * A plain VT keyboard has no way to distinguish Enter from Shift+Enter:
 * both are `CR` (0x0D). The fix the ecosystem settled on is the Kitty
 * keyboard protocol (CSI u), which encodes modifiers into the escape
 * sequence — Kitty, Ghostty, WezTerm, iTerm2, Alacritty, Warp and
 * Windows Terminal all implement it. xterm.js 6.0.0 does not (the
 * implementation landed in the 6.1 beta), so a τ-mux pane cannot tell an
 * agent CLI that Shift was held.
 *
 * That matters because Shift+Enter is how you write a multi-line prompt
 * to an agent, and without it every newline submits.
 *
 * ## What we send, and why exactly this
 *
 * `ESC CR` — meta+Return.
 *
 * This is not a guess. Claude Code's own `/terminal-setup` installs, for
 * VS Code:
 *
 * ```json
 * { "key": "shift+enter",
 *   "command": "workbench.action.terminal.sendSequence",
 *   "args": { "text": "\r" } }
 * ```
 *
 * …and for iTerm2 it sets `useOptionAsMetaKey`, so that ⌥Return produces
 * the same two bytes. `ESC CR` is therefore *the* sequence agent CLIs
 * parse as "newline, do not submit", and it is what τ-mux already emits
 * for ⌥Return now that `macOptionIsMeta` is on — Shift+Enter and
 * ⌥Enter agreeing is the correct outcome, not a coincidence.
 *
 * ## Scope
 *
 * Deliberately one key. This module is a stopgap for the single mapping
 * with an unambiguous, vendor-published answer; it is not a
 * reimplementation of CSI u. When xterm gains the real protocol, delete
 * this and let the terminal negotiate every modifier properly.
 *
 * Pure and DOM-free so it can be unit-tested without a browser, and
 * shared by the native webview and the web mirror so both panes behave
 * the same.
 */

/** The subset of `KeyboardEvent` this module reads. */
export interface KeyEventLike {
  readonly type: string;
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/** `ESC CR` — meta+Return. See the module header for the provenance. */
export const META_RETURN = "\x1b\r";

/**
 * Bytes to write for a key xterm would otherwise encode wrongly, or
 * `null` to let xterm handle the event normally.
 *
 * Only bare Shift+Enter qualifies. Adding Ctrl, Alt or Meta is left
 * alone on purpose:
 *   - ⌥Enter already produces `ESC CR` via `macOptionIsMeta`.
 *   - ⌃Enter and ⌘Enter carry app- and OS-level meanings we must not
 *     silently rewrite.
 */
export function encodeKeyOverride(ev: KeyEventLike): string | null {
  if (ev.type !== "keydown") return null;
  if (ev.key !== "Enter") return null;
  if (!ev.shiftKey) return null;
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return null;
  return META_RETURN;
}
