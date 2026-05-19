import { resolveWorkspaceId } from "./shared";
import type { Handler, HandlerDeps } from "./types";

export function registerWorkspace(deps: HandlerDeps): Record<string, Handler> {
  const { getState, dispatch } = deps;

  return {
    "workspace.list": () => {
      const state = getState();
      return state.workspaces.map((ws) => ({
        id: ws.id,
        name: ws.name,
        color: ws.color,
        active: ws.id === state.activeWorkspaceId,
        surface_count: ws.surfaceIds.length,
      }));
    },

    "workspace.current": () => {
      const state = getState();
      const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
      return ws ?? null;
    },

    "workspace.create": (params) => {
      dispatch("createSurface", { cwd: params["cwd"] ?? undefined });
      return "OK";
    },

    "workspace.select": (params) => {
      dispatch("selectWorkspace", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
      });
      return "OK";
    },

    "workspace.close": (params) => {
      dispatch("closeWorkspace", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
      });
      return "OK";
    },

    "workspace.rename": (params) => {
      // Lookup order: --workspace W → workspace owning surface_id (set
      // from HT_SURFACE by the CLI) → active workspace. Matches the rest
      // of the workspace-targeting verbs and lets bare
      // `ht rename-workspace "build"` work inside a τ-mux pane.
      const state = getState();
      const workspaceId =
        resolveWorkspaceId(params, state.workspaces) ??
        state.activeWorkspaceId ??
        undefined;
      dispatch("renameWorkspace", {
        workspaceId,
        name: params["name"] ?? params["title"],
      });
      return "OK";
    },

    "workspace.next": () => {
      dispatch("nextWorkspace", {});
      return "OK";
    },

    "workspace.previous": () => {
      dispatch("prevWorkspace", {});
      return "OK";
    },
  };
}
