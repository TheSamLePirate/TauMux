import {
  ApplicationMenu,
  BrowserWindow,
  BrowserView,
  ContextMenu,
  Utils,
} from "electrobun/bun";
// Internal Electrobun native bridge used to resize the root BrowserView and
// expose a true native window frame around the webview.
import {
  native,
  toCString,
} from "../../node_modules/electrobun/dist-macos-arm64/api/bun/proc/native";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { HyperTermRPC, PersistedLayout, PaneNode } from "../shared/types";
import { SessionManager } from "./session-manager";
import { BrowserSurfaceManager } from "./browser-surface-manager";
import { BrowserHistoryStore } from "./browser-history";
import { CookieStore } from "./cookie-store";
import {
  parseJsonCookies,
  parseNetscapeCookies,
  exportAsJson,
  exportAsNetscape,
} from "./cookie-parsers";
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
import { PiAgentManager } from "./pi-agent-manager";

const configDir = join(Utils.paths.config, "hyperterm-canvas");
const settingsFile = join(configDir, "settings.json");
const settingsManager = new SettingsManager(configDir, settingsFile);

const sessions = new SessionManager(settingsManager.get().shellPath);
const piAgentManager = new PiAgentManager();
const browserSurfaces = new BrowserSurfaceManager();
const browserHistory = new BrowserHistoryStore(configDir);
const cookieStore = new CookieStore(configDir);
const metadataPoller = new SurfaceMetadataPoller(sessions);
let initialResizeReceived = false;

let focusedSurfaceId: string | null = null;

// Workspace state synced from webview

let workspaceState: WorkspaceSnapshot[] = [];

let activeWorkspaceId: string | null = null;
let sidebarVisible = true;
const WINDOW_FRAME_INSET = 2;

function getAppState(): AppState {
  return {
    focusedSurfaceId,
    workspaces: workspaceState,
    activeWorkspaceId,
  };
}

function getPiSessionsDir(): string {
  return join(process.env["HOME"] ?? "", ".pi", "agent", "sessions");
}

function extractSessionPreview(sessionPath: string): {
  name: string | null;
  cwd: string | null;
  firstUserText: string | null;
} {
  try {
    const text = readFileSync(sessionPath, "utf8");
    const lines = text.split("\n").filter(Boolean);
    let name: string | null = null;
    let cwd: string | null = null;
    let firstUserText: string | null = null;
    for (const line of lines) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry["type"] === "session") {
        cwd = (entry["cwd"] as string) ?? null;
      }
      if (entry["type"] === "session_info") {
        name = (entry["name"] as string) ?? name;
      }
      if (entry["type"] === "message") {
        const msg = entry["message"] as Record<string, unknown> | undefined;
        if (msg?.["role"] === "user" && !firstUserText) {
          const content = msg["content"];
          if (typeof content === "string") firstUserText = content;
          else if (Array.isArray(content)) {
            firstUserText = content
              .map((part) => {
                const rec = part as Record<string, unknown>;
                return (rec["text"] as string) ?? "";
              })
              .join("");
          }
        }
      }
    }
    return { name, cwd, firstUserText };
  } catch {
    return { name: null, cwd: null, firstUserText: null };
  }
}

function listPiSessions(): Array<Record<string, unknown>> {
  const root = getPiSessionsDir();
  if (!existsSync(root)) return [];

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(full);
    }
  };
  try {
    walk(root);
  } catch {
    return [];
  }

  return files
    .map((path) => {
      const stat = statSync(path);
      const preview = extractSessionPreview(path);
      return {
        path,
        updatedAt: stat.mtimeMs,
        name: preview.name,
        cwd: preview.cwd,
        preview: preview.firstUserText,
      };
    })
    .sort((a, b) => (b["updatedAt"] as number) - (a["updatedAt"] as number))
    .slice(0, 200);
}

