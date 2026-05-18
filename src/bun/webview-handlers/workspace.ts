import { formatWindowTitle } from "../native-menus";
import { listSidebarFileExplorerDirectory } from "../sidebar-file-explorer";
import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys = "workspaceStateSync" | "sidebarToggle" | "sidebarFileExplorerList";

/** Workspace state sync from the webview (the webview is the source of
 *  truth for layout), plus the sidebar visibility + file-explorer
 *  listing surfaces that are anchored to the workspace shell. */
export function registerWorkspaceWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  return {
    workspaceStateSync: (payload) => {
      ctx.app.workspaceState = payload.workspaces;
      ctx.app.activeWorkspaceId = payload.activeWorkspaceId;
      const activeWorkspace =
        payload.workspaces.find((ws) => ws.id === payload.activeWorkspaceId) ??
        null;
      ctx.mainWindow.setTitle(formatWindowTitle(activeWorkspace?.name ?? null));
      ctx.app.webServer?.broadcast({
        type: "layoutChanged",
        workspaces: payload.workspaces.map((ws) => ({
          id: ws.id,
          name: ws.name,
          color: ws.color,
          surfaceIds: ws.surfaceIds,
          focusedSurfaceId: ws.focusedSurfaceId,
          layout: ws.layout,
          surfaceTitles: ws.surfaceTitles,
        })),
        activeWorkspaceId: payload.activeWorkspaceId,
        focusedSurfaceId: ctx.app.focusedSurfaceId,
      });
      ctx.scheduleLayoutSave();
    },
    sidebarToggle: (payload) => {
      ctx.app.sidebarVisible = payload.visible;
      ctx.app.webServer?.broadcast({
        type: "sidebarState",
        visible: payload.visible,
      });
    },
    sidebarFileExplorerList: (payload) => {
      const listing = listSidebarFileExplorerDirectory(payload);
      ctx.rpc.send("sidebarFileExplorerListing", listing);
    },
  };
}
