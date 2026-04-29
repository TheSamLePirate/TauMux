import type { Handler, HandlerDeps } from "./types";
import { computeNormalizedRects } from "./shared";

const VERSION = "0.2.75";
const START_TIME_MS = Date.now();

/** system.* handlers: diagnostic + discovery RPCs.
 *  `allMethodNames` is injected by the aggregator so `system.capabilities`
 *  can report the full registered surface without this module needing
 *  access to the other domains' tables. */
export function registerSystem(
  deps: HandlerDeps,
  allMethodNames: () => string[],
): Record<string, Handler> {
  const { sessions, getState, shutdown, socketPath, logPath, health } = deps;

  return {
    // Preserves the legacy "PONG" response so existing CLI + tests keep
    // working. Accepts an optional `verbose: true` param for e2e readiness
    // probes that want pid + uptime in one roundtrip.
    "system.ping": (params) => {
      if (params?.["verbose"] === true) {
        return {
          pong: "PONG",
          pid: process.pid,
          uptimeMs: Date.now() - START_TIME_MS,
        };
      }
      return "PONG";
    },

    "system.version": () => `tau-mux ${VERSION}`,

    // Graceful exit: returns immediately with an acknowledgement, then
    // defers the actual shutdown so the client receives the RPC response
    // before the socket closes. Tests fall back to SIGTERM if this stalls.
    "system.shutdown": () => {
      if (!shutdown) throw new Error("shutdown not supported in this process");
      setTimeout(() => {
        try {
          shutdown();
        } catch {
          /* gracefulShutdown has its own watchdog */
        }
      }, 25);
      return { ok: true };
    },

    "system.identify": () => {
      const state = getState();
      return {
        focused_surface: state.focusedSurfaceId,
        active_workspace: state.activeWorkspaceId,
        socket_path: socketPath,
        log_path: logPath,
      };
    },

    "system.capabilities": () => ({
      protocol: "hyperterm-socket",
      version: 1,
      methods: allMethodNames().sort(),
    }),

    /** Aggregated subsystem health. Returns `{ ok, entries[] }`
     *  where `ok` is false if any subsystem is `degraded` or `error`
     *  (`disabled` doesn't count — see health.ts). Stub when the
     *  caller didn't wire a registry, so e2e fixtures stay slim. */
    "system.health": () => {
      if (!health) return { ok: true, entries: [] };
      return health.snapshot();
    },

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
