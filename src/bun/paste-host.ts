/**
 * Clipboard → PTY, with the size policy and the framing decision.
 *
 * ⌘V is intercepted in the webview and handled here rather than by
 * xterm, because reading the system clipboard needs native access the
 * WebView does not have. The cost of that detour is that xterm's own
 * `paste()` — which is what brackets a paste and normalises its line
 * endings — never runs, so this module has to do both jobs itself.
 * `SessionManager.writePaste` does the framing; the policy below decides
 * whether the paste happens at all.
 *
 * Extracted from `index.ts` because the module-size ratchet is right:
 * this is self-contained policy with an injectable environment, and out
 * here it can be tested without Electrobun, a window, or a clipboard.
 */

import {
  PASTE_MAX_CHARS,
  classifyPasteSize,
  describePasteSize,
} from "../shared/bracketed-paste";

export interface PasteHostDeps {
  /** Native clipboard read. Returning `null` falls through to `pbpaste`. */
  readNativeClipboard: () => string | null;
  /** Ask the user about an unusually large paste. Resolve `false` to drop
   *  it. Not called for ordinary pastes. */
  confirmLargePaste: (summary: string, preview: string) => Promise<boolean>;
  /** User-visible message — a refusal is not something to swallow. */
  notify: (message: string, level: "warning" | "info" | "error") => void;
  /** Frame (if the app asked for it) and write to the PTY. */
  writePaste: (surfaceId: string, text: string) => void;
  /** Tell the auto-continue engine a human acted, so it backs off. */
  onHumanInput: (surfaceId: string) => void;
}

/** How long `pbpaste` gets before we give up on it. macOS SecureInput
 *  can wedge it indefinitely; a stuck paste must not wedge the surface. */
const PBPASTE_TIMEOUT_MS = 2000;

/** Longest first-line excerpt shown in the confirm dialog. */
const PREVIEW_CHARS = 120;

export function createPasteHost(
  deps: PasteHostDeps,
): (surfaceId: string | null | undefined) => Promise<void> {
  return async function paste(surfaceId) {
    if (!surfaceId) return;

    const text = await readClipboard(deps.readNativeClipboard);
    if (!text) return;

    // Size policy runs before framing. Refusal is deliberate over
    // truncation: outside bracketed-paste mode a truncated paste is a
    // truncated *command*, and half of an `rm -rf` is still a command.
    const verdict = classifyPasteSize(text);
    if (verdict.refuse) {
      deps.notify(
        `Paste refused — ${describePasteSize(verdict)} exceeds the ` +
          `${Math.round(PASTE_MAX_CHARS / 1024)} KB limit. ` +
          `Write it to a file and reference that instead.`,
        "warning",
      );
      return;
    }

    if (verdict.confirm) {
      const accepted = await deps.confirmLargePaste(
        describePasteSize(verdict),
        previewFirstLine(text),
      );
      if (!accepted) return;
    }

    deps.onHumanInput(surfaceId);
    deps.writePaste(surfaceId, text);
  };
}

/** First line, elided, prefixed for display. Empty when the paste starts
 *  with a newline — better to show nothing than a misleading blank. */
export function previewFirstLine(text: string): string {
  const first = text.split(/\r\n|\r|\n/, 1)[0] ?? "";
  if (!first) return "";
  const clipped =
    first.length > PREVIEW_CHARS ? `${first.slice(0, PREVIEW_CHARS)}…` : first;
  return `Starts with: ${clipped}`;
}

/** Native read first; `pbpaste` as the fallback for builds where the FFI
 *  path is unavailable. Never throws — a failed read is an empty paste. */
async function readClipboard(
  readNative: () => string | null,
): Promise<string | null> {
  try {
    const native = readNative();
    if (native !== null && native !== undefined) return native;
  } catch {
    /* FFI unavailable — fall through */
  }

  try {
    const proc = Bun.spawn(["pbpaste"], { stdout: "pipe" });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<string>((resolve) => {
      timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* already gone */
        }
        resolve("");
      }, PBPASTE_TIMEOUT_MS);
    });
    const out = await Promise.race([new Response(proc.stdout).text(), timeout]);
    if (timer) clearTimeout(timer);
    proc.exited.catch(() => {
      /* reaped */
    });
    return out;
  } catch {
    return null;
  }
}
