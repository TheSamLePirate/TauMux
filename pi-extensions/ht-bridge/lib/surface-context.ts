/**
 * Surface context — resolve which τ-mux surface (and workspace) the
 * extension is running inside, plus a stable agent-id used to
 * attribute plan rows and ask-user requests so multiple pi instances
 * in the same workspace coexist.
 *
 * `HT_SURFACE` is auto-set by τ-mux for every spawned shell (see
 * `src/bun/pty-manager.ts`). The workspace id and live cwd / fg
 * command are pulled from `system.identify` at session start. Older
 * τ-mux builds return snake_case `{ active_workspace,
 * focused_surface }`, newer bridge tests may use camelCase aliases;
 * both shapes are accepted. If the focused surface is not the pi pane,
 * `system.tree` is used as a best-effort fallback to map HT_SURFACE to
 * its owning workspace.
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
      active_workspace?: string;
      focused_surface?: string;
      metadata?: { cwd?: string | null; fg?: string | null };
    }>("system.identify", {});
    const focusedSurface = firstNonEmptyString(id?.surfaceId, id?.focused_surface);
    const identifiedWorkspace = firstNonEmptyString(
      id?.workspaceId,
      id?.active_workspace,
    );

    if (identifiedWorkspace && (!focusedSurface || focusedSurface === ctx.surfaceId)) {
      ctx.workspaceId = identifiedWorkspace;
    } else if (ctx.surfaceId) {
      const workspaceFromTree = await findWorkspaceForSurface(ctx.surfaceId, ht);
      if (workspaceFromTree) ctx.workspaceId = workspaceFromTree;
      else if (identifiedWorkspace) ctx.workspaceId = identifiedWorkspace;
    } else if (identifiedWorkspace) {
      ctx.workspaceId = identifiedWorkspace;
    }

    // `system.identify` metadata is advisory. Trust HT_SURFACE for
    // surface attribution; cwd/fg are used only for status context.
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

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

async function findWorkspaceForSurface(
  surfaceId: string,
  ht: HtClient,
): Promise<string | null> {
  try {
    const tree = await ht.call<
      Array<{
        workspace?: string;
        id?: string;
        surfaces?: Array<{ id?: string } | string>;
      }>
    >("system.tree", {});
    if (!Array.isArray(tree)) return null;
    for (const ws of tree) {
      const surfaces = Array.isArray(ws.surfaces) ? ws.surfaces : [];
      const found = surfaces.some((s) =>
        typeof s === "string" ? s === surfaceId : s?.id === surfaceId,
      );
      if (found) return firstNonEmptyString(ws.workspace, ws.id);
    }
  } catch (err) {
    if (debugEnabled()) {
      console.error(
        `[ht-bridge] surface-context tree lookup failed: ${(err as Error).message}`,
      );
    }
  }
  return null;
}
