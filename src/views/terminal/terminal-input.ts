/**
 * Keyboard overrides installed on every terminal pane.
 *
 * xterm 6.0 has no Kitty keyboard protocol, so a handful of chords it
 * cannot express have to be hand-encoded. `encodeKeyOverride` owns
 * *which* bytes; this module owns *installing* the hook, which is
 * fiddlier than it looks:
 *
 *   - `attachCustomKeyEventHandler` holds exactly one handler, so this
 *     must be the only caller per terminal.
 *   - Returning `false` stops xterm — it does **not** stop the browser.
 *     An un-prevented Enter still reaches xterm's hidden helper textarea
 *     and returns as an `input` event, i.e. the very CR we suppressed,
 *     sent anyway. Hence the explicit `preventDefault`.
 *
 * Lives outside `surface-manager.ts` because that module is already over
 * the size ratchet, and this is a self-contained concern with two
 * injected callbacks.
 */

import { encodeKeyOverride } from "../../shared/terminal-key-encoding";

/** The slice of xterm's Terminal this module touches. Structural so the
 *  happy-dom test mocks satisfy it without implementing all of xterm. */
export interface KeyOverrideTarget {
  attachCustomKeyEventHandler?: (
    handler: (event: KeyboardEvent) => boolean,
  ) => void;
}

export interface KeyOverrideHooks {
  /** Send bytes to the PTY. */
  onData: (data: string) => void;
  /** Optional visual feedback hook (bloom input pulse). */
  onPulse?: (length: number) => void;
}

/**
 * Install the override handler. No-ops when the terminal does not
 * implement `attachCustomKeyEventHandler` (the SurfaceManager test mock
 * does not), so callers need no feature-detection of their own.
 *
 * Returns whether a handler was installed — useful in tests, ignored in
 * production.
 */
export function installKeyOverrides(
  term: KeyOverrideTarget,
  hooks: KeyOverrideHooks,
): boolean {
  if (typeof term.attachCustomKeyEventHandler !== "function") return false;

  term.attachCustomKeyEventHandler((event) => {
    const override = encodeKeyOverride(event);
    if (override === null) return true;
    event.preventDefault();
    hooks.onPulse?.(override.length);
    hooks.onData(override);
    return false;
  });
  return true;
}
