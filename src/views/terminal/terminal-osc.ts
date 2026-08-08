/**
 * Escape sequences a pane listens for, beyond what xterm handles itself.
 *
 * xterm 6.0 registers OSC handlers for 0, 1, 2, 4, 8, 10, 11, 12, 104,
 * 110, 111 and 112 — everything else reaches the parser and is dropped.
 * Two of the dropped ones are how programs ask the terminal to *notify
 * the user*, which is a request τ-mux is unusually well equipped to
 * honour: it owns a notification centre, a sidebar ticker, a sound, and
 * a Telegram bridge.
 *
 * ## OSC 9 has two dialects sharing one number
 *
 *   - **ConEmu** `ESC ] 9 ; 4 ; <state> ; <progress> ST` — progress.
 *     Also 9;9 for cwd, which Windows Terminal and others emit.
 *   - **iTerm2** `ESC ] 9 ; <message> ST` — a desktop notification.
 *     No sub-command number; the payload *is* the message.
 *
 * They are told apart by shape, which is unavoidably heuristic: a
 * notification whose text begins `4;` would be read as progress. That
 * collision is inherent to the two specs colliding on OSC 9 and is
 * resolved the same way by every terminal that implements both —
 * progress wins, because its grammar is strict and a message starting
 * with `4;` is vanishingly rare.
 *
 * ## BEL
 *
 * The other notification channel. `terminal_bell` is a first-class
 * option in agent CLIs (Claude Code ships it as `preferredNotifChannel`)
 * and used to do nothing here because no `onBell` subscriber existed.
 *
 * Extracted from `surface-manager.ts`, which is over the size ratchet;
 * the callbacks let this module stay free of workspace/progress state.
 */

import type { Terminal } from "@xterm/xterm";
import { parseOsc94Payload, type Osc94Update } from "./osc-progress";

/** Longest title we accept from OSC 0/2. A runaway title from a program
 *  echoing a file's contents would otherwise blow out the sidebar. */
const MAX_TITLE_CHARS = 60;

/** Longest notification body we accept from OSC 9. Same reasoning. */
const MAX_NOTIFY_CHARS = 500;

/** Minimum gap between two BEL-derived notifications on one terminal.
 *  One per five seconds is enough to mean "something wants you". */
export const BELL_THROTTLE_MS = 5000;

/** Injectable clock — tests drive the throttle without sleeping. */
let now_ = () => Date.now();

/** Test seam. Pass no argument to restore the real clock. */
export function setOscClockForTest(clock?: () => number): void {
  now_ = clock ?? (() => Date.now());
}

export interface TerminalOscHooks {
  /** OSC 0/2 — window title. Already trimmed and length-capped. */
  onTitle: (title: string) => void;
  /** OSC 9;4 — progress. Only called when `isProgressEnabled()` is true. */
  onProgress: (update: Osc94Update) => void;
  /** OSC 9 (iTerm2 dialect) — a notification request from the program.
   *  Only called when `isNotifyEnabled()` is true. */
  onNotify: (message: string) => void;
  /** BEL, already throttled — see `BELL_THROTTLE_MS`. */
  onBell: () => void;
  isProgressEnabled: () => boolean;
  isNotifyEnabled: () => boolean;
}

/**
 * xterm surface this module needs. Structural and fully optional
 * because the happy-dom SurfaceManager suite mocks `Terminal` with only
 * the members it uses — every hook here is feature-detected so that
 * mock does not have to grow a method per subscription.
 */
type OscCapableTerminal = Pick<Terminal, never> & {
  onTitleChange?: (cb: (title: string) => void) => unknown;
  onBell?: (cb: () => void) => unknown;
  parser?: {
    registerOscHandler?: (
      ident: number,
      cb: (data: string) => boolean,
    ) => unknown;
  };
};

export function installTerminalOscHandlers(
  term: OscCapableTerminal,
  hooks: TerminalOscHooks,
): void {
  // OSC 0/2 — programs like vim, htop and ssh set the window title.
  // Without this the pane bar showed the login shell's basename forever.
  if (typeof term.onTitleChange === "function") {
    term.onTitleChange((title) => {
      const clean = title.trim().slice(0, MAX_TITLE_CHARS);
      if (clean) hooks.onTitle(clean);
    });
  }

  // BEL is one byte, and a program can emit it in a loop (a failing
  // readline completion, `yes $'\a'`). Unthrottled that would mint
  // hundreds of notifications a second, each persisted and forwarded to
  // Telegram. The throttle lives here, in a closure per terminal,
  // because it is a property of *this bell* — not shared state the
  // caller should have to model.
  if (typeof term.onBell === "function") {
    let lastBellAt = 0;
    term.onBell(() => {
      const now = now_();
      if (now - lastBellAt < BELL_THROTTLE_MS) return;
      lastBellAt = now;
      hooks.onBell();
    });
  }

  // `parser` is gated behind allowProposedApi, which pane terminals set.
  const register = term.parser?.registerOscHandler;
  if (!register) return;

  register.call(term.parser, 9, (body: string) => handleOsc9(body, hooks));
}

/**
 * Route one OSC 9 payload. Exported for tests — the dialect split is the
 * interesting logic and it should not need a live terminal to exercise.
 *
 * Returns xterm's handler contract: `true` = consumed, `false` = pass on
 * to whatever else is registered (nothing, today, which means dropped).
 */
export function handleOsc9(body: string, hooks: TerminalOscHooks): boolean {
  const progress = parseOsc94Payload(body);
  if (progress) {
    // Returning false when disabled keeps the sequence from being
    // treated as a notification instead — an opt-out of progress is not
    // an opt-in to popups.
    if (!hooks.isProgressEnabled()) return false;
    hooks.onProgress(progress);
    return true;
  }

  // ConEmu 9;9 — "set cwd". τ-mux gets cwd from the metadata poller,
  // which works for every shell without integration, so this is
  // deliberately swallowed rather than acted on: the point is to stop it
  // being mistaken for notification text.
  if (body.startsWith("9;")) return true;

  const message = body.trim().slice(0, MAX_NOTIFY_CHARS);
  if (!message) return true;
  if (!hooks.isNotifyEnabled()) return true;
  hooks.onNotify(message);
  return true;
}
