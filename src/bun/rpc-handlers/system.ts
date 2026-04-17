import type { Handler, HandlerDeps } from "./types";
import { computeNormalizedRects } from "./shared";

const VERSION = "0.0.1";

/** system.* handlers: diagnostic + discovery RPCs.
 *  `allMethodNames` is injected by the aggregator so `system.capabilities`
 *  can report the full registered surface without this module needing
 *  access to the other domains' tables. */
export function registerSystem(
  deps: HandlerDeps,
  allMethodNames: () => string[],
): Record<string, Handler> {
  const { sessions, getState } = deps;

  return {
    "system.ping": () => "PONG",

    "system.version": () => `hyperterm-canvas ${VERSION}`,

    "system.identify": () => {
      const state = getState();
      return {
        focused_surface: state.focusedSurfaceId,
        active_workspace: state.activeWorkspaceId,
        socket_path: "/tmp/hyperterm.sock",
      };
    },

    "system.capabilities": () => ({
      protocol: "hyperterm-socket",
      version: 1,
      methods: allMethodNames().sort(),
    }),

    "system.tree": () => {
      const state = getState();
      return state.workspaces.map((ws) => {
        const rects = computeNormalizedRects(ws.layout);
        return {
          workspace: ws.id,
          name: ws.name,
          color: ws.color,
          active: ws.id === state.activeWorkspaceId,
          layout: ws.layout,
          surfaces: ws.surfaceIds.map((sid) => {
            const surface = sessions.getSurface(sid);
            const rect = rects.get(sid);
            return {
              id: sid,
              pid: surface?.pty.pid ?? null,
              title: surface?.title ?? "unknown",
              focused: sid === state.focusedSurfaceId,
              x: rect?.x ?? 0,
              y: rect?.y ?? 0,
              w: rect?.w ?? 1,
              h: rect?.h ?? 1,
            };
          }),
        };
      });
    },
  };
}
