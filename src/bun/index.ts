import { BrowserWindow, BrowserView } from "electrobun/bun";
import type { HyperTermRPC } from "../shared/types";
import { SessionManager } from "./session-manager";
import { SocketServer } from "./socket-server";
import { WebServer } from "./web-server";
import {
  createRpcHandler,
  type AppState,
  type WorkspaceSnapshot,
} from "./rpc-handler";

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
          const surfaceId = sessions.createSurface(payload.cols, payload.rows);
          focusedSurfaceId = surfaceId;
          const title = sessions.getSurface(surfaceId)?.title ?? "shell";
          rpc.send("surfaceCreated", { surfaceId, title });
          broadcastSurfaceCreated(surfaceId, title);
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
        const surfaceId = sessions.createSurface(80, 24, payload.cwd);
        const title = sessions.getSurface(surfaceId)?.title ?? "shell";
        rpc.send("surfaceCreated", { surfaceId, title });
        broadcastSurfaceCreated(surfaceId, title);
      },
      splitSurface: (payload) => {
        const surfaceId = sessions.createSurface(80, 24);
        const title = sessions.getSurface(surfaceId)?.title ?? "shell";
        rpc.send("surfaceCreated", {
          surfaceId,
          title,
          splitFrom: focusedSurfaceId ?? undefined,
          direction: payload.direction,
        });
        broadcastSurfaceCreated(surfaceId, title);
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
      },
      clearNotifications: () => {
        socketHandler("notification.clear", {});
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
  url: "views://terminal/index.html",
  frame: {
    width: 1200,
    height: 800,
    x: 100,
    y: 100,
  },
  rpc,
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
    const surfaceId = sessions.createSurface(
      80,
      24,
      payload["cwd"] as string | undefined,
    );
    const title = sessions.getSurface(surfaceId)?.title ?? "shell";
    rpc.send("surfaceCreated", { surfaceId, title });
    broadcastSurfaceCreated(surfaceId, title);
  } else if (action === "splitSurface") {
    const surfaceId = sessions.createSurface(80, 24);
    const title = sessions.getSurface(surfaceId)?.title ?? "shell";
    rpc.send("surfaceCreated", {
      surfaceId,
      title,
      splitFrom: focusedSurfaceId ?? undefined,
      direction: payload["direction"] as "horizontal" | "vertical",
    });
    broadcastSurfaceCreated(surfaceId, title);
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
