/**
 * τ-mux indicator pill in pi's TUI footer.
 *
 *   inside τ-mux:  ● τ-mux ws:2 surface:7
 *   outside τ-mux: ● τ-mux (offline)
 *
 * The dot is green (`success`) when ht-bridge is talking to a τ-mux
 * pane, red (`error`) when it isn't. The label dims after the dot so
 * it stays out of the way.
 *
 * The status renders immediately at `session_start`. Workspace +
 * surface come from the lazily-enriched `SurfaceContext`, so the
 * caller can invoke `handle.refresh()` once `system.identify` has
 * resolved to upgrade the pill from "τ-mux surface:7" to
 * "τ-mux ws:2 surface:7".
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { SurfaceContext } from "../lib/surface-context";

const STATUS_KEY = "ht-bridge";

export interface TuiStatusHandle {
  /** Re-render the pill — call after `enrichContext` resolves so
   *  the workspace id appears as soon as we know it. */
  refresh(): void;
}

/** Pure formatter — exported for unit tests. Theme is optional so
 *  non-TUI callers can render plain text. */
export function formatStatusLine(
  theme: { fg(color: string, text: string): string } | null,
  surface: SurfaceContext,
): string {
  const fg = theme ? theme.fg.bind(theme) : (_c: string, t: string) => t;
  if (!surface.inTauMux) {
    return `${fg("error", "●")} ${fg("dim", "τ-mux (offline)")}`;
  }
  const parts = ["τ-mux"];
  if (surface.workspaceId) parts.push(surface.workspaceId);
  if (surface.surfaceId) parts.push(surface.surfaceId);
  return `${fg("success", "●")} ${fg("dim", parts.join(" "))}`;
}

export function registerTuiStatus(
  pi: ExtensionAPI,
  surface: SurfaceContext,
): TuiStatusHandle {
  let savedCtx: ExtensionContext | null = null;

  const render = () => {
    const ctx = savedCtx;
    if (!ctx?.hasUI) return;
    try {
      ctx.ui.setStatus(
        STATUS_KEY,
        formatStatusLine(ctx.ui.theme ?? null, surface),
      );
    } catch {
      /* idem — pi sometimes tears the UI down between session_start and a refresh */
    }
  };

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    savedCtx = ctx;
    render();
  });

  pi.on("session_shutdown", () => {
    if (savedCtx?.hasUI) {
      try {
        savedCtx.ui.setStatus(STATUS_KEY, "");
      } catch {
        /* idem */
      }
    }
    savedCtx = null;
  });

  return { refresh: render };
}
