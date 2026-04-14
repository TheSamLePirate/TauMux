import {
  ApplicationMenu,
  BrowserWindow,
  BrowserView,
  ContextMenu,
  Utils,
} from "electrobun/bun";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import type { HyperTermRPC, PersistedLayout, PaneNode } from "../shared/types";
import { SessionManager } from "./session-manager";
import { SocketServer } from "./socket-server";
import { SurfaceMetadataPoller } from "./surface-metadata";
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
import { normalizeMenuActionEvent } from "./menu-events";
import { SettingsManager } from "./settings-manager";

const configDir = join(Utils.paths.config, "hyperterm-canvas");
const settingsFile = join(configDir, "settings.json");
const settingsManager = new SettingsManager(configDir, settingsFile);

const sessions = new SessionManager(settingsManager.get().shellPath);
const metadataPoller = new SurfaceMetadataPoller(sessions);
let initialResizeReceived = false;

let focusedSurfaceId: string | null = null;

// Workspace state synced from webview

let workspaceState: WorkspaceSnapshot[] = [];

let activeWorkspaceId: string | null = null;
let sidebarVisible = true;

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
      clipboardWrite: (payload) => {
        try {
          Utils.clipboardWriteText(payload.text);
        } catch {
          const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" });
          proc.stdin.write(payload.text);
          proc.stdin.end();
        }
      },
      clipboardPaste: (payload) => {
        focusedSurfaceId = payload.surfaceId;
        void handlePaste();
      },
      writeStdin: (payload) => {
        sessions.writeStdin(payload.surfaceId, payload.data);
      },
      viewportSize: (payload) => {
        webServer?.setNativeViewport(payload.width, payload.height);
      },
      resize: (payload) => {
        if (!initialResizeReceived) {
          initialResizeReceived = true;
          // Send settings now that the webview is ready
          rpc.send("restoreSettings", { settings: settingsManager.get() });
          // Re-send the web-mirror status — the boot-time send at module
          // load happens before the webview has registered RPC handlers,
          // so the sidebar dot was stuck on "Offline" (its CSS default)
          // even when auto-start had brought the server up.
          sendWebServerStatus();
          if (!tryRestoreLayout(payload.cols, payload.rows)) {
            createWorkspaceSurface(payload.cols, payload.rows);
          }
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
        splitSurface(payload.direction, undefined, payload.cwd);
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
      renameSurface: (payload) => {
        dispatch("renameSurface", {
          surfaceId: payload.surfaceId,
          title: payload.title,
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
          payload.workspaces.find(
            (ws) => ws.id === payload.activeWorkspaceId,
          ) ?? null;
        mainWindow.setTitle(formatWindowTitle(activeWorkspace?.name ?? null));
        webServer?.broadcast({
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
          focusedSurfaceId,
        });
        scheduleLayoutSave();
      },
      sidebarToggle: (payload) => {
        sidebarVisible = payload.visible;
        webServer?.broadcast({
          type: "sidebarState",
          visible: payload.visible,
        });
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
      updateSettings: (payload) => {
        const previous = settingsManager.get();
        const updated = settingsManager.update(payload.settings);
        if (updated.shellPath !== previous.shellPath) {
          sessions.setShell(updated.shellPath);
        }
        if (updated.webMirrorPort !== previous.webMirrorPort) {
          applyWebMirrorPort(updated.webMirrorPort);
        }
        rpc.send("settingsChanged", { settings: updated });
      },
      openExternal: (payload) => {
        // Only pass through http(s) and localhost-ish URLs from the webview;
        // protects against accidentally opening file:// or javascript: URLs
        // from hostile script output reaching the chip render path.
        const url = payload.url;
        if (!/^https?:\/\//i.test(url)) return;
        try {
          Utils.openExternal(url);
        } catch (err) {
          console.error("[openExternal] failed:", err);
        }
      },
      windowVisibility: (payload) => {
        // Slow down metadata polling while the window is hidden — still
        // useful (ht CLI + web mirror clients may be live) but not critical.
        metadataPoller.setPollRate(payload.visible ? 1000 : 3000);
      },
      killPid: (payload) => {
        const pid = Number(payload.pid);
        if (!Number.isFinite(pid) || pid <= 0) return;
        const raw = payload.signal || "SIGTERM";
        const signal = (
          raw.startsWith("SIG") ? raw : `SIG${raw}`
        ) as NodeJS.Signals;
        try {
          process.kill(pid, signal);
        } catch (err) {
          console.error(`[killPid ${pid} ${signal}]`, err);
        }
      },
      runScript: (payload) => {
        const { workspaceId, cwd, command, scriptKey } = payload;
        if (!workspaceId || !cwd || !command || !scriptKey) return;
        const surfaceId = sessions.createSurface(80, 24, cwd);
        const title = sessions.getSurface(surfaceId)?.title ?? "shell";
        rpc.send("surfaceCreated", {
          surfaceId,
          title,
          launchFor: { workspaceId, scriptKey },
        });
        broadcastSurfaceCreated(surfaceId, title);
        // Small delay so the login shell's prompt is ready before we feed
        // the script command. zsh emits ~150ms of async init (completion
        // cache, etc.) on a fresh pty; 600 ms is a safe upper bound.
        setTimeout(() => {
          sessions.writeStdin(surfaceId, command + "\n");
        }, 600);
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
  const menuEvent = normalizeMenuActionEvent(event);
  if (menuEvent) handleMenuAction(menuEvent);
});

ContextMenu.on("context-menu-clicked", (event) => {
  const menuEvent = normalizeMenuActionEvent(event);
  if (menuEvent) handleMenuAction(menuEvent);
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
  // Native webview: base64 over Electrobun RPC (JSON transport requires it)
  const base64 = Buffer.from(data).toString("base64");
  rpc.send("sidebandData", { surfaceId, id, data: base64 });
  // Web mirror: native binary WebSocket frames (zero base64 overhead)
  webServer?.broadcastSidebandBinary(surfaceId, id, data);
};

sessions.onSidebandDataFailed = (surfaceId, id, reason) => {
  rpc.send("sidebandDataFailed", { surfaceId, id, reason });
  webServer?.broadcast({ type: "sidebandDataFailed", surfaceId, id, reason });
};

sessions.onSurfaceClosed = (surfaceId) => {
  rpc.send("surfaceClosed", { surfaceId });
  webServer?.broadcast({ type: "surfaceClosed", surfaceId });
  if (sessions.surfaceCount === 0) {
    mainWindow.close();
  }
};

sessions.onSurfaceExit = (surfaceId, exitCode) => {
  rpc.send("surfaceExited", { surfaceId, exitCode });
  webServer?.broadcast({ type: "surfaceExited", surfaceId, exitCode });
};

metadataPoller.onMetadata = (surfaceId, metadata) => {
  rpc.send("surfaceMetadata", { surfaceId, metadata });
  webServer?.broadcast({ type: "surfaceMetadata", surfaceId, metadata });
};
metadataPoller.start();

// ── Web Mirror ──

// Env var HYPERTERM_WEB_PORT overrides the user setting so the dev/test
// workflow (custom port via env) keeps working.
const webServerPortEnv = process.env["HYPERTERM_WEB_PORT"];
let webServerPort = webServerPortEnv
  ? parseInt(webServerPortEnv, 10)
  : settingsManager.get().webMirrorPort;
let webServer: WebServer | null = null;

function broadcastSurfaceCreated(surfaceId: string, title: string): void {
  webServer?.broadcast({ type: "surfaceCreated", surfaceId, title });
}

function broadcastSurfaceRenamed(surfaceId: string, title: string): void {
  webServer?.broadcast({ type: "surfaceRenamed", surfaceId, title });
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
  cwdOverride?: string,
): void {
  if (!splitFrom) {
    createWorkspaceSurface(80, 24, cwdOverride);
    return;
  }

  sendWebviewAction("focusSurface", { surfaceId: splitFrom });

  // New pane's cwd: the webview's pinned workspace cwd wins (passed by the
  // RPC), otherwise inherit the splitFrom pane's live cwd from the metadata
  // poller so the shell opens in the same directory the user is already in.
  const cwd =
    cwdOverride ?? metadataPoller.getSnapshot(splitFrom)?.cwd ?? undefined;
  const surfaceId = sessions.createSurface(80, 24, cwd);
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
    case MENU_ACTIONS.toggleProcessManager:
      sendWebviewAction("toggleProcessManager");
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
      handlePaste();
      break;
    case MENU_ACTIONS.selectAll:
      sendWebviewAction("selectAll");
      break;
    case MENU_ACTIONS.openElectrobunDocs:
      Utils.openExternal(ELECTROBUN_DOCS_URL);
      break;
    case MENU_ACTIONS.openSettings:
      sendWebviewAction("openSettings");
      break;
    case MENU_ACTIONS.openProjectReadme:
      Utils.openPath(
        fileURLToPath(new URL("../../README.md", import.meta.url)),
      );
      break;
    case MENU_ACTIONS.installHtCli:
      void installHtCli();
      break;
  }
}

function toast(
  message: string,
  level: "info" | "success" | "warning" | "error" = "info",
): void {
  sendWebviewAction("showToast", { message, level });
}

function resolveBundledHtBinary(): string {
  // process.execPath inside the wrapped app points at Contents/MacOS/<launcher>
  // dirname(dirname(...)) → Contents/
  return join(dirname(dirname(process.execPath)), "MacOS", "ht");
}

async function installHtCli(): Promise<void> {
  const bundled = resolveBundledHtBinary();
  const target = "/usr/local/bin/ht";

  if (!existsSync(bundled)) {
    toast(
      `ht CLI binary not found at ${bundled}. Build a packaged release first.`,
      "error",
    );
    return;
  }

  // Already installed and pointing at us? No-op.
  try {
    const current = readlinkSync(target);
    if (current === bundled) {
      toast("ht CLI is already installed.", "info");
      return;
    }
  } catch {
    // Not a symlink (or missing) — fall through to install.
  }

  // Fast path: try ln -sf directly (works if /usr/local/bin exists and is writable).
  const plain = Bun.spawnSync(["/bin/ln", "-sf", bundled, target]);
  if (plain.exitCode === 0) {
    toast(`Installed ht → ${target}`, "success");
    return;
  }

  // Fallback: request administrator privileges via osascript.
  const quoted = bundled.replaceAll('"', '\\"');
  const shellCmd = `mkdir -p /usr/local/bin && ln -sf \\"${quoted}\\" /usr/local/bin/ht`;
  const appleScript = `do shell script "${shellCmd}" with administrator privileges`;
  const sudo = Bun.spawnSync(["/usr/bin/osascript", "-e", appleScript], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (sudo.exitCode === 0) {
    toast(`Installed ht → ${target}`, "success");
    return;
  }

  const stderr = new TextDecoder().decode(sudo.stderr).trim();
  if (/User canceled|cancelled|(-128)/i.test(stderr)) {
    toast("ht CLI installation cancelled.", "warning");
    return;
  }
  toast(`Failed to install ht CLI${stderr ? `: ${stderr}` : ""}`, "error");
}

async function handlePaste(): Promise<void> {
  const surfaceId = focusedSurfaceId;
  if (!surfaceId) return;

  let text: string | null = null;
  try {
    text = Utils.clipboardReadText();
  } catch {
    // Native FFI may not be available
  }
  if (text === null || text === undefined) {
    try {
      const proc = Bun.spawn(["pbpaste"], { stdout: "pipe" });
      text = await new Response(proc.stdout).text();
    } catch {
      /* ignore */
    }
  }
  if (text) {
    sessions.writeStdin(surfaceId, text);
  }
}

function sendWebServerStatus(): void {
  const running = webServer?.running ?? false;
  rpc.send("webServerStatus", {
    running,
    port: webServerPort,
    url: running ? `http://localhost:${webServerPort}` : undefined,
  });
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
        () => sidebarVisible,
      );
      setupWebServerCallbacks(webServer);
    }
    webServer.start();
  }
  sendWebServerStatus();
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
  } else if (action === "renameSurface") {
    const surfaceId = payload["surfaceId"];
    const title = payload["title"];
    if (typeof surfaceId === "string" && typeof title === "string" && title) {
      sessions.renameSurface(surfaceId, title);
      const workspace = workspaceState.find((ws) =>
        ws.surfaceIds.includes(surfaceId),
      );
      if (workspace) {
        workspace.surfaceTitles = {
          ...(workspace.surfaceTitles ?? {}),
          [surfaceId]: title,
        };
      }
      scheduleLayoutSave();
      broadcastSurfaceRenamed(surfaceId, title);
    }
  } else if (action === "notification") {
    // Broadcast notification to web clients
    const notifications = payload["notifications"] as unknown[];
    const latest = payload["latest"] as Record<string, unknown> | undefined;
    if (latest) {
      webServer?.broadcast({
        type: "notification",
        surfaceId: latest["surfaceId"] ?? null,
        title: latest["title"] ?? "",
        body: latest["body"] ?? "",
      });
    } else if (notifications && notifications.length === 0) {
      webServer?.broadcast({ type: "notificationClear" });
    }
  } else if (
    action === "setStatus" ||
    action === "clearStatus" ||
    action === "setProgress" ||
    action === "clearProgress" ||
    action === "log"
  ) {
    webServer?.broadcast({ type: "sidebarAction", action, payload });
  } else if (action === "openExternal") {
    const url = payload["url"];
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      try {
        Utils.openExternal(url);
      } catch (err) {
        console.error("[openExternal] failed:", err);
      }
    }
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
  metadataPoller,
);
const socketServer = new SocketServer("/tmp/hyperterm.sock", socketHandler);
socketServer.start();

// Auto-start web mirror server
function setupWebServerCallbacks(ws: WebServer) {
  ws.onPanelUpdate = (surfaceId, panelId, fields) => {
    rpc.send("sidebandMeta", {
      surfaceId,
      id: panelId,
      type: "update" as const,
      ...fields,
    });
  };
  ws.onSidebarToggle = (visible) => {
    sidebarVisible = visible;
    // Forward to native webview (set-state, not toggle)
    rpc.send("socketAction", {
      action: "setSidebar",
      payload: { visible },
    });
  };
  ws.onFocusSurface = (surfaceId) => {
    focusedSurfaceId = surfaceId;
    // Tell native webview to focus this surface
    sendWebviewAction("focusSurface", { surfaceId });
    // Broadcast to all web clients
    ws.broadcast({ type: "focusChanged", surfaceId });
  };
  ws.onClearNotifications = () => {
    // Clear via the RPC handler which dispatches to native + broadcasts
    socketHandler("notification.clear", {});
  };
}

// Env var (if set) implies explicit opt-in; otherwise honor the user setting.
const autoStartWebMirror = webServerPortEnv
  ? webServerPort > 0
  : settingsManager.get().autoStartWebMirror && webServerPort > 0;

if (autoStartWebMirror) {
  webServer = new WebServer(
    webServerPort,
    sessions,
    getAppState,
    () => focusedSurfaceId,
    () => sidebarVisible,
  );
  setupWebServerCallbacks(webServer);
  webServer.start();
}
sendWebServerStatus();

/** Rebuild the web mirror on a new port. Restarts if it was running. */
function applyWebMirrorPort(newPort: number): void {
  if (webServerPortEnv) return; // env var wins, ignore setting change
  const wasRunning = webServer?.running ?? false;
  webServer?.stop();
  webServer = null;
  webServerPort = newPort;
  if (wasRunning && newPort > 0) {
    webServer = new WebServer(
      webServerPort,
      sessions,
      getAppState,
      () => focusedSurfaceId,
      () => sidebarVisible,
    );
    setupWebServerCallbacks(webServer);
    webServer.start();
  }
  sendWebServerStatus();
}

// ── Layout Persistence ──

const layoutDir = join(Utils.paths.config, "hyperterm-canvas");
const layoutFile = join(layoutDir, "layout.json");

function saveLayout(): void {
  if (workspaceState.length === 0) return;
  try {
    const persisted: PersistedLayout = {
      activeWorkspaceIndex: workspaceState.findIndex(
        (ws) => ws.id === activeWorkspaceId,
      ),
      workspaces: workspaceState.map((ws) => ({
        name: ws.name,
        color: ws.color,
        layout: ws.layout,
        focusedSurfaceId: ws.focusedSurfaceId,
        surfaceTitles: ws.surfaceTitles,
        surfaceCwds: ws.surfaceCwds,
        selectedCwd: ws.selectedCwd,
      })),
      sidebarVisible,
    };
    if (!existsSync(layoutDir)) mkdirSync(layoutDir, { recursive: true });
    writeFileSync(layoutFile, JSON.stringify(persisted));
  } catch {
    /* ignore write failures */
  }
}

function loadLayout(): PersistedLayout | null {
  try {
    if (!existsSync(layoutFile)) return null;
    const raw = readFileSync(layoutFile, "utf-8");
    const parsed = JSON.parse(raw) as PersistedLayout;
    if (!Array.isArray(parsed.workspaces) || parsed.workspaces.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function collectLeafIds(node: PaneNode): string[] {
  if (node.type === "leaf") return [node.surfaceId];
  return [
    ...collectLeafIds(node.children[0]),
    ...collectLeafIds(node.children[1]),
  ];
}

function remapPaneNode(
  node: PaneNode,
  mapping: Record<string, string>,
): PaneNode {
  if (node.type === "leaf") {
    return {
      type: "leaf",
      surfaceId: mapping[node.surfaceId] ?? node.surfaceId,
    };
  }
  return {
    type: "split",
    direction: node.direction,
    ratio: node.ratio,
    children: [
      remapPaneNode(node.children[0], mapping),
      remapPaneNode(node.children[1], mapping),
    ],
  };
}

let layoutSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleLayoutSave(): void {
  if (layoutSaveTimer) clearTimeout(layoutSaveTimer);
  layoutSaveTimer = setTimeout(saveLayout, 500);
}

function tryRestoreLayout(cols: number, rows: number): boolean {
  const persisted = loadLayout();
  if (!persisted) return false;

  const surfaceMapping: Record<string, string> = {};

  for (const ws of persisted.workspaces) {
    const leafIds = collectLeafIds(ws.layout);
    for (const oldId of leafIds) {
      // Re-spawn in the surface's last known cwd so shells resume where they
      // left off (the metadata poller picks this up within a tick; without
      // this, every restart dumps the user at $HOME regardless of where
      // they were working).
      const cwd = ws.surfaceCwds?.[oldId];
      const newId = sessions.createSurface(cols, rows, cwd);
      surfaceMapping[oldId] = newId;
      const restoredTitle = ws.surfaceTitles?.[oldId];
      if (restoredTitle) sessions.renameSurface(newId, restoredTitle);
      const title = sessions.getSurface(newId)?.title ?? "shell";
      rpc.send("surfaceCreated", { surfaceId: newId, title });
      broadcastSurfaceCreated(newId, title);
    }
  }

  // Remap the layout trees + remap the surfaceCwds keys (old → new ids) so
  // the webview can rehydrate its selectedCwds against live surface ids, and
  // carry the user's pinned selectedCwd through untouched (path-based, not
  // surface-id based, so no remapping needed).
  const remappedLayout: PersistedLayout = {
    ...persisted,
    workspaces: persisted.workspaces.map((ws) => {
      const remappedTitles: Record<string, string> = {};
      if (ws.surfaceTitles) {
        for (const [oldId, title] of Object.entries(ws.surfaceTitles)) {
          const newId = surfaceMapping[oldId];
          if (newId) remappedTitles[newId] = title;
        }
      }
      const remappedCwds: Record<string, string> = {};
      if (ws.surfaceCwds) {
        for (const [oldId, cwd] of Object.entries(ws.surfaceCwds)) {
          const newId = surfaceMapping[oldId];
          if (newId) remappedCwds[newId] = cwd;
        }
      }
      return {
        ...ws,
        layout: remapPaneNode(ws.layout, surfaceMapping),
        focusedSurfaceId: ws.focusedSurfaceId
          ? (surfaceMapping[ws.focusedSurfaceId] ?? null)
          : null,
        surfaceTitles:
          Object.keys(remappedTitles).length > 0 ? remappedTitles : undefined,
        surfaceCwds:
          Object.keys(remappedCwds).length > 0 ? remappedCwds : undefined,
      };
    }),
  };

  // Small delay to let webview process surfaceCreated messages first
  setTimeout(() => {
    rpc.send("restoreLayout", {
      layout: remappedLayout,
      surfaceMapping,
    });
  }, 200);

  focusedSurfaceId = Object.values(surfaceMapping)[0] ?? null;
  return true;
}

// Clean up on exit
process.on("SIGINT", () => {
  saveLayout();
  settingsManager.saveNow();
  webServer?.stop();
  socketServer.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  saveLayout();
  settingsManager.saveNow();
  webServer?.stop();
  socketServer.stop();
  process.exit(0);
});
