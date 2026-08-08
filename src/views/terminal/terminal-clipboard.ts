/**
 * OSC 52 — clipboard access from inside the terminal.
 *
 * The useful case is one direction only: a program running over SSH, or
 * inside tmux, yanks text and expects it to land on the *local*
 * clipboard. nvim, tmux, kitty's `kitten clipboard` and most TUI editors
 * all speak it. Without a handler the sequence is parsed and dropped, so
 * "copy" silently does nothing — the kind of failure users blame on the
 * remote editor rather than the terminal.
 *
 * ## Read is refused, permanently and by design
 *
 * OSC 52 also defines a *read* — the program asks the terminal to send
 * the clipboard back over the PTY. That turns any process with terminal
 * access into a clipboard exfiltrator: it runs unprompted, leaves no
 * trace on screen, and the clipboard is where passwords, tokens and
 * recovery codes spend their time. xterm ships it disabled, iTerm2
 * prompts, Ghostty refuses by default.
 *
 * τ-mux refuses outright rather than making it a setting. A toggle here
 * would be a toggle whose only effect is to weaken the user, and the
 * legitimate use cases for reading the clipboard from a script are
 * already served by `pbpaste` and `ht`.
 *
 * ## Write goes through the app's clipboard path
 *
 * Not `navigator.clipboard` — the WebView's async clipboard API needs a
 * user gesture and an OSC arrives without one. Writes are handed to the
 * bun side, which owns native clipboard access, via the same
 * `clipboardWrite` RPC as ⌘C.
 */

import {
  ClipboardAddon,
  type IClipboardProvider,
} from "@xterm/addon-clipboard";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import type { ITerminalAddon } from "@xterm/xterm";
import { htEvents } from "../../shared/event-bus";

/** Selection targets from the OSC 52 grammar. `c` is the system
 *  clipboard; `p` is X11's primary selection, which macOS has no
 *  equivalent for. */
type ClipboardSelection = string;

export interface Osc52ProviderDeps {
  /** Write to the system clipboard. */
  write: (text: string) => void;
  /** `AppSettings.terminalOsc52WriteEnabled`. */
  isWriteEnabled: () => boolean;
}

/** Longest payload accepted from a single OSC 52 write. A terminal is
 *  not a file transfer channel, and an unbounded write lets a runaway
 *  program push megabytes through the clipboard. */
export const OSC52_MAX_CHARS = 100_000;

/** The addon's provider interface, restated with a concrete selection
 *  type so the pure factory below can be tested without the addon. */
export type Osc52Provider = IClipboardProvider & {
  readText: (selection: ClipboardSelection) => string;
  writeText: (selection: ClipboardSelection, data: string) => void;
};

export function createOsc52Provider(deps: Osc52ProviderDeps): Osc52Provider {
  return {
    // See the module header: this is not an oversight and not a missing
    // feature. Returning empty is the same answer the program gets from
    // a terminal that does not implement OSC 52 at all, which is the
    // behaviour every such program already handles.
    readText: () => "",

    writeText: (selection, data) => {
      if (!deps.isWriteEnabled()) return;
      // macOS has no primary selection; honouring `p` would silently
      // clobber the system clipboard on every mouse-select in a remote
      // vim, which is not what the program asked for.
      if (selection === "p") return;
      if (!data || data.length > OSC52_MAX_CHARS) return;
      deps.write(data);
    },
  };
}

/** Production provider — writes via the bun-side native clipboard. */
export function createDefaultOsc52Provider(
  isWriteEnabled: () => boolean,
): Osc52Provider {
  return createOsc52Provider({
    isWriteEnabled,
    write: (text) => htEvents.emit("ht-clipboard-write", { text }),
  });
}

/**
 * Load the two addons that decide how a pane measures and shares text.
 *
 * **Unicode 11 widths.** xterm's built-in table is Unicode v6 (2010),
 * which is wrong for most of what a modern TUI draws: emoji, the
 * box-drawing and marker glyphs agent CLIs build their transcripts out
 * of, powerline separators. A width disagreement between
 * the program and the terminal is not a cosmetic bug — the program
 * positions its cursor by counting columns, so every subsequent redraw
 * lands one cell off and the UI shreds. Applied unconditionally, with
 * no setting: v6 is not a preference anyone holds, and every terminal
 * these programs are tested against (Ghostty, iTerm2, kitty, WezTerm)
 * ships an up-to-date table.
 *
 * **OSC 52.** Write-only; see the module header.
 *
 * Both are wrapped: a failed optional addon must degrade the pane, not
 * prevent it from existing.
 */
export function installTerminalWidthAndClipboard(
  term: Unicode11Target,
  opts: { isOsc52WriteEnabled: () => boolean },
): void {
  try {
    term.loadAddon(new Unicode11Addon());
    if (term.unicode) term.unicode.activeVersion = "11";
  } catch (err) {
    console.warn("[terminal] Unicode 11 widths unavailable:", err);
  }

  try {
    term.loadAddon(
      new ClipboardAddon(
        undefined,
        createDefaultOsc52Provider(opts.isOsc52WriteEnabled),
      ),
    );
  } catch (err) {
    console.warn("[terminal] OSC 52 clipboard unavailable:", err);
  }
}

/** Structural slice of xterm's Terminal used above — keeps the happy-dom
 *  SurfaceManager mock from needing the full interface. `unicode` is
 *  optional for the same reason. */
interface Unicode11Target {
  loadAddon: (addon: ITerminalAddon) => void;
  unicode?: { activeVersion: string };
}
