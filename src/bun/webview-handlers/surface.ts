import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys =
  | "createSurface"
  | "splitSurface"
  | "closeSurface"
  | "renameSurface"
  | "panelEvent"
  | "runScript";

/** PTY surface lifecycle + the polymorphic close handler that routes to
 *  the right resource owner (agent, browser, telegram/editor, pty). */
export function registerSurfaceWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  return {
    createSurface: (payload) => {
      ctx.createWorkspaceSurface(80, 24, payload.cwd);
    },
    splitSurface: (payload) => {
      ctx.splitSurface(payload.direction, undefined, payload.cwd);
    },
    closeSurface: (payload) => {
      // Pending cookie-injection debounce is now cleared in the
      // `browserSurfaces.onSurfaceClosed` callback, which catches every
      // browser-close path (RPC, menu, accessory). Non-browser surfaces
      // never appear in `domReadyDebounce`, so no cleanup needed here.
      if (ctx.piAgentManager.isAgentSurface(payload.surfaceId)) {
        ctx.piAgentManager.removeAgent(payload.surfaceId);
        ctx.sendWebviewAction("agentSurfaceClosed", {
          surfaceId: payload.surfaceId,
        });
      } else if (ctx.browserSurfaces.isBrowserSurface(payload.surfaceId)) {
        ctx.browserSurfaces.closeSurface(payload.surfaceId);
      } else if (
        payload.surfaceId.startsWith("tg:") ||
        payload.surfaceId.startsWith("editor:")
      ) {
        // Non-PTY panes have no bun-side resource; echo the close back so
        // the webview layout removes the pane.
        ctx.rpc.send("surfaceClosed", { surfaceId: payload.surfaceId });
        ctx.app.webServer?.broadcast({
          type: "surfaceClosed",
          surfaceId: payload.surfaceId,
        });
      } else {
        ctx.sessions.closeSurface(payload.surfaceId);
      }
    },
    renameSurface: (payload) => {
      ctx.dispatch("renameSurface", {
        surfaceId: payload.surfaceId,
        title: payload.title,
      });
    },
    panelEvent: (payload) => {
      ctx.sessions.sendEvent(payload.surfaceId, payload);
      // Broadcast panel position/size changes to web clients
      if (payload.event === "dragend") {
        ctx.app.webServer?.broadcast({
          type: "panelEvent",
          surfaceId: payload.surfaceId,
          id: payload.id,
          event: payload.event,
          x: payload.x,
          y: payload.y,
        });
      } else if (payload.event === "resize") {
        ctx.app.webServer?.broadcast({
          type: "panelEvent",
          surfaceId: payload.surfaceId,
          id: payload.id,
          event: payload.event,
          width: payload.width,
          height: payload.height,
        });
      } else if (payload.event === "close") {
        ctx.app.webServer?.broadcast({
          type: "panelEvent",
          surfaceId: payload.surfaceId,
          id: payload.id,
          event: payload.event,
        });
      }
    },
    runScript: (payload) => {
      const { workspaceId, cwd, command, scriptKey } = payload;
      if (!workspaceId || !cwd || !command || !scriptKey) return;
      const surfaceId = ctx.sessions.createSurface(80, 24, cwd);
      const title = ctx.sessions.getSurface(surfaceId)?.title ?? "shell";
      ctx.rpc.send("surfaceCreated", {
        surfaceId,
        title,
        launchFor: { workspaceId, scriptKey },
      });
      ctx.broadcastSurfaceCreated(surfaceId, title);
      // Small delay so the login shell's prompt is ready before we feed
      // the script command. zsh emits ~150ms of async init (completion
      // cache, etc.) on a fresh pty; 600 ms is a safe upper bound.
      setTimeout(() => {
        ctx.sessions.writeStdin(surfaceId, command + "\n");
      }, 600);
    },
  };
}
