/**
 * Native-side adapter — projects `Workspace[]` (the surface-manager
 * domain object that owns a `PaneLayout` instance + a `Set<string>` of
 * surface ids) into the abstract `SidebarStateWorkspace[]` shape the
 * shared `buildSidebarWorkspaces` consumes. M13 of the web-mirror
 * parity plan moved the projection itself to `src/shared/sidebar-state.ts`
 * so the web client could compute the same `WorkspaceInfo[]` from
 * its protocol snapshot.
 *
 * Re-exports every public type from the shared module so existing
 * callers (`SurfaceManager.updateSidebar`, the test suite) keep
 * working with no path change.
 */

import type { SurfaceMetadata } from "../../shared/types";
import {
  buildSidebarWorkspaces as buildSidebarWorkspacesShared,
  type SidebarStateInput as SharedSidebarStateInput,
  type SidebarStateWorkspace,
  type SidebarSurfaceSummary,
  type WorkspaceInfo,
} from "../../shared/sidebar-state";
import type { Workspace } from "./surface-manager";

// Re-export shared types so native consumers can keep importing from
// this path.
export type {
  SidebarSurfaceSummary,
  SidebarStatusValue,
  WorkspaceInfo,
} from "../../shared/sidebar-state";
export {
  extractCargoSubcommand,
  extractScriptName,
  samePortSet,
} from "../../shared/sidebar-state";

/** Native-flavoured input — same shape as before the M13 move
 *  (Workspace[], not the abstract SidebarStateWorkspace[]). */
export interface SidebarStateInput {
  workspaces: Workspace[];
  surfaces: Map<string, SidebarSurfaceSummary>;
  focusedSurfaceId: string | null;
  activeWorkspaceIndex: number;
  metadata: Map<string, SurfaceMetadata>;
  selectedCwds: Map<string, string>;
  scriptErrors: Map<string, number>;
  htStatusKeyOrder?: readonly string[];
  htStatusKeyHidden?: readonly string[];
}

/** Project a native `Workspace` into the abstract shape the shared
 *  builder reads. The single shape differences are PaneLayout's
 *  `getAllSurfaceIds()` method (vs an array on the abstract shape)
 *  and the Set→ReadonlySet narrowing for `surfaceIdSet`. */
function adaptWorkspace(ws: Workspace): SidebarStateWorkspace {
  return {
    id: ws.id,
    name: ws.name,
    color: ws.color,
    surfaceIdsInLayoutOrder: ws.layout.getAllSurfaceIds(),
    surfaceIdSet: ws.surfaceIds,
    status: ws.status,
    progress: ws.progress,
  };
}

/** Native entry point. Adapts the input then delegates to the shared
 *  builder. */
export function buildSidebarWorkspaces(
  input: SidebarStateInput,
): WorkspaceInfo[] {
  const adapted: SharedSidebarStateInput = {
    workspaces: input.workspaces.map(adaptWorkspace),
    surfaces: input.surfaces,
    focusedSurfaceId: input.focusedSurfaceId,
    activeWorkspaceIndex: input.activeWorkspaceIndex,
    metadata: input.metadata,
    selectedCwds: input.selectedCwds,
    scriptErrors: input.scriptErrors,
    htStatusKeyOrder: input.htStatusKeyOrder,
    htStatusKeyHidden: input.htStatusKeyHidden,
  };
  return buildSidebarWorkspacesShared(adapted);
}