function readPiSessionTree(sessionPath?: string): Array<Record<string, unknown>> {
  if (!sessionPath || !existsSync(sessionPath)) return [];
  try {
    const lines = readFileSync(sessionPath, "utf8").split("\n").filter(Boolean);
    const nodes = new Map<
      string,
      {
        id: string;
        parentId: string | null;
        timestamp: string | null;
        entryType: string;
        role: string;
        text: string;
        children: string[];
      }
    >();

    for (const line of lines) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      const id = entry["id"] as string | undefined;
      if (!id) continue;
      const parentId = (entry["parentId"] as string | null) ?? null;
      const entryType = (entry["type"] as string) ?? "unknown";
      const timestamp = (entry["timestamp"] as string) ?? null;
      let role = entryType;
      let text = "";
      if (entryType === "message") {
        const msg = entry["message"] as Record<string, unknown> | undefined;
        role = (msg?.["role"] as string) ?? "message";
        const content = msg?.["content"];
        if (typeof content === "string") text = content;
        else if (Array.isArray(content)) {
          text = content
            .map((part) => {
              const rec = part as Record<string, unknown>;
              return (
                (rec["text"] as string) ??
                (rec["thinking"] as string) ??
                (rec["label"] as string) ??
                ""
              );
            })
            .join(" ");
        }
      } else if (entryType === "compaction") {
        text = (entry["summary"] as string) ?? "Compaction";
      } else if (entryType === "branch_summary") {
        text = (entry["summary"] as string) ?? "Branch summary";
      } else if (entryType === "label") {
        role = "label";
        text = (entry["label"] as string) ?? "Label";
      } else if (entryType === "session_info") {
        role = "session";
        text = (entry["name"] as string) ?? "Session info";
      }
      nodes.set(id, { id, parentId, timestamp, entryType, role, text, children: [] });
    }

    for (const node of nodes.values()) {
      if (node.parentId) nodes.get(node.parentId)?.children.push(node.id);
    }

    const roots = [...nodes.values()]
      .filter((node) => !node.parentId || !nodes.has(node.parentId))
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const activeLeaf = [...nodes.values()].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).at(-1)?.id ?? null;
    const flat: Array<Record<string, unknown>> = [];
    const visit = (id: string, depth: number) => {
      const node = nodes.get(id);
      if (!node) return;
      flat.push({
        id: node.id,
        parentId: node.parentId,
        depth,
        role: node.role,
        entryType: node.entryType,
        text: node.text,
        timestamp: node.timestamp,
        childCount: node.children.length,
        active: node.id === activeLeaf,
      });
      node.children
        .sort((a, b) => {
          const na = nodes.get(a);
          const nb = nodes.get(b);
          return String(na?.timestamp).localeCompare(String(nb?.timestamp));
        })
        .forEach((childId) => visit(childId, depth + 1));
    };
    roots.forEach((root) => visit(root.id, 0));
    return flat;
  } catch {
    return [];
  }
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
        // Clean up any pending cookie injection debounce
        const pendingCookie = domReadyDebounce.get(payload.surfaceId);
        if (pendingCookie) {
          clearTimeout(pendingCookie);
          domReadyDebounce.delete(payload.surfaceId);
        }
        if (piAgentManager.isAgentSurface(payload.surfaceId)) {
          piAgentManager.removeAgent(payload.surfaceId);
          sendWebviewAction("agentSurfaceClosed", {
            surfaceId: payload.surfaceId,
          });
        } else if (browserSurfaces.isBrowserSurface(payload.surfaceId)) {
          browserSurfaces.closeSurface(payload.surfaceId);
        } else {
          sessions.closeSurface(payload.surfaceId);
        }
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

      // ── Browser surface lifecycle ──
      createBrowserSurface: (payload) => {
        createBrowserWorkspaceSurface(payload.url);
      },
      splitBrowserSurface: (payload) => {
        splitBrowserSurface(payload.direction, payload.url);
      },
      browserNavigated: async (payload) => {
        browserSurfaces.updateNavigation(
          payload.surfaceId,
          payload.url,
          payload.title,
        );
        await browserHistory.ready;
        browserHistory.record(payload.url, payload.title);
        webServer?.broadcast({
          type: "browserNavigated",
          surfaceId: payload.surfaceId,
          url: payload.url,
          title: payload.title,
        });
      },
      browserTitleChanged: (payload) => {
        browserSurfaces.setTitle(payload.surfaceId, payload.title);
      },
      browserSetZoom: (payload) => {
        browserSurfaces.setZoom(payload.surfaceId, payload.zoom);
      },
      browserConsoleLog: (payload) => {
        browserSurfaces.addConsoleLog(payload.surfaceId, {
          level: payload.level,
          args: payload.args,
          timestamp: payload.timestamp,
        });
      },
      browserError: (payload) => {
        browserSurfaces.addError(payload.surfaceId, {
          message: payload.message,
          filename: payload.filename,
          lineno: payload.lineno,
          timestamp: payload.timestamp,
        });
      },
      browserEvalResult: (payload) => {
        const resolve = pendingBrowserEvals.get(payload.reqId);
        if (resolve) {
          pendingBrowserEvals.delete(payload.reqId);
          resolve(
            payload.error ? `Error: ${payload.error}` : (payload.result ?? ""),
          );
        }
      },
      browserDomReady: (payload) => {
        const { surfaceId, url } = payload;
        // Debounce: coalesce rapid navigations (redirects, SPA routing)
        const existing = domReadyDebounce.get(surfaceId);
        if (existing) clearTimeout(existing);
        domReadyDebounce.set(
          surfaceId,
          setTimeout(async () => {
            domReadyDebounce.delete(surfaceId);
            await cookieStore.ready;
            const cookies = cookieStore.getForUrl(url);
            if (cookies.length > 0) {
              rpc.send("browserInjectCookies", {
                surfaceId,
                cookies: cookies.map((c) => ({
                  name: c.name,
                  value: c.value,
                  path: c.path,
                  expires: c.expires,
                  secure: c.secure,
                  sameSite: c.sameSite,
                })),
              });
            }
          }, 50),
        );
      },
      browserCookieAction: (payload) => {
        const { action, data, format } = payload;
        if (action === "import" && data) {
          const cookies =
            format === "netscape"
              ? parseNetscapeCookies(data)
              : parseJsonCookies(data);
          const count = cookieStore.importBulk(cookies);
          rpc.send("cookieActionResult", {
            action: "import",
            message: `Imported ${count} cookies`,
          });
        } else if (action === "export") {
          const all = cookieStore.exportAll();
          const out =
            format === "netscape" ? exportAsNetscape(all) : exportAsJson(all);
          rpc.send("cookieExportResult", {
            data: out,
            format: format || "json",
          });
        } else if (action === "clear") {
          cookieStore.clear();
          rpc.send("cookieActionResult", {
            action: "clear",
            message: "All cookies cleared",
          });
        }
      },

      // ── Agent surface lifecycle ──
      createAgentSurface: (payload) => {
        createAgentWorkspaceSurface(payload);
      },
      splitAgentSurface: (payload) => {
        splitAgentSurface(payload.direction, payload);
      },
      agentPrompt: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent)
          agent.sendNoWait({
            type: "prompt",
            message: payload.message,
            ...(payload.images?.length ? { images: payload.images } : {}),
          });
      },
      agentAbort: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.sendNoWait({ type: "abort" });
      },
      agentSetModel: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent)
          agent.sendNoWait({
            type: "set_model",
            provider: payload.provider,
            modelId: payload.modelId,
          });
      },
      agentSetThinking: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent)
          agent.sendNoWait({
            type: "set_thinking_level",
            level: payload.level,
          });
      },
      agentNewSession: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.sendNoWait({ type: "new_session" });
      },
      agentCompact: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.sendNoWait({ type: "compact" });
      },
      agentGetModels: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.sendNoWait({ type: "get_available_models" });
      },
      agentGetState: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.sendNoWait({ type: "get_state" });
      },
      agentExtensionUIResponse: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.respondToExtensionUI(payload.id, payload.response);
      },
      agentSteer: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent)
          agent.sendNoWait({
            type: "steer",
            message: payload.message,
            ...(payload.images?.length ? { images: payload.images } : {}),
          });
      },
      agentFollowUp: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent)
          agent.sendNoWait({
            type: "follow_up",
            message: payload.message,
            ...(payload.images?.length ? { images: payload.images } : {}),
          });
      },
      agentBash: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent)
          agent.sendNoWait({
            type: "bash",
            command: payload.command,
            ...(payload.timeout != null ? { timeout: payload.timeout } : {}),
          });
      },
      agentAbortBash: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.abortBash();
      },
      agentCycleModel: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.sendNoWait({ type: "cycle_model" });
      },
      agentCycleThinking: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.sendNoWait({ type: "cycle_thinking_level" });
      },
      agentGetCommands: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.sendNoWait({ type: "get_commands" });
      },
      agentGetSessionStats: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.sendNoWait({ type: "get_session_stats" });
      },
      agentGetMessages: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.sendNoWait({ type: "get_messages" });
      },
      agentListSessions: (payload) => {
        sendWebviewAction("agentEvent", {
          agentId: payload.agentId,
          event: {
            type: "response",
            command: "list_sessions",
            success: true,
            data: { sessions: listPiSessions() },
          },
        });
      },
      agentGetSessionTree: (payload) => {
        sendWebviewAction("agentEvent", {
          agentId: payload.agentId,
          event: {
            type: "response",
            command: "get_session_tree",
            success: true,
            data: {
              tree: readPiSessionTree(payload.sessionPath),
            },
          },
        });
      },
      agentGetForkMessages: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.sendNoWait({ type: "get_fork_messages" });
      },
      agentGetLastAssistantText: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.sendNoWait({ type: "get_last_assistant_text" });
      },
      agentSetSteeringMode: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent)
          agent.sendNoWait({ type: "set_steering_mode", mode: payload.mode });
      },
      agentSetFollowUpMode: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent)
          agent.sendNoWait({ type: "set_follow_up_mode", mode: payload.mode });
      },
      agentSetAutoCompaction: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent)
          agent.sendNoWait({
            type: "set_auto_compaction",
            enabled: payload.enabled,
          });
      },
      agentSetAutoRetry: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent)
          agent.sendNoWait({
            type: "set_auto_retry",
            enabled: payload.enabled,
          });
      },
      agentAbortRetry: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.abortRetry();
      },
      agentSetSessionName: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent)
          agent.sendNoWait({ type: "set_session_name", name: payload.name });
      },
      agentSwitchSession: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent)
          agent.sendNoWait({
            type: "switch_session",
            sessionPath: payload.sessionPath,
          });
      },
      agentFork: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent) agent.sendNoWait({ type: "fork", entryId: payload.entryId });
      },
      agentExportHtml: (payload) => {
        const agent = piAgentManager.getAgent(payload.agentId);
        if (agent)
          agent.sendNoWait({
            type: "export_html",
            ...(payload.outputPath ? { outputPath: payload.outputPath } : {}),
          });
      },
    },
  },
});

