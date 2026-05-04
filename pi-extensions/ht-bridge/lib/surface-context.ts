/**
 * Surface context — resolve which τ-mux surface (and workspace) the
 * extension is running inside, plus a stable agent-id used to
 * attribute plan rows and ask-user requests so multiple pi instances
 * in the same workspace coexist.
 *
 * `HT_SURFACE` is auto-set by τ-mux for every spawned shell (see
 * `src/bun/pty-manager.ts`). The workspace id and live cwd / fg
 * command are pulled from `system.identify` at session start — that
 * RPC returns `{ workspaceId, surfaceId, metadata }` in one round
 * trip, so we don't need a separate `surface.metadata` call.
 *
 * `enrichContext` mutates the same object readers already hold, so
 * sub-modules captured the reference at session_start and they pick
 * up the workspace / cwd lazily once the call lands. Until it does,
 * `workspaceId` is null and `cwd` / `fg` are null.
 */

import type { HtClient } from "./ht-client";
import { debugEnabled } from "./config";

export interface SurfaceContext {
  /** Surface id like "surface:3" — empty if pi was launched outside τ-mux. */
  surfaceId: string;
  /** Workspace id like "ws:0". Null until enriched (or if outside τ-mux). */
  workspaceId: string | null;
  /** Stable agent id for plan/ask-user attribution.
   *  `pi:<surface>` so two pi panes in one workspace don't share state. */
  agentId: string;
  /** True when running inside τ-mux. */
  inTauMux: boolean;
  /** Foreground process cwd (most recently observed). Null until enriched. */
  cwd: string | null;
  /** Foreground process argv as one string. Null until enriched. */
  fg: string | null;
}

export function readSurfaceContext(): SurfaceContext {
  const surfaceId = process.env.HT_SURFACE ?? "";
  const inTauMux =
    Boolean(surfaceId) || Boolean(process.env.HYPERTERM_PROTOCOL_VERSION);
  const agentId = surfaceId ? `pi:${surfaceId}` : `pi:${process.pid}`;
  return {
    surfaceId,
    workspaceId: null,
    agentId,
    inTauMux,
    cwd: null,
    fg: null,
  };
}

/** Best-effort enrichment via `system.identify`. Mutates `ctx` in
 *  place. Silently swallows transport failures — outside τ-mux there
 *  is no socket; sub-modules just see workspaceId stay null. */
export async function enrichContext(
  ctx: SurfaceContext,
  ht: HtClient,
): Promise<void> {
  if (!ctx.inTauMux) return;
  try {
    const id = await ht.call<{
      workspaceId?: string;
      surfaceId?: string;
      metadata?: { cwd?: string | null; fg?: string | null };
    }>("system.identify", {});
    if (typeof id?.workspaceId === "string" && id.workspaceId.length > 0) {
      ctx.workspaceId = id.workspaceId;
    }
    // `system.identify` reports the focused surface, which may not
    // be the pi pane if pi was backgrounded. Trust HT_SURFACE for
    // surface attribution but pick up cwd/fg from whichever surface
    // the call resolved against — they're advisory metadata only.
    if (id?.metadata) {
      if (typeof id.metadata.cwd === "string") ctx.cwd = id.metadata.cwd;
      if (typeof id.metadata.fg === "string") ctx.fg = id.metadata.fg;
    }
  } catch (err) {
    if (debugEnabled()) {
      console.error(
        `[ht-bridge] surface-context enrichment failed: ${(err as Error).message}`,
      );
    }
  }
}
