import type { Handler, HandlerDeps } from "./types";

function normalizeDirection(raw: unknown): "horizontal" | "vertical" {
  return raw === "down" || raw === "vertical" ? "vertical" : "horizontal";
}

function pickId(params: Record<string, unknown>): string | undefined {
  const v = params["id"] ?? params["extension_id"] ?? params["extensionId"];
  return typeof v === "string" ? v : undefined;
}

/** `extension.*` socket/CLI surface for the extension-app platform. The
 *  surface lifecycle (open/split) routes through `dispatch` into the bun
 *  action handler exactly like `editor.*`; registry mutations go straight to
 *  the `ExtensionManager`. */
export function registerExtension(deps: HandlerDeps): Record<string, Handler> {
  const { dispatch, getState, extensionManager } = deps;
  const need = () => {
    if (!extensionManager) throw new Error("extensions are not available");
    return extensionManager;
  };

  return {
    "extension.list": () => {
      const mgr = need();
      const runningByExt = new Set<string>();
      for (const ws of getState().workspaces) {
        for (const sid of ws.surfaceIds) {
          if (ws.surfaceTypes?.[sid] === "extension") {
            const extId = ws.surfaceExtensionIds?.[sid];
            if (extId) runningByExt.add(extId);
          }
        }
      }
      return mgr.list().map((d) => ({
        id: d.manifest.id,
        name: d.manifest.name,
        version: d.manifest.version,
        icon: d.manifest.icon ?? null,
        description: d.manifest.description ?? null,
        enabled: d.enabled,
        hasBuild: d.hasBuild,
        running: runningByExt.has(d.manifest.id),
        path: d.path,
      }));
    },

    "extension.templates": () => need().listTemplates(),

    "extension.open": (params) => {
      const mgr = need();
      const id = pickId(params);
      if (!id || !mgr.has(id))
        throw new Error(`unknown extension: ${id ?? ""}`);
      const split = params["split"] === true || params["split"] === "true";
      const direction = normalizeDirection(params["direction"]);
      dispatch(split ? "splitExtensionSurface" : "createExtensionSurface", {
        extensionId: id,
        direction,
      });
      return "OK";
    },

    "extension.split": (params) => {
      const mgr = need();
      const id = pickId(params);
      if (!id || !mgr.has(id))
        throw new Error(`unknown extension: ${id ?? ""}`);
      dispatch("splitExtensionSurface", {
        extensionId: id,
        direction: normalizeDirection(params["direction"]),
      });
      return "OK";
    },

    "extension.new": (params) => {
      const mgr = need();
      const id = pickId(params);
      const template = params["template"];
      if (!id) throw new Error("extension id required");
      if (typeof template !== "string" || !template)
        throw new Error("template required (see extension.templates)");
      const desc = mgr.scaffold({
        id,
        name:
          typeof params["name"] === "string"
            ? (params["name"] as string)
            : undefined,
        template,
      });
      return { id: desc.manifest.id, path: desc.path };
    },

    "extension.install": (params) => {
      const mgr = need();
      const path = params["path"];
      if (typeof path !== "string" || !path) throw new Error("path required");
      const desc = mgr.install(path);
      return { id: desc.manifest.id, path: desc.path };
    },

    "extension.remove": (params) => {
      const mgr = need();
      const id = pickId(params);
      if (!id) throw new Error("extension id required");
      mgr.remove(id);
      return "OK";
    },

    "extension.reload": () => {
      need().reload();
      return "OK";
    },

    "extension.stop": (params) => {
      const mgr = need();
      const sid = (params["surface_id"] ??
        params["surfaceId"] ??
        params["id"]) as string | undefined;
      if (!sid) throw new Error("surface id required");
      mgr.stop(sid);
      return "OK";
    },
  };
}