// Pending browser eval results (socket API → webview → bun)
const pendingBrowserEvals = new Map<string, (value: string) => void>();

// Debounce cookie injection per surface to coalesce rapid navigations
const domReadyDebounce = new Map<string, ReturnType<typeof setTimeout>>();

// Create the main window
const mainWindow = new BrowserWindow({
  title: "HyperTerm Canvas",
  titleBarStyle: "hiddenInset",
  transparent: false,
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

function applyNativeWindowFrameInset(width: number, height: number): void {
  const webview = mainWindow.webview;
  if (!webview?.ptr) return;

  const inset = WINDOW_FRAME_INSET;
  const innerWidth = Math.max(1, width - inset * 2);
  const innerHeight = Math.max(1, height - inset * 2);

  native.symbols.resizeWebview(
    webview.ptr,
    inset,
    inset,
    innerWidth,
    innerHeight,
    toCString("[]"),
  );
}

applyNativeWindowFrameInset(mainWindow.frame.width, mainWindow.frame.height);

mainWindow.on("resize", (event: unknown) => {
  const resized = event as
    | { data?: { width?: number; height?: number } }
    | undefined;
  const width = resized?.data?.width ?? mainWindow.frame.width;
  const height = resized?.data?.height ?? mainWindow.frame.height;
  applyNativeWindowFrameInset(width, height);
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
  if (
    sessions.surfaceCount === 0 &&
    browserSurfaces.surfaceCount === 0 &&
    piAgentManager.agentCount === 0
  ) {
    mainWindow.close();
  }
};

browserSurfaces.onSurfaceClosed = (surfaceId) => {
  rpc.send("browserSurfaceClosed", { surfaceId });
  webServer?.broadcast({ type: "browserSurfaceClosed", surfaceId });
  if (
    sessions.surfaceCount === 0 &&
    browserSurfaces.surfaceCount === 0 &&
    piAgentManager.agentCount === 0
  ) {
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

// ── Browser Surface Creation ──

function createBrowserWorkspaceSurface(url?: string): void {
  const resolvedUrl =
    url || settingsManager.get().browserHomePage || "about:blank";
  const surfaceId = browserSurfaces.createSurface(resolvedUrl);
  focusedSurfaceId = surfaceId;
  rpc.send("browserSurfaceCreated", { surfaceId, url: resolvedUrl });
  webServer?.broadcast({
    type: "browserSurfaceCreated",
    surfaceId,
    url: resolvedUrl,
  });
}

function splitBrowserSurface(
  direction: "horizontal" | "vertical",
  url?: string,
): void {
  const resolvedUrl =
    url || settingsManager.get().browserHomePage || "about:blank";
  const splitFrom = focusedSurfaceId;
  const surfaceId = browserSurfaces.createSurface(resolvedUrl);
  focusedSurfaceId = surfaceId;
  rpc.send("browserSurfaceCreated", {
    surfaceId,
    url: resolvedUrl,
    splitFrom: splitFrom ?? undefined,
    direction,
  });
  webServer?.broadcast({
    type: "browserSurfaceCreated",
    surfaceId,
    url: resolvedUrl,
  });
}

// ── Agent Surface Creation ──

/** Resolve the ht-cli skill path from the project root. */
function resolveHtCliSkillPath(): string {
  const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  return join(projectRoot, ".agents", "skills", "hyperterm-canvas", "SKILL.md");
}

function createAgentWorkspaceSurface(
  opts: {
    provider?: string;
    model?: string;
    thinkingLevel?: string;
    cwd?: string;
  } = {},
): void {
  const cwd =
    opts.cwd ??
    metadataPoller.getSnapshot(focusedSurfaceId ?? "")?.cwd ??
    process.cwd();
  const skills: string[] = [];
  const skillPath = resolveHtCliSkillPath();
  if (existsSync(skillPath)) skills.push(skillPath);

  const agent = piAgentManager.createAgent({
    provider: opts.provider,
    model: opts.model,
    thinkingLevel: opts.thinkingLevel,
    cwd,
    skills,
  });

  agent.onEvent = (event) => {
    sendWebviewAction("agentEvent", { agentId: agent.id, event });
  };
  agent.onExit = (code) => {
    sendWebviewAction("agentEvent", {
      agentId: agent.id,
      event: { type: "agent_exit", code },
    });
  };

  focusedSurfaceId = agent.id;
  sendWebviewAction("agentSurfaceCreated", {
    surfaceId: agent.id,
    agentId: agent.id,
  });
  void agent
    .start()
    .catch((err) => console.error("[agent] start failed:", err));
}

function splitAgentSurface(
  direction: "horizontal" | "vertical",
  opts: {
    provider?: string;
    model?: string;
    thinkingLevel?: string;
    cwd?: string;
  } = {},
): void {
  const splitFrom = focusedSurfaceId;
  const cwd =
    opts.cwd ??
    metadataPoller.getSnapshot(splitFrom ?? "")?.cwd ??
    process.cwd();
  const skills: string[] = [];
  const skillPath = resolveHtCliSkillPath();
  if (existsSync(skillPath)) skills.push(skillPath);

  const agent = piAgentManager.createAgent({
    provider: opts.provider,
    model: opts.model,
    thinkingLevel: opts.thinkingLevel,
    cwd,
    skills,
  });

  agent.onEvent = (event) => {
    sendWebviewAction("agentEvent", { agentId: agent.id, event });
  };
  agent.onExit = (code) => {
    sendWebviewAction("agentEvent", {
      agentId: agent.id,
      event: { type: "agent_exit", code },
    });
  };

  focusedSurfaceId = agent.id;
  sendWebviewAction("agentSurfaceCreated", {
    surfaceId: agent.id,
    agentId: agent.id,
    splitFrom: splitFrom ?? undefined,
    direction,
  });
  void agent.start();
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
      if (surfaceId) {
        if (piAgentManager.isAgentSurface(surfaceId)) {
          piAgentManager.removeAgent(surfaceId);
          sendWebviewAction("agentSurfaceClosed", { surfaceId });
        } else if (browserSurfaces.isBrowserSurface(surfaceId)) {
          browserSurfaces.closeSurface(surfaceId);
        } else {
          sessions.closeSurface(surfaceId);
        }
      }
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
    case MENU_ACTIONS.browserSplitRight:
      splitBrowserSurface("horizontal");
      break;
    case MENU_ACTIONS.browserSplitDown:
      splitBrowserSurface("vertical");
      break;
    case MENU_ACTIONS.openProjectReadme:
      Utils.openPath(
        fileURLToPath(new URL("../../README.md", import.meta.url)),
      );
      break;
    case MENU_ACTIONS.installHtCli:
      void installHtCli();
      break;
    case MENU_ACTIONS.agentNew:
      createAgentWorkspaceSurface();
      break;
    case MENU_ACTIONS.agentSplitRight:
      splitAgentSurface("horizontal");
      break;
    case MENU_ACTIONS.agentSplitDown:
      splitAgentSurface("vertical");
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
        settingsManager.get().webMirrorBind,
        settingsManager.get().webMirrorAuthToken,
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
  } else if (action === "createBrowserSurface") {
    createBrowserWorkspaceSurface(payload["url"] as string | undefined);
  } else if (action === "createAgentSurface") {
    createAgentWorkspaceSurface(
      payload as {
        provider?: string;
        model?: string;
        thinkingLevel?: string;
        cwd?: string;
      },
    );
  } else if (action === "splitAgentSurface") {
    splitAgentSurface(
      (payload["direction"] as "horizontal" | "vertical") || "horizontal",
      payload as {
        provider?: string;
        model?: string;
        thinkingLevel?: string;
        cwd?: string;
      },
    );
  } else if (action === "splitBrowserSurface") {
    splitBrowserSurface(
      (payload["direction"] as "horizontal" | "vertical") || "horizontal",
      payload["url"] as string | undefined,
    );
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
  browserSurfaces,
  browserHistory,
  pendingBrowserEvals,
  cookieStore,
);
const socketPath = join(configDir, "hyperterm.sock");
// Ensure the config directory exists before binding the socket
if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
// Expose path to child shells so the `ht` CLI can locate the server
process.env["HT_SOCKET_PATH"] = socketPath;
const socketServer = new SocketServer(socketPath, socketHandler);
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
        surfaceUrls: ws.surfaceUrls,
        surfaceTypes: ws.surfaceTypes,
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
      surfaceType: node.surfaceType,
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
      const surfType = ws.surfaceTypes?.[oldId];
      if (surfType === "agent") {
        // Agent surfaces are not restored — they require a fresh pi process.
        // Create a terminal surface instead as a placeholder.
        const cwd = ws.surfaceCwds?.[oldId];
        const newId = sessions.createSurface(cols, rows, cwd);
        surfaceMapping[oldId] = newId;
        const title = sessions.getSurface(newId)?.title ?? "shell";
        rpc.send("surfaceCreated", { surfaceId: newId, title });
        broadcastSurfaceCreated(newId, title);
      } else if (surfType === "browser") {
        const url = ws.surfaceUrls?.[oldId] ?? "about:blank";
        const newId = browserSurfaces.createSurface(url);
        surfaceMapping[oldId] = newId;
        rpc.send("browserSurfaceCreated", { surfaceId: newId, url });
        webServer?.broadcast({
          type: "browserSurfaceCreated",
          surfaceId: newId,
          url,
        });
      } else {
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
  browserHistory.saveNow();
  cookieStore.saveNow();
  piAgentManager.dispose();
  webServer?.stop();
  socketServer.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  saveLayout();
  settingsManager.saveNow();
  browserHistory.saveNow();
  cookieStore.saveNow();
  piAgentManager.dispose();
  webServer?.stop();
  socketServer.stop();
  process.exit(0);
});
