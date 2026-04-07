import {
  ApplicationMenu,
  BrowserWindow,
  BrowserView,
  ContextMenu,
  Utils,
} from "electrobun/bun";
import { fileURLToPath } from "node:url";
import type { HyperTermRPC } from "../shared/types";
import { SessionManager } from "./session-manager";
import { SocketServer } from "./socket-server";
import { WebServer } from "./web-server";
import {
  createRpcHandler,
  type AppState,
  type WorkspaceSnapshot,
} from "./rpc-handler";
import {
  buildApplicationMenu,
  buildContextMenu,
  ELECTROBUN_DOCS_URL,
  formatWindowTitle,
  MENU_ACTIONS,
} from "./native-menus";

const sessions = new SessionManager();
let initialResizeReceived = false;

let focusedSurfaceId: string | null = null;

// Workspace state synced from webview

let workspaceState: WorkspaceSnapshot[] = [];

let activeWorkspaceId: string | null = null;

function getAppState(): AppState {
  return {
    focusedSurfaceId,
    workspaces: workspaceState,
    activeWorkspaceId,
  };
}

// Define RPC handlers
const rpc = BrowserView.defineRPC<HyperTermRPC>({
  handlers: {
    messages: {
      writeStdin: (payload) => {
        sessions.writeStdin(payload.surfaceId, payload.data);
      },
      resize: (payload) => {
        if (!initialResizeReceived) {
          initialResizeReceived = true;
          createWorkspaceSurface(payload.cols, payload.rows);
        } else {
          sessions.resize(payload.surfaceId, payload.cols, payload.rows);
          webServer?.broadcast({
            type: "resize",
            surfaceId: payload.surfaceId,
            cols: payload.cols,
            rows: payload.rows,
          });
        }
      },
      createSurface: (payload) => {
        createWorkspaceSurface(80, 24, payload.cwd);
      },
      splitSurface: (payload) => {
        splitSurface(payload.direction);
      },
      closeSurface: (payload) => {
        sessions.closeSurface(payload.surfaceId);
      },
      focusSurface: (payload) => {
        focusedSurfaceId = payload.surfaceId;
        webServer?.broadcast({
          type: "focusChanged",
          surfaceId: payload.surfaceId,
        });
      },
      panelEvent: (payload) => {
        sessions.sendEvent(payload.surfaceId, payload);
        // Broadcast panel position/size changes to web clients
        if (
          payload.event === "dragend" ||
          payload.event === "resize" ||
          payload.event === "close"
        ) {
          webServer?.broadcast({
            type: "panelEvent",
            surfaceId: payload.surfaceId,
            id: payload.id,
            event: payload.event,
            x: payload.x,
            y: payload.y,
            width: payload.width,
            height: payload.height,
          });
        }
      },
      readScreenResponse: (payload) => {
        const resolve = pendingReads.get(payload.reqId);
        if (resolve) {
          pendingReads.delete(payload.reqId);
          resolve(payload.content);
        }
      },
      workspaceStateSync: (payload) => {
        workspaceState = payload.workspaces;
        activeWorkspaceId = payload.activeWorkspaceId;
        const activeWorkspace =
          payload.workspaces.find((ws) => ws.id === payload.activeWorkspaceId) ??
          null;
        mainWindow.setTitle(formatWindowTitle(activeWorkspace?.name ?? null));
      },
      clearNotifications: () => {
        socketHandler("notification.clear", {});
      },
      showContextMenu: (payload) => {
        ContextMenu.showContextMenu(buildContextMenu(payload));
      },
      toggleWebServer: () => {
        toggleWebServer();
      },
      toggleMaximize: () => {
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize();
        } else {
          mainWindow.maximize();
        }
      },
    },
  },
});

// Create the main window
const mainWindow = new BrowserWindow({
  title: "HyperTerm Canvas",
  titleBarStyle: "hiddenInset",
  transparent: true,
  styleMask: {
    UnifiedTitleAndToolbar: false,
  },
  url: "views://terminal/index.html",
  frame: {
    width: 1200,
    height: 800,
    x: 100,
    y: 100,
  },
  rpc,
});

ApplicationMenu.setApplicationMenu(buildApplicationMenu());

ApplicationMenu.on("application-menu-clicked", (event) => {
  handleMenuAction((event as { data: { action: string; data?: unknown } }).data);
});

