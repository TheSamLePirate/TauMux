/**
 * xterm.js renderer selection — GPU (WebGL) with a DOM safety net.
 *
 * Without an explicit renderer addon, xterm falls back to its DOM
 * renderer: one element per styled run, restyled on every frame. That is
 * the single largest cost in the webview under heavy terminal output —
 * it drives both WebContent CPU (style recalc + layout) and the GPU
 * process (compositing a large, constantly-invalidated layer tree).
 * `@xterm/addon-webgl` instead renders glyphs from a texture atlas, so a
 * screenful of output is a handful of draw calls.
 *
 * The tradeoff is that WebGL can fail or go away at runtime — a driver
 * reset, a GPU process crash, too many live contexts across panes, or a
 * machine with no WebGL at all. This module makes that a non-event: any
 * failure disposes the addon and leaves the terminal on the DOM
 * renderer, which is always available. A pane must never go blank
 * because of an optimisation.
 *
 * `TerminalEffects` (the bloom layer) is unaffected either way — it
 * reads `term.buffer.active` and `.xterm-screen`'s bounding rect, both
 * of which are renderer-independent.
 */

import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";

export type TerminalRendererKind = "webgl" | "dom";

/** Reasons a terminal ended up on the DOM renderer. Surfaced for logging
 *  and for the settings panel's status hint. */
export type RendererFallbackReason =
  "setting" | "unsupported" | "init-failed" | "context-lost";

export interface RendererHandle {
  /** What is actually rendering right now — not what was requested. */
  readonly active: TerminalRendererKind;
  readonly fallbackReason: RendererFallbackReason | null;
  dispose(): void;
}

/** Emitted once per reason so a repeatedly-failing machine doesn't spam
 *  the console on every new pane. */
const warnedReasons = new Set<RendererFallbackReason>();

function warnOnce(reason: RendererFallbackReason, detail?: unknown): void {
  if (warnedReasons.has(reason)) return;
  warnedReasons.add(reason);
  console.warn(
    `[renderer] WebGL unavailable (${reason}) — using the DOM renderer.`,
    detail ?? "",
  );
}

/** Test seam — forget which reasons have already been logged. */
export function resetRendererWarningsForTest(): void {
  warnedReasons.clear();
}

/**
 * Cheap capability probe run before we construct the addon.
 *
 * `WebglAddon`'s constructor throws when there is no context to be had,
 * and a throw inside `term.loadAddon` is messier to recover from than a
 * simple up-front check. Uses a 1×1 throwaway canvas so it costs
 * nothing.
 */
function webglSupported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
    if (!gl) return false;
    // Release the probe context immediately rather than waiting for GC —
    // browsers cap the number of live WebGL contexts, and with one
    // terminal per pane plus the bloom layer we are already a heavy user.
    const lose = (gl as WebGLRenderingContext).getExtension(
      "WEBGL_lose_context",
    ) as { loseContext(): void } | null;
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Attach the requested renderer to `term`, which must already be
 * `open()`ed (the addon needs a live DOM node to bind its canvas to).
 *
 * Never throws. The returned handle always describes what really ended
 * up rendering, so callers can report honestly instead of assuming the
 * request was honoured.
 */
export function attachRenderer(
  term: Terminal,
  kind: TerminalRendererKind,
): RendererHandle {
  const dom = (reason: RendererFallbackReason | null): RendererHandle => ({
    active: "dom",
    fallbackReason: reason,
    dispose: () => {},
  });

  if (kind === "dom") return dom("setting");

  if (!webglSupported()) {
    warnOnce("unsupported");
    return dom("unsupported");
  }

  let addon: WebglAddon | null = null;
  try {
    addon = new WebglAddon();
  } catch (err) {
    warnOnce("init-failed", err);
    return dom("init-failed");
  }

  // A lost context is unrecoverable for this addon instance: xterm's own
  // guidance is to dispose it and let the DOM renderer take over. The
  // terminal keeps its buffer and keeps rendering — the user sees at
  // most a single dropped frame.
  const handle: {
    active: TerminalRendererKind;
    fallbackReason: RendererFallbackReason | null;
  } = { active: "webgl", fallbackReason: null };

  try {
    addon.onContextLoss(() => {
      handle.active = "dom";
      handle.fallbackReason = "context-lost";
      warnOnce("context-lost");
      try {
        addon?.dispose();
      } catch {
        /* already torn down */
      }
      addon = null;
    });
  } catch {
    // Older addon builds may not expose onContextLoss. Losing the
    // subscription is survivable — worst case a context loss leaves a
    // dead canvas until the pane is recreated — so don't fail the attach.
  }

  try {
    term.loadAddon(addon);
  } catch (err) {
    warnOnce("init-failed", err);
    try {
      addon?.dispose();
    } catch {
      /* nothing to clean up */
    }
    return dom("init-failed");
  }

  return {
    get active() {
      return handle.active;
    },
    get fallbackReason() {
      return handle.fallbackReason;
    },
    dispose() {
      try {
        addon?.dispose();
      } catch {
        /* already disposed by context loss */
      }
      addon = null;
    },
  };
}
