import type { Handler, HandlerDeps } from "./types";

export function registerSidebar(deps: HandlerDeps): Record<string, Handler> {
  const { dispatch, getState } = deps;

  /** Resolve the workspace a sideband call targets. Explicit `workspace_id`
   *  wins. Otherwise fall back to the workspace that owns `surface_id`
   *  (HT_SURFACE is exported into every shell, so scripts inherit it for
   *  free). Returning `undefined` lets the webview fall back to its active
   *  workspace, which is only right when neither hint is available. */
  function resolveWorkspaceId(
    params: Record<string, unknown>,
  ): string | undefined {
    const explicit = (params["workspace_id"] ?? params["workspace"]) as
      | string
      | undefined;
    if (explicit) return explicit;
    const surfaceId = params["surface_id"] as string | undefined;
    if (!surfaceId) return undefined;
    const ws = getState().workspaces.find((w) =>
      w.surfaceIds.includes(surfaceId),
    );
    return ws?.id;
  }

  return {
    "sidebar.set_status": (params) => {
      dispatch("setStatus", {
        workspaceId: resolveWorkspaceId(params),
        key: params["key"],
        value: params["value"],
        icon: params["icon"],
        color: params["color"],
      });
      return "OK";
    },

    "sidebar.clear_status": (params) => {
      dispatch("clearStatus", {
        workspaceId: resolveWorkspaceId(params),
        key: params["key"],
      });
      return "OK";
    },

    "sidebar.set_progress": (params) => {
      dispatch("setProgress", {
        workspaceId: resolveWorkspaceId(params),
        value: params["value"],
        label: params["label"],
      });
      return "OK";
    },

    "sidebar.clear_progress": (params) => {
      dispatch("clearProgress", {
        workspaceId: resolveWorkspaceId(params),
      });
      return "OK";
    },

    "sidebar.log": (params) => {
      dispatch("log", {
        workspaceId: resolveWorkspaceId(params),
        level: params["level"] ?? "info",
        message: params["message"],
        source: params["source"],
      });
      return "OK";
    },
  };
}
