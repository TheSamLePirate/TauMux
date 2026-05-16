import type { Handler, HandlerDeps } from "./types";

function normalizeDirection(raw: unknown): "horizontal" | "vertical" {
  return raw === "down" || raw === "vertical" ? "vertical" : "horizontal";
}

function isEditorId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith("editor:");
}

export function registerEditor(deps: HandlerDeps): Record<string, Handler> {
  const { getState, dispatch } = deps;
  return {
    "editor.open": (params) => {
      const path = params["path"] as string | undefined;
      const split = params["split"] === true || params["split"] === "true";
      const payload = {
        path,
        cwd: params["cwd"] as string | undefined,
        create: params["create"] === true || params["create"] === "true",
        direction: normalizeDirection(params["direction"]),
      };
      dispatch(split ? "splitEditorSurface" : "createEditorSurface", payload);
      return "OK";
    },
    "editor.split": (params) => {
      dispatch("splitEditorSurface", {
        path: params["path"] as string | undefined,
        cwd: params["cwd"] as string | undefined,
        create: params["create"] === true || params["create"] === "true",
        direction: normalizeDirection(params["direction"]),
      });
      return "OK";
    },
    "editor.list": () => {
      return getState().workspaces.flatMap((ws) =>
        ws.surfaceIds
          .filter((id) => ws.surfaceTypes?.[id] === "editor" || id.startsWith("editor:"))
          .map((id) => ({
            id,
            workspaceId: ws.id,
            workspace: ws.name,
            path: ws.surfaceEditorFiles?.[id] ?? null,
            focused: ws.focusedSurfaceId === id,
          })),
      );
    },
    "editor.save": (params) => {
      const id = (params["surface_id"] ?? params["surfaceId"] ?? params["id"] ?? getState().focusedSurfaceId) as string | null;
      if (!isEditorId(id)) throw new Error("editor surface id required");
      dispatch("editorSave", { surfaceId: id });
      return "OK";
    },
    "editor.reload": (params) => {
      const id = (params["surface_id"] ?? params["surfaceId"] ?? params["id"] ?? getState().focusedSurfaceId) as string | null;
      if (!isEditorId(id)) throw new Error("editor surface id required");
      dispatch("editorReload", { surfaceId: id });
      return "OK";
    },
    "editor.close": (params) => {
      const id = (params["surface_id"] ?? params["surfaceId"] ?? params["id"] ?? getState().focusedSurfaceId) as string | null;
      if (!isEditorId(id)) throw new Error("editor surface id required");
      dispatch("closeSurface", { surfaceId: id });
      return "OK";
    },
  };
}
