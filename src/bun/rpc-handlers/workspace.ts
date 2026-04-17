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
      dispatch("renameWorkspace", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
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
