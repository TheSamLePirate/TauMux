import type { Handler, HandlerDeps } from "./types";
import { computeNormalizedRects } from "./shared";

export function registerPane(deps: HandlerDeps): Record<string, Handler> {
  const { getState } = deps;

  return {
    "pane.list": () => {
      const state = getState();
      const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
      if (!ws) return [];
      const rects = computeNormalizedRects(ws.layout);
      return ws.surfaceIds.map((sid) => {
        const rect = rects.get(sid);
        return {
          surface_id: sid,
          focused: sid === state.focusedSurfaceId,
          x: rect?.x ?? 0,
          y: rect?.y ?? 0,
          w: rect?.w ?? 1,
          h: rect?.h ?? 1,
        };
      });
    },
  };
}