ContextMenu.on("context-menu-clicked", (event) => {
  handleMenuAction((event as { data: { action: string; data?: unknown } }).data);
});

// Wire session callbacks → RPC → webview + web mirror
sessions.onStdout = (surfaceId, data) => {
  rpc.send("writeStdout", { surfaceId, data });
  webServer?.broadcastStdout(surfaceId, data);
};

sessions.onSidebandMeta = (surfaceId, msg) => {
  rpc.send("sidebandMeta", { ...msg, surfaceId });
  webServer?.broadcast({ type: "sidebandMeta", surfaceId, meta: msg });
};

sessions.onSidebandData = (surfaceId, id, data) => {
  const base64 = Buffer.from(data).toString("base64");
  rpc.send("sidebandData", { surfaceId, id, data: base64 });
  webServer?.broadcast({ type: "sidebandData", surfaceId, id, data: base64 });
};

sessions.onSurfaceClosed = (surfaceId) => {
  rpc.send("surfaceClosed", { surfaceId });
  webServer?.broadcast({ type: "surfaceClosed", surfaceId });
  if (sessions.surfaceCount === 0) {
    mainWindow.close();
  }
};

// ── Web Mirror ──

const webServerPort = parseInt(process.env["HYPERTERM_WEB_PORT"] ?? "3000", 10);
let webServer: WebServer | null = null;

function broadcastSurfaceCreated(surfaceId: string, title: string): void {
  webServer?.broadcast({ type: "surfaceCreated", surfaceId, title });
}

function sendWebviewAction(
  action: string,
  payload: Record<string, unknown> = {},
): void {
  rpc.send("socketAction", { action, payload });
}

function createWorkspaceSurface(
  cols: number,
  rows: number,
  cwd?: string,
): void {
  const surfaceId = sessions.createSurface(cols, rows, cwd);
  const title = sessions.getSurface(surfaceId)?.title ?? "shell";
  focusedSurfaceId = surfaceId;
  rpc.send("surfaceCreated", { surfaceId, title });
  broadcastSurfaceCreated(surfaceId, title);
}

function splitSurface(
  direction: "horizontal" | "vertical",
  splitFrom = focusedSurfaceId,
): void {
  if (!splitFrom) {
    createWorkspaceSurface(80, 24);
    return;
  }

  sendWebviewAction("focusSurface", { surfaceId: splitFrom });

  const surfaceId = sessions.createSurface(80, 24);
  const title = sessions.getSurface(surfaceId)?.title ?? "shell";
  focusedSurfaceId = surfaceId;
  rpc.send("surfaceCreated", {
    surfaceId,
    title,
    splitFrom,
    direction,
  });
  broadcastSurfaceCreated(surfaceId, title);
}

function renameActiveWorkspace(): void {
  const activeWorkspace =
    workspaceState.find((ws) => ws.id === activeWorkspaceId) ?? null;
  if (!activeWorkspace) return;
  sendWebviewAction("promptRenameWorkspace", {
    workspaceId: activeWorkspace.id,
    name: activeWorkspace.name,
  });
}

function renameSurface(surfaceId: string | null): void {
  if (!surfaceId) return;
  sendWebviewAction("promptRenameSurface", {
    surfaceId,
  });
}

