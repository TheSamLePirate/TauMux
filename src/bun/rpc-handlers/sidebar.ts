import type { Handler, HandlerDeps } from "./types";
import { resolveWorkspaceId } from "./shared";

export function registerSidebar(deps: HandlerDeps): Record<string, Handler> {
  const { dispatch, getState } = deps;
  const resolve = (params: Record<string, unknown>) =>
    resolveWorkspaceId(params, getState().workspaces);

  return {
    "sidebar.set_status": (params) => {
      dispatch("setStatus", {
        workspaceId: resolve(params),
        key: params["key"],
        value: params["value"],
        icon: params["icon"],
        color: params["color"],
      });
      return "OK";
    },

    "sidebar.clear_status": (params) => {
      dispatch("clearStatus", {
        workspaceId: resolve(params),
        key: params["key"],
      });
      return "OK";
    },

    "sidebar.set_progress": (params) => {
      dispatch("setProgress", {
        workspaceId: resolve(params),
        value: params["value"],
        label: params["label"],
      });
      return "OK";
    },

    "sidebar.clear_progress": (params) => {
      dispatch("clearProgress", {
        workspaceId: resolve(params),
      });
      return "OK";
    },

    "sidebar.log": (params) => {
      dispatch("log", {
        workspaceId: resolve(params),
        level: params["level"] ?? "info",
        message: params["message"],
        source: params["source"],
      });
      return "OK";
    },
  };
}
