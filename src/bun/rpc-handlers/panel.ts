import type { Handler, HandlerDeps } from "./types";
import { resolveSurfaceId } from "./shared";

/** panel.* handlers: observe sideband-created overlays per surface.
 *  Drives e2e tests that need to assert "a panel of type X was created"
 *  without round-tripping through the webview. */
export function registerPanel(deps: HandlerDeps): Record<string, Handler> {
  const { getState, panelRegistry } = deps;

  return {
    "panel.list": (params) => {
      const id = resolveSurfaceId(params, getState().focusedSurfaceId);
      if (!id || !panelRegistry) return [];
      return panelRegistry.list(id);
    },
  };
}
