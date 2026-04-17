/**
 * Pure factory for Workspace records.
 *
 * Before this module existed, `SurfaceManager.addSurface` /
 * `addBrowserSurface` / `addAgentSurface` each inlined the same 10-line
 * workspace-record construction (id counter, layout, surfaceIds set,
 * color cycling, empty status/progress/logs). The only thing that
 * varied was the display name and the first surface id. Collapsing
 * those into a single pure helper removes the duplication and makes
 * the workspace shape testable in isolation — `SurfaceManager` keeps
 * its private state, but the data construction is no longer coupled
 * to the class.
 */

import { PaneLayout } from "./pane-layout";
import { WORKSPACE_COLORS } from "../../shared/workspace-colors";
import type { Workspace } from "./surface-manager";

export interface CreateWorkspaceInput {
  /** First surface that will live in the workspace's pane tree. */
  surfaceId: string;
  /** Display name shown in the titlebar + sidebar. */
  name: string;
  /** 1-based index used to pick from WORKSPACE_COLORS. Callers are
   *  responsible for incrementing their counter — this keeps the
   *  factory pure. */
  counter: number;
}

/** Build a fresh Workspace record with empty status/progress/logs and
 *  a cycled color. No mutation, no I/O — the caller appends the
 *  result to its own workspaces list. */
export function createWorkspaceRecord(input: CreateWorkspaceInput): Workspace {
  const { surfaceId, name, counter } = input;
  return {
    id: `ws:${counter}`,
    layout: new PaneLayout(surfaceId),
    surfaceIds: new Set([surfaceId]),
    name,
    color: WORKSPACE_COLORS[(counter - 1) % WORKSPACE_COLORS.length],
    status: new Map(),
    progress: null,
    logs: [],
  };
}