function handleMenuAction(event: { action: string; data?: unknown }): void {
  const { action, data } = event;

  switch (action) {
    case MENU_ACTIONS.newWorkspace:
      createWorkspaceSurface(80, 24);
      break;
    case MENU_ACTIONS.splitRight:
      splitSurface("horizontal", (data as { surfaceId?: string })?.surfaceId);
      break;
    case MENU_ACTIONS.splitDown:
      splitSurface("vertical", (data as { surfaceId?: string })?.surfaceId);
      break;
    case MENU_ACTIONS.closePane: {
      const surfaceId =
        (data as { surfaceId?: string })?.surfaceId ?? focusedSurfaceId;
      if (surfaceId) sessions.closeSurface(surfaceId);
      break;
    }
    case MENU_ACTIONS.renameWorkspace: {
      const workspaceData = data as { workspaceId?: string; name?: string };
      if (workspaceData?.workspaceId) {
        sendWebviewAction("promptRenameWorkspace", {
          workspaceId: workspaceData.workspaceId,
          name: workspaceData.name ?? "Workspace",
        });
      } else {
        renameActiveWorkspace();
      }
      break;
    }
    case MENU_ACTIONS.renamePane: {
      const surfaceData = data as { surfaceId?: string; title?: string };
      if (surfaceData?.surfaceId) {
        sendWebviewAction("promptRenameSurface", {
          surfaceId: surfaceData.surfaceId,
          title: surfaceData.title ?? surfaceData.surfaceId,
        });
      } else {
        renameSurface(focusedSurfaceId);
      }
      break;
    }
    case MENU_ACTIONS.closeWorkspace: {
      const workspaceId = (data as { workspaceId?: string })?.workspaceId;
      if (workspaceId) {
        sendWebviewAction("closeWorkspace", { workspaceId });
      }
      break;
    }
    case MENU_ACTIONS.setWorkspaceColor: {
      const colorData = data as { workspaceId?: string; color?: string };
      if (colorData?.workspaceId && colorData?.color) {
        sendWebviewAction("setWorkspaceColor", colorData);
      }
      break;
    }
    case MENU_ACTIONS.toggleSidebar:
      sendWebviewAction("toggleSidebar");
      break;
    case MENU_ACTIONS.toggleCommandPalette:
      sendWebviewAction("toggleCommandPalette");
      break;
    case MENU_ACTIONS.nextWorkspace:
      sendWebviewAction("nextWorkspace");
      break;
    case MENU_ACTIONS.prevWorkspace:
      sendWebviewAction("prevWorkspace");
      break;
    case MENU_ACTIONS.toggleWebMirror:
      toggleWebServer();
      break;
    case MENU_ACTIONS.copySelection:
      sendWebviewAction("copySelection");
      break;
    case MENU_ACTIONS.pasteClipboard:
      sendWebviewAction("pasteClipboard");
      break;
    case MENU_ACTIONS.selectAll:
      sendWebviewAction("selectAll");
      break;
    case MENU_ACTIONS.openElectrobunDocs:
      Utils.openExternal(ELECTROBUN_DOCS_URL);
      break;
    case MENU_ACTIONS.openProjectReadme:
      Utils.openPath(fileURLToPath(new URL("../../README.md", import.meta.url)));
      break;
  }
}

function toggleWebServer(): void {
  if (webServer?.running) {
    webServer.stop();
  } else {
    if (!webServer) {
      webServer = new WebServer(
        webServerPort,
        sessions,
        getAppState,
        () => focusedSurfaceId,
      );
    }
    webServer.start();
  }
}

// ── Socket API ──

function dispatch(action: string, payload: Record<string, unknown>) {
  // Route socket-initiated actions to webview
  rpc.send("socketAction", { action, payload });

  // Some actions also need bun-side handling
  if (action === "createSurface") {
    createWorkspaceSurface(80, 24, payload["cwd"] as string | undefined);
  } else if (action === "splitSurface") {
    splitSurface(payload["direction"] as "horizontal" | "vertical");
  }
}

// Read-screen uses a message roundtrip (more reliable than RPC request-response)
const pendingReads = new Map<string, (value: string) => void>();

async function requestWebview(
  _method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const reqId = `read_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return new Promise<string>((resolve) => {
    pendingReads.set(reqId, resolve);
    rpc.send("socketAction", {
      action: "readScreen",
      payload: { ...params, reqId },
    });
    // Timeout after 3s
    setTimeout(() => {
      if (pendingReads.has(reqId)) {
        pendingReads.delete(reqId);
        resolve("");
      }
    }, 3000);
  });
}

const socketHandler = createRpcHandler(
  sessions,
  getAppState,
  dispatch,
  requestWebview,
);
const socketServer = new SocketServer("/tmp/hyperterm.sock", socketHandler);
socketServer.start();

// Auto-start web mirror server
if (webServerPort > 0) {
  webServer = new WebServer(
    webServerPort,
    sessions,
    getAppState,
    () => focusedSurfaceId,
  );
  webServer.onPanelUpdate = (surfaceId, panelId, fields) => {
    rpc.send("sidebandMeta", {
      surfaceId,
      id: panelId,
      type: "update" as const,
      ...fields,
    });
  };
  webServer.start();
}

// Clean up on exit
process.on("SIGINT", () => {
  webServer?.stop();
  socketServer.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  webServer?.stop();
  socketServer.stop();
  process.exit(0);
});
