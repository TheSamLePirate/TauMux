import type { Handler, HandlerDeps } from "./types";

export function registerSidebar(deps: HandlerDeps): Record<string, Handler> {
  const { dispatch } = deps;

  return {
    "sidebar.set_status": (params) => {
      dispatch("setStatus", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
        key: params["key"],
        value: params["value"],
        icon: params["icon"],
        color: params["color"],
      });
      return "OK";
    },

    "sidebar.clear_status": (params) => {
      dispatch("clearStatus", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
        key: params["key"],
      });
      return "OK";
    },

    "sidebar.set_progress": (params) => {
      dispatch("setProgress", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
        value: params["value"],
        label: params["label"],
      });
      return "OK";
    },

    "sidebar.clear_progress": (params) => {
      dispatch("clearProgress", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
      });
      return "OK";
    },

    "sidebar.log": (params) => {
      dispatch("log", {
        workspaceId: params["workspace_id"] ?? params["workspace"],
        level: params["level"] ?? "info",
        message: params["message"],
        source: params["source"],
      });
      return "OK";
    },
  };
}
