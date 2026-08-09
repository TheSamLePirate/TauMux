/**
 * xterm construction options for a terminal pane.
 *
 * Split out of `surface-manager.ts` so the choices that affect how the
 * terminal *behaves* (as opposed to how it looks) have somewhere to be
 * explained, and so the web mirror can be checked against the same
 * source when parity questions come up.
 */

import type { ITerminalOptions } from "@xterm/xterm";

export interface PaneTerminalOptionsInput {
  fontSize: number;
  scrollback: number;
  theme: ITerminalOptions["theme"];
}

export const PANE_FONT_FAMILY =
  "'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Berkeley Mono', 'SF Mono', 'Menlo', monospace";

/**
 * Palette a pane is *born* with, before `applySettings` swaps in the
 * user's chosen preset. Transparent background so the pane's own
 * `--bg-terminal` shows through; everything else is the neutral set the
 * default theme ships.
 *
 * Lives beside the option builder rather than in `surface-manager.ts`
 * because it is the other half of "how a terminal is constructed", and
 * the manager is under a module-size ratchet that this literal was
 * quietly spending.
 */
export const DEFAULT_PANE_THEME: ITerminalOptions["theme"] = {
  background: "rgba(10, 10, 10, 0)",
  foreground: "#f5f7fb",
  cursor: "#eab308",
  cursorAccent: "#0a0a0a",
  selectionBackground: "rgba(234, 179, 8, 0.2)",
  selectionForeground: "#f5f7fb",
  black: "#0a0a0a",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#f59e0b",
  blue: "#a1a1aa",
  magenta: "#c4c4cf",
  cyan: "#d7dae1",
  white: "#d7dce7",
  brightBlack: "#5c6270",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fbbf24",
  brightBlue: "#c7cad2",
  brightMagenta: "#d7dae1",
  brightCyan: "#e5e7eb",
  brightWhite: "#f5f7fb",
};

export function buildPaneTerminalOptions(
  input: PaneTerminalOptionsInput,
): ITerminalOptions {
  return {
    theme: input.theme,
    fontFamily: PANE_FONT_FAMILY,
    fontSize: input.fontSize,
    lineHeight: 1.0,
    cursorBlink: true,
    cursorStyle: "block",
    allowTransparency: true,
    // Required for `term.parser.registerOscHandler` (OSC 9 progress /
    // notifications) and `term.modes`.
    allowProposedApi: true,
    // Must come from settings at *construction*: a pane created after
    // startup used to be built with a hard-coded 10 000 and only pick up
    // the user's value on the next settings change.
    scrollback: input.scrollback,
    // ⌥ as Meta. xterm defaults this to false, which makes ⌥Enter — the
    // multiline shortcut every macOS agent CLI documents — arrive as a
    // dead-key accent instead of the `ESC CR` those CLIs parse. Claude
    // Code's own `/terminal-setup` flips the equivalent iTerm2 pref
    // (`useOptionAsMetaKey`), so this is the expected host behaviour and
    // not a τ-mux opinion.
    //
    // The cost is losing ⌥-composed characters (´ ¨ ˆ) while the
    // terminal has focus — the same trade iTerm2's "Esc+" and Ghostty's
    // `macos-option-as-alt` make.
    macOptionIsMeta: true,
  };
}
