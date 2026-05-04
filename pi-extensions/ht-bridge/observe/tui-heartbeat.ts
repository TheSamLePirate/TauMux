/**
 * TUI heartbeat — installs a K2000 / KITT-style sweeping scanner as
 * pi's working indicator, so while pi is streaming a response the
 * footer shows ht-bridge is alive and pi is busy.
 *
 *   pi idle:  (pi hides the indicator)
 *   pi busy:  ░▒█──────  →  ─░▒█─────  →  …  →  ────░▒█──  →  …
 *
 * Pi's `ctx.ui.setWorkingIndicator({ frames, intervalMs })` owns the
 * actual animation timing — we just hand over the frames once at
 * `session_start`. Pi also clears the indicator automatically when a
 * turn finishes, so this module needs no shutdown cleanup.
 *
 * Outside an interactive TUI (`pi -p`, `pi --json`) `ctx.hasUI` is
 * false and pi ignores the indicator anyway, but we early-out so we
 * don't risk surfacing a partial theme.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { Config } from "../lib/config";
import { debugEnabled } from "../lib/config";
import { buildFrames } from "./tui-heartbeat-frames";

export function registerTuiHeartbeat(pi: ExtensionAPI, cfg: Config): void {
  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    try {
      if (!ctx.hasUI) return;
      const setIndicator = (ctx.ui as any).setWorkingIndicator;
      if (typeof setIndicator !== "function") return;
      const frames = buildFrames(ctx.ui.theme ?? null, {
        rowLen: cfg.tuiHeartbeatLength,
      });
      setIndicator.call(ctx.ui, {
        frames,
        intervalMs: cfg.tuiHeartbeatIntervalMs,
      });
    } catch (err) {
      if (debugEnabled()) {
        console.error(
          `[ht-bridge] tui-heartbeat install failed: ${(err as Error).message}`,
        );
      }
    }
  });
}
