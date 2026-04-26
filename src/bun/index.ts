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
import { tmpdir as osTmpdir } from "node:os";
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
import type {
  TauMuxRPC,
  PersistedLayout,
  PaneNode,
  TelegramWireMessage,
} from "../shared/types";
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
import { PanelRegistry } from "./panel-registry";
import { SurfaceMetadataPoller } from "./surface-metadata";
import { WebServer } from "./web-server";
import { createRpcHandler } from "./rpc-handler";
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
import { AppContext } from "./app-context";
import { switchToAccessoryMode } from "./accessory-mode";
import { TelegramDatabase } from "./telegram-db";
import {
  TelegramService,
  type TelegramServiceStatus,
  planNotificationForwarding,
} from "./telegram-service";
import { wireMessage as wireTelegramMessage } from "./rpc-handlers/telegram";
import { setupLogging } from "./logger";
import {
  defaultAudits,
  runAudits,
  type Audit,
  type AuditResult,
} from "./audits";
import { HealthRegistry } from "./health";
import { PlanStore } from "./plan-store";
import { AskUserQueue } from "./ask-user-queue";
import {
  buildButtonsForKind,
  formatQuestionForTelegram,
  formatResolutionFooter,
  parseAskCallbackData,
  type AskUserAttribution,
} from "./ask-user-telegram";
import { parseAllowedTelegramIds } from "../shared/settings";

// `HT_CONFIG_DIR` override: e2e tests relocate the socket, settings, layout,
// browser history, and cookies under a per-worker throwaway dir. Default path
// (user's Library/Application Support) is unchanged.
const configDir =
  process.env["HT_CONFIG_DIR"] ?? join(Utils.paths.config, "hyperterm-canvas");

// Tee stdout + stderr to a daily-rotated log file. Must run before the
// first `console.*` call so the bootstrap banner captures early output
// (e.g. the HT_E2E / TEST_MODE markers below). Lands at
// `~/Library/Logs/tau-mux/app-YYYY-MM-DD.log` in normal runs and under
// `$HT_CONFIG_DIR/logs/` when e2e has relocated state.
const loggerHandle = setupLogging(configDir);

// Subsystem health registry. Built before any subsystem starts so
// initial states can land as the bootstrap progresses. Plan #07: a
// crash in one subsystem (telegram, web mirror) must not be silent.
// Subsystems push their state via `health.set(id, severity, msg)`;
// `system.health` RPC and `ht health` CLI surface the snapshot.
const health = new HealthRegistry();

// Plan #09 — agent plan store. In-memory only; agents publish via
// `ht plan set/update/complete/clear`. The store emits change
// snapshots; we debounce-broadcast them to the webview as
// `restorePlans` so the future plan panel can render without
// polling.
const plans = new PlanStore();
let plansBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
plans.subscribe(() => {
  if (plansBroadcastTimer) return;
  plansBroadcastTimer = setTimeout(() => {
    plansBroadcastTimer = null;
    rpc.send("restorePlans", { plans: plans.list() });
    app.webServer?.broadcast({
      type: "plansSnapshot",
      plans: plans.list(),
    });
  }, 100);
});

// Plan #10 — agent → user question queue. Long-pending RPCs
// (`agent.ask_user`) await resolution from a sibling
// `agent.ask_answer` / `agent.ask_cancel` (or the timeout). The
// future webview panel listens on the `askUserEvent` push channel;
// we forward every shown / resolved transition immediately
// (transitions are rare; no need to debounce).
const askUser = new AskUserQueue();
askUser.subscribe((event) => {
  if (event.kind === "shown") {
    rpc.send("askUserEvent", { kind: "shown", request: event.request });
    app.webServer?.broadcast({
      type: "askUserShown",
      request: event.request,
    });
    // Plan #10 commit B — fan out to Telegram when the user opted
    // in. Fire-and-forget; the helper persists link rows so the
    // callback / reply-to handlers can route the answer back into
    // the queue.
    void fanoutAskUserToTelegram(event.request);
  } else {
    rpc.send("askUserEvent", {
      kind: "resolved",
      request_id: event.request_id,
      response: event.response,
    });
    app.webServer?.broadcast({
      type: "askUserResolved",
      request_id: event.request_id,
      response: event.response,
    });
    // Plan #10 commit B — stamp resolution footers on every
    // Telegram message linked to this request so the chat history
    // becomes a clean audit log of every answered question.
    void editAskUserResolutionToTelegram(event.request_id, event.response);
  }
});
// Seed pty / socket / web-mirror with a "starting" baseline. Each
// subsystem updates its row when it actually comes up. Audits push
// their own row from the startup runner below.
health.set("pty", "ok", "Session manager ready");
health.set("socket", "degraded", "Binding socket");
health.set("web-mirror", "disabled", "Not started");

// Plan #07 — fault isolation. Without these handlers an unhandled
// rejection or uncaught exception originating in *any* subsystem
// (most often the telegram long-poll loop) takes the entire bun
// process down, which kills the socket server and breaks `ht`. We
// log loudly, mark the offending subsystem when we can identify it,
// and continue. Truly unrecoverable errors (out-of-memory, native
// crashes) bypass this hook anyway.
process.on("unhandledRejection", (reason: unknown) => {
  const msg =
    reason instanceof Error
      ? `${reason.message}\n${reason.stack ?? ""}`
      : String(reason);
  console.error("[fatal] unhandledRejection:", msg);
  attributeFault(msg);
});
process.on("uncaughtException", (err: Error) => {
  console.error("[fatal] uncaughtException:", err.message, err.stack ?? "");
  attributeFault(`${err.message}\n${err.stack ?? ""}`);
});

/** Best-effort fault attribution: when the stack mentions a subsystem
 *  we've registered, mark its health row as `error` so the user sees
 *  *which* subsystem destabilised. The check is substring-based —
 *  good enough to catch the obvious culprits (telegram, telegram-db,
 *  web/server) without false-positive paranoia. */
function attributeFault(text: string): void {
  if (text.includes("telegram-service") || text.includes("telegram-db")) {
    health.set("telegram", "error", "Crashed — see app log for stack");
  } else if (text.includes("web-server") || text.includes("/web/")) {
    health.set("web-mirror", "error", "Crashed — see app log for stack");
  } else if (text.includes("session-manager") || text.includes("pty-manager")) {
    health.set("pty", "error", "Crashed — see app log for stack");
  }
}

// `HT_E2E=1` marks this process as an e2e test run. Used to suppress the
// install-ht-CLI nag, skip real-user-disrupting side effects, and tag logs.
const HT_E2E = process.env["HT_E2E"] === "1";
if (HT_E2E) {
  console.log(`[e2e] HT_E2E=1 configDir=${configDir}`);
}
if (loggerHandle.currentPath) {
  console.log(`[logger] tee → ${loggerHandle.currentPath}`);
}

// Tier 2 test-mode gate (doc/native-e2e-plan.md §6.1). **Both facts must be
// true** before the `__test.*` RPC family is exposed or the webview's test
// router is enabled:
//   1. `HYPERTERM_TEST_MODE=1` — explicit opt-in at launch.
//   2. `HT_CONFIG_DIR` lives under the system's tmp dir — refuses to let a
//      stray env var in a user shell expose these handlers against the real
//      Application Support config.
// Production builds never set either; even a leaked env-var alone fails
// the path check, so the test surface stays unreachable.
const HT_TEST_MODE =
  process.env["HYPERTERM_TEST_MODE"] === "1" &&
  typeof process.env["HT_CONFIG_DIR"] === "string" &&
  (process.env["HT_CONFIG_DIR"]!.startsWith(osTmpdir()) ||
    process.env["HT_CONFIG_DIR"]!.startsWith("/tmp/"));
if (HT_TEST_MODE) {
  console.log(`[e2e] Tier 2 test mode enabled (__test.* handlers exposed)`);
}
const settingsFile = join(configDir, "settings.json");
const settingsManager = new SettingsManager(configDir, settingsFile);

const sessions = new SessionManager(settingsManager.get().shellPath);
const piAgentManager = new PiAgentManager();
const browserSurfaces = new BrowserSurfaceManager();
const browserHistory = new BrowserHistoryStore(configDir);
const cookieStore = new CookieStore(configDir);
const metadataPoller = new SurfaceMetadataPoller(sessions);
const panelRegistry = new PanelRegistry();

// ── Telegram bot integration ──
// Database is always opened so the read-side `telegram.history` /
// `telegram.chats` RPCs return persisted data even when the long-poll
// loop is off. The service itself is started/stopped on demand by
// `applyTelegramSettings`, gated on `telegramEnabled` + a non-empty
// token.
const telegramDb = new TelegramDatabase(join(configDir, "telegram.db"));
// Plan #08: drop notification_links rows older than 24h on startup so
// stale taps (a user opening a day-old DM and pressing Continue)
// don't fire actions on a surface that may have been recycled.
try {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const dropped = telegramDb.pruneOldNotificationLinks(cutoff);
  if (dropped > 0) {
    console.log(`[telegram] pruned ${dropped} stale notification link(s)`);
  }
  // Plan #10 commit B — same 24h horizon for ask-user link rows
  // (button-driven kinds + force_reply text). A tap on a day-old
  // ask prompt would fire against a stale request id.
  const askDropped = telegramDb.pruneOldAskUserLinks(cutoff);
  const replyDropped = telegramDb.pruneOldTextReplyLinks(cutoff);
  if (askDropped > 0 || replyDropped > 0) {
    console.log(
      `[telegram] pruned ${askDropped} ask-user + ${replyDropped} text-reply link(s)`,
    );
  }
} catch (err) {
  console.warn("[telegram] link table prune failed:", err);
}
let telegramService: TelegramService | null = null;

// Env var HYPERTERM_WEB_PORT overrides the user setting so the dev/test
// workflow (custom port via env) keeps working.
const webServerPortEnv = process.env["HYPERTERM_WEB_PORT"];

const app = new AppContext({
  configDir,
  sessions,
  piAgents: piAgentManager,
  browserSurfaces,
  browserHistory,
  cookieStore,
  metadataPoller,
  settings: settingsManager,
  webServerPort: webServerPortEnv
    ? parseInt(webServerPortEnv, 10)
    : settingsManager.get().webMirrorPort,
});

const WINDOW_FRAME_INSET = 2;

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
      else if (entry.isFile() && entry.name.endsWith(".jsonl"))
        files.push(full);
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

function readPiSessionTree(
  sessionPath?: string,
): Array<Record<string, unknown>> {
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
      nodes.set(id, {
        id,
        parentId,
        timestamp,
        entryType,
        role,
        text,
        children: [],
      });
    }

    for (const node of nodes.values()) {
      if (node.parentId) nodes.get(node.parentId)?.children.push(node.id);
    }

    const roots = [...nodes.values()]
      .filter((node) => !node.parentId || !nodes.has(node.parentId))
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const activeLeaf =
      [...nodes.values()]
        .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
        .at(-1)?.id ?? null;
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

// Define RPC handlers.
//
// `bunMessageHandlers` is extracted into a typed const with a `satisfies`
// clause so that adding a new method to `TauMuxRPC["bun"]["messages"]`
// without a matching handler here becomes a compile-time error.
// (Electrobun's native `handlers.messages` type treats each key as
// optional, which is why we need this belt-and-braces assertion.)
//
// The handlers close over `rpc`, which is declared below; that is
// safe because handler bodies only execute after rpc is fully
// initialized.
type BunMessageHandlers = {
  [K in keyof TauMuxRPC["bun"]["messages"]]: TauMuxRPC["bun"]["messages"][K] extends void
    ? () => void | Promise<void>
    : (payload: TauMuxRPC["bun"]["messages"][K]) => void | Promise<void>;
};

const bunMessageHandlers = {
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
    app.focusedSurfaceId = payload.surfaceId;
    void handlePaste();
  },
  writeStdin: (payload) => {
    sessions.writeStdin(payload.surfaceId, payload.data);
  },
  viewportSize: (payload) => {
    app.webServer?.setNativeViewport(payload.width, payload.height);
  },
  resize: (payload) => {
    if (!app.initialResizeReceived) {
      app.initialResizeReceived = true;
      // Send settings now that the webview is ready
      rpc.send("restoreSettings", { settings: settingsManager.get() });
      // Static runtime paths for the Settings → Advanced panel. Sent
      // once; the panel caches them. logPath is null when the file tee
      // failed to open (read-only home, full disk, etc).
      rpc.send("restoreDiagnostics", {
        logPath: loggerHandle.currentPath,
        socketPath,
        configDir,
      });
      // Tier 2: flip the webview's test-mode flag before any test fixture
      // tries to exercise a `__test.*` RPC. Under the dual-fact gate this
      // is a no-op for production.
      if (HT_TEST_MODE) {
        rpc.send("enableTestMode", { enabled: true });
      }
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
      app.webServer?.broadcast({
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
    } else if (payload.surfaceId.startsWith("tg:")) {
      // Telegram panes have no bun-side resource (no PTY, no browser
      // process, no agent); echo the close back so the webview layout
      // removes the pane. Without this the × does nothing.
      rpc.send("surfaceClosed", { surfaceId: payload.surfaceId });
      app.webServer?.broadcast({
        type: "surfaceClosed",
        surfaceId: payload.surfaceId,
      });
    } else {
      sessions.closeSurface(payload.surfaceId);
    }
  },
  focusSurface: (payload) => {
    app.focusedSurfaceId = payload.surfaceId;
    app.webServer?.broadcast({
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
    if (payload.event === "dragend") {
      app.webServer?.broadcast({
        type: "panelEvent",
        surfaceId: payload.surfaceId,
        id: payload.id,
        event: payload.event,
        x: payload.x,
        y: payload.y,
      });
    } else if (payload.event === "resize") {
      app.webServer?.broadcast({
        type: "panelEvent",
        surfaceId: payload.surfaceId,
        id: payload.id,
        event: payload.event,
        width: payload.width,
        height: payload.height,
      });
    } else if (payload.event === "close") {
      app.webServer?.broadcast({
        type: "panelEvent",
        surfaceId: payload.surfaceId,
        id: payload.id,
        event: payload.event,
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
  webviewResponse: (payload) => {
    // Generic webview → bun reply used by Tier 2 `__test.*` round-trips and
    // any future read-style RPC. Shape: `{ reqId, result }` where result is
    // opaque JSON. `readScreenResponse` stays separate for back-compat.
    const resolve = pendingReads.get(payload.reqId);
    if (resolve) {
      pendingReads.delete(payload.reqId);
      resolve(payload.result);
    }
  },
  workspaceStateSync: (payload) => {
    app.workspaceState = payload.workspaces;
    app.activeWorkspaceId = payload.activeWorkspaceId;
    const activeWorkspace =
      payload.workspaces.find((ws) => ws.id === payload.activeWorkspaceId) ??
      null;
    mainWindow.setTitle(formatWindowTitle(activeWorkspace?.name ?? null));
    app.webServer?.broadcast({
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
      focusedSurfaceId: app.focusedSurfaceId,
    });
    scheduleLayoutSave();
  },
  sidebarToggle: (payload) => {
    app.sidebarVisible = payload.visible;
    app.webServer?.broadcast({
      type: "sidebarState",
      visible: payload.visible,
    });
  },
  clearNotifications: () => {
    socketHandler("notification.clear", {});
  },
  dismissNotification: (payload) => {
    socketHandler("notification.dismiss", { id: payload.id });
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
    if (
      updated.telegramEnabled !== previous.telegramEnabled ||
      updated.telegramBotToken !== previous.telegramBotToken ||
      updated.telegramAllowedUserIds !== previous.telegramAllowedUserIds
    ) {
      void applyTelegramSettings();
    }
    if (
      updated.auditsGitUserNameExpected !== previous.auditsGitUserNameExpected
    ) {
      rebuildAudits();
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
  revealLogFile: () => {
    revealLogFile();
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
    app.webServer?.broadcast({
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

  // ── Telegram (webview → bun) ──
  createTelegramSurface: () => {
    createTelegramWorkspaceSurface();
  },
  splitTelegramSurface: (payload) => {
    splitTelegramSurface(payload.direction);
  },
  telegramSend: (payload) => {
    if (!payload.chatId || !payload.text) return;
    void sendTelegramAndBroadcast(payload.chatId, payload.text);
  },
  telegramRequestHistory: (payload) => {
    const limit = payload.limit ?? 50;
    const before = payload.before;
    const rows = telegramDb.getHistory(payload.chatId, limit, before);
    const messages = rows.map(wireTelegramMessage);
    rpc.send("telegramHistory", {
      chatId: payload.chatId,
      messages,
      isLatest: !before,
    });
  },
  telegramRequestState: () => {
    sendTelegramStateToWebview();
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
} satisfies BunMessageHandlers;

const rpc = BrowserView.defineRPC<TauMuxRPC>({
  handlers: { messages: bunMessageHandlers },
});

// Pending browser eval results (socket API → webview → bun)
const pendingBrowserEvals = new Map<string, (value: string) => void>();

// Debounce cookie injection per surface to coalesce rapid navigations
const domReadyDebounce = new Map<string, ReturnType<typeof setTimeout>>();

// Create the main window
const mainWindow = new BrowserWindow({
  title: "τ-mux",
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

// Daily-driver-safe mode (doc/native-e2e-plan.md §8.2). Switches NSApp to
// accessory activation policy — no Dock icon, no focus steal, no ⌘+Tab
// entry — so an e2e test spawned by a developer running τ-mux as their
// daily driver does not interrupt the user's workflow. Runs AFTER the
// BrowserWindow is instantiated so NSApp already exists when we flip it.
if (HT_E2E) {
  const ok = switchToAccessoryMode();
  if (ok)
    console.log("[e2e] switched to NSApplicationActivationPolicyAccessory");
  else console.warn("[e2e] accessory mode failed; tests may steal focus");
}

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
  app.webServer?.broadcastStdout(surfaceId, data);
};

sessions.onSidebandMeta = (surfaceId, msg) => {
  panelRegistry.handleMeta(surfaceId, msg);
  rpc.send("sidebandMeta", { ...msg, surfaceId });
  app.webServer?.broadcast({ type: "sidebandMeta", surfaceId, meta: msg });
};

sessions.onSidebandData = (surfaceId, id, data) => {
  // Native webview: base64 over Electrobun RPC (JSON transport requires it)
  const base64 = Buffer.from(data).toString("base64");
  rpc.send("sidebandData", { surfaceId, id, data: base64 });
  // Web mirror: native binary WebSocket frames (zero base64 overhead)
  app.webServer?.broadcastSidebandBinary(surfaceId, id, data);
};

sessions.onSidebandDataFailed = (surfaceId, id, reason) => {
  rpc.send("sidebandDataFailed", { surfaceId, id, reason });
  app.webServer?.broadcast({
    type: "sidebandDataFailed",
    surfaceId,
    id,
    reason,
  });
};

sessions.onSurfaceClosed = (surfaceId) => {
  panelRegistry.clearSurface(surfaceId);
  rpc.send("surfaceClosed", { surfaceId });
  app.webServer?.broadcast({ type: "surfaceClosed", surfaceId });
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
  app.webServer?.broadcast({ type: "browserSurfaceClosed", surfaceId });
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
  app.webServer?.broadcast({ type: "surfaceExited", surfaceId, exitCode });
};

metadataPoller.onMetadata = (surfaceId, metadata) => {
  rpc.send("surfaceMetadata", { surfaceId, metadata });
  app.webServer?.broadcast({ type: "surfaceMetadata", surfaceId, metadata });
};
metadataPoller.start();

// Kick off the Telegram long-poll loop if the user has it enabled.
// Errors land on `console.warn` via service `onLog` — booting the app
// must not block on a flaky network or a bad token.
void applyTelegramSettings();

// ── Web Mirror ──

function broadcastSurfaceCreated(surfaceId: string, title: string): void {
  app.webServer?.broadcast({ type: "surfaceCreated", surfaceId, title });
}

function broadcastSurfaceRenamed(surfaceId: string, title: string): void {
  app.webServer?.broadcast({ type: "surfaceRenamed", surfaceId, title });
}

function sendWebviewAction(
  action: string,
  payload: Record<string, unknown> = {},
): void {
  rpc.send("socketAction", { action, payload });
}

/** Push the cumulative `htKeysSeen` snapshot to the webview + web
 *  mirror. Debounced 200 ms so a script firing dozens of
 *  `ht set-status` calls in a tick produces a single push.
 *  Insertion-ordered Set, so the wire `keys[]` reflects the order in
 *  which scripts first published each key — Settings → Layout uses
 *  that order as the default. */
function scheduleHtKeysSeenBroadcast(): void {
  if (app.htKeysSeenTimer) return;
  app.htKeysSeenTimer = setTimeout(() => {
    app.htKeysSeenTimer = null;
    const keys = [...app.htKeysSeen];
    rpc.send("restoreHtKeysSeen", { keys });
    app.webServer?.broadcast({ type: "htKeysSeen", keys });
  }, 200);
}

function createWorkspaceSurface(
  cols: number,
  rows: number,
  cwd?: string,
): void {
  const surfaceId = sessions.createSurface(cols, rows, cwd);
  const title = sessions.getSurface(surfaceId)?.title ?? "shell";
  app.focusedSurfaceId = surfaceId;
  rpc.send("surfaceCreated", { surfaceId, title });
  broadcastSurfaceCreated(surfaceId, title);
}

function splitSurface(
  direction: "horizontal" | "vertical",
  splitFrom: string | null = app.focusedSurfaceId,
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
  app.focusedSurfaceId = surfaceId;
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
  app.focusedSurfaceId = surfaceId;
  rpc.send("browserSurfaceCreated", { surfaceId, url: resolvedUrl });
  app.webServer?.broadcast({
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
  const splitFrom = app.focusedSurfaceId;
  const surfaceId = browserSurfaces.createSurface(resolvedUrl);
  app.focusedSurfaceId = surfaceId;
  rpc.send("browserSurfaceCreated", {
    surfaceId,
    url: resolvedUrl,
    splitFrom: splitFrom ?? undefined,
    direction,
  });
  app.webServer?.broadcast({
    type: "browserSurfaceCreated",
    surfaceId,
    url: resolvedUrl,
  });
}

// ── Telegram Surface Creation ──

let telegramSurfaceCounter = 0;
function nextTelegramSurfaceId(): string {
  return `tg:${++telegramSurfaceCounter}:${Date.now().toString(36)}`;
}

function createTelegramWorkspaceSurface(): void {
  const surfaceId = nextTelegramSurfaceId();
  app.focusedSurfaceId = surfaceId;
  rpc.send("telegramSurfaceCreated", { surfaceId });
  app.webServer?.broadcast({ type: "telegramSurfaceCreated", surfaceId });
  // Push the current state so the new pane renders chats + status without a
  // round-trip — the pane requests state on mount as well, but this saves
  // a frame.
  sendTelegramStateToWebview();
}

function splitTelegramSurface(direction: "horizontal" | "vertical"): void {
  const splitFrom = app.focusedSurfaceId;
  const surfaceId = nextTelegramSurfaceId();
  app.focusedSurfaceId = surfaceId;
  rpc.send("telegramSurfaceCreated", {
    surfaceId,
    splitFrom: splitFrom ?? undefined,
    direction,
  });
  app.webServer?.broadcast({ type: "telegramSurfaceCreated", surfaceId });
  sendTelegramStateToWebview();
}

// ── Telegram service lifecycle ──

function buildTelegramStatePayload() {
  const chats = telegramDb.listChats();
  // Precedence: live service state > explicit misconfigured marker >
  // default disabled. The misconfigured marker is set by
  // applyTelegramSettings when the user flipped the enable flag but
  // left the token empty, so the sidebar + settings panel can surface
  // an actionable error instead of a silent "disabled".
  const status = telegramService?.getStatus() ??
    telegramMisconfigured ?? { state: "disabled" as const };
  return { chats, status };
}

function sendTelegramStateToWebview(): void {
  rpc.send("telegramState", buildTelegramStatePayload());
}

function broadcastTelegramState(): void {
  const payload = buildTelegramStatePayload();
  rpc.send("telegramState", payload);
  app.webServer?.broadcast({ type: "telegramState", ...payload });
}

/** Broadcast a single Telegram message to every UI surface (native
 *  webview + every connected web mirror). Centralized so the four
 *  call sites — incoming poll, send-from-webview, send-from-web,
 *  notification forwarder — stay in lockstep. Also re-broadcasts the
 *  state snapshot so the chat list / lastSeen times update. */
function broadcastTelegramMessage(wire: TelegramWireMessage): void {
  rpc.send("telegramMessage", { message: wire });
  app.webServer?.broadcast({ type: "telegramMessage", message: wire });
  broadcastTelegramState();
}

/** Send a message via the live service and fan the result out to every
 *  client. No-op (with warning) when the service isn't running. */
async function sendTelegramAndBroadcast(
  chatId: string,
  text: string,
): Promise<void> {
  const svc = telegramService;
  if (!svc) {
    console.warn("[telegram] send dropped — service not running");
    return;
  }
  try {
    const persisted = await svc.sendMessage(chatId, text);
    broadcastTelegramMessage(wireTelegramMessage(persisted));
  } catch (err) {
    console.warn("[telegram] send failed:", err);
  }
}

/** Plan #08 — same as sendTelegramAndBroadcast but attaches inline
 *  keyboard buttons + persists a notification_links row so the
 *  inbound callback_query handler can recover the τ-mux origin
 *  later. The buttons are fixed for v1 (OK / Continue / Stop);
 *  custom button sets land in a follow-up. */
async function sendTelegramNotificationWithButtons(opts: {
  chatId: string;
  text: string;
  notificationId: string;
  surfaceId: string | null;
}): Promise<void> {
  const svc = telegramService;
  if (!svc) return;
  // Compact `<action>|<id>` payload — Telegram caps callback_data at
  // 64 bytes; notification ids stay well under.
  const buttons = [
    [
      { text: "OK", callback_data: `ok|${opts.notificationId}` },
      { text: "Continue", callback_data: `continue|${opts.notificationId}` },
      { text: "Stop", callback_data: `stop|${opts.notificationId}` },
    ],
  ];
  try {
    const persisted = await svc.sendMessageWithButtons(
      opts.chatId,
      opts.text,
      buttons,
    );
    broadcastTelegramMessage(wireTelegramMessage(persisted));
    if (persisted.tgMessageId !== null) {
      telegramDb.linkNotification({
        chatId: opts.chatId,
        tgMessageId: persisted.tgMessageId,
        notificationId: opts.notificationId,
        surfaceId: opts.surfaceId,
      });
    }
  } catch (err) {
    console.warn("[telegram] send with buttons failed:", err);
  }
}

/** Resolve a tapped button into a τ-mux action and dispatch it via
 *  the existing socket handler — same surface as the CLI / external
 *  scripts use, so any current rate limits / audit entries apply
 *  uniformly. Drops silently when:
 *    - the link can't be resolved (link expired, db pruned, message
 *      predates Plan #08)
 *    - the data string doesn't parse cleanly
 *  Logs the dispatch path so the user can audit what their tap did. */
/** Plan #10 commit B — fan an ask-user request out to every
 *  allow-listed Telegram chat. For yesno / choice / confirm-command
 *  the message carries an inline keyboard; for text it carries
 *  force_reply. Each successful send persists a link row so the
 *  matching callback (or reply_to_message) can resolve the queue.
 *  Fire-and-forget — if a chat send fails, the CLI fallback path
 *  (`ht ask answer`) still works. */
async function fanoutAskUserToTelegram(
  request: import("../shared/types").AskUserRequest,
): Promise<void> {
  const settings = settingsManager.get();
  if (!settings.telegramAskUserEnabled) return;
  const svc = telegramService;
  if (!svc) return;
  const allowed = parseAllowedTelegramIds(settings.telegramAllowedUserIds);
  if (allowed.size === 0) return;

  const attribution = resolveAskAttribution(request);
  const text = formatQuestionForTelegram(request, attribution);
  const markup = buildButtonsForKind(request);

  // Cache the title so the resolution edit can re-stamp it without
  // a SQLite round-trip. Cleared on resolve.
  requestTitleCache.set(request.request_id, request.title);

  for (const chatId of allowed) {
    try {
      const persisted = await svc.sendRich(chatId, text, markup, "MarkdownV2");
      if (persisted.tgMessageId === null) continue;
      // Persist the right link table per kind so the response
      // routing can find it later.
      if (request.kind === "text") {
        telegramDb.linkTextReply({
          chatId,
          tgMessageId: persisted.tgMessageId,
          requestId: request.request_id,
        });
      } else {
        telegramDb.linkAskUser({
          chatId,
          tgMessageId: persisted.tgMessageId,
          requestId: request.request_id,
          kind: request.kind,
        });
      }
      broadcastTelegramMessage(wireTelegramMessage(persisted));
    } catch (err) {
      console.warn(
        `[telegram] ask-user fan-out to ${chatId} failed: ${(err as Error).message}`,
      );
    }
  }
}

/** Pull the workspace + pane attribution for a request from the
 *  authoritative AppContext snapshot. Empty when the surface no
 *  longer exists (e.g. closed mid-question). */
function resolveAskAttribution(
  request: import("../shared/types").AskUserRequest,
): AskUserAttribution {
  const ws = app.workspaceState.find((w) =>
    w.surfaceIds.includes(request.surface_id),
  );
  return {
    workspace: ws?.name,
    pane: (ws?.surfaceTitles?.[request.surface_id] as string) ?? undefined,
    agent: request.agent_id,
  };
}

/** Plan #10 commit B — when an ask-user request resolves (answer /
 *  cancel / timeout), edit every linked Telegram message to stamp
 *  the resolution footer + remove the now-stale buttons. We also
 *  drop the link rows so a stale tap can't accidentally re-resolve
 *  a future request that recycles the id. */
async function editAskUserResolutionToTelegram(
  requestId: string,
  response: import("../shared/types").AskUserResponse,
): Promise<void> {
  const svc = telegramService;
  // Even when the service is gone we still need to drop the link
  // rows so they can't outlive the request.
  const askLinks = telegramDb.getAskUserLinksForRequest(requestId);
  if (svc && askLinks.length > 0) {
    // Reconstruct enough of the request to render the footer. We
    // store kind in the link row; everything else needed by the
    // formatter is in the `response` + a synthetic title pulled
    // back from the original message text would be costly to fetch.
    // Use a lightweight stub — the footer template only reads
    // title + attribution, and we don't know either at this point.
    // Reasonable simplification: render a footer-only edit (no
    // strike-through over the original title). This still removes
    // the buttons + stamps the answer on top of the original body
    // because we render with a fresh template.
    const stubRequest: import("../shared/types").AskUserRequest = {
      request_id: requestId,
      surface_id: "",
      kind: askLinks[0]!.kind as import("../shared/types").AskUserKind,
      title: requestTitleCache.get(requestId) ?? "Question",
      created_at: 0,
    };
    const text = formatResolutionFooter(stubRequest, response);
    for (const link of askLinks) {
      // No replyMarkup → buttons disappear from the message.
      void svc.editMessage(
        link.chatId,
        link.tgMessageId,
        text,
        undefined,
        "MarkdownV2",
      );
    }
  }
  // For text requests we don't edit — Telegram's force_reply
  // prompt is replaced by the user's reply itself in the chat
  // flow, so editing it would just add noise.
  telegramDb.dropAllLinksForRequest(requestId);
  requestTitleCache.delete(requestId);
}

/** Tiny in-memory cache of (request_id → title) populated when we
 *  fan out, consumed when we edit on resolution. Avoids round-
 *  tripping through SQLite for a one-line string we already have
 *  in hand at fan-out time. */
const requestTitleCache = new Map<string, string>();

/** Plan #10 commit B — dispatch a parsed `ask|<id>|<value>`
 *  callback. Looks up the request kind from the link row, applies
 *  the kind-specific value semantics, and resolves the queue (or
 *  edits the message in place for the confirm-command "ack" step
 *  that reveals the run gate). */
async function handleAskCallback(
  info: {
    callbackQueryId: string;
    fromUserId: string;
    fromName: string;
    chatId: string;
    messageId: number;
    data: string;
  },
  cb: { requestId: string; value: string },
): Promise<void> {
  const link = telegramDb.getAskUserLink(info.chatId, info.messageId);
  if (!link) {
    console.warn(
      `[telegram] ask callback ignored — no link for chat=${info.chatId} msg=${info.messageId}`,
    );
    return;
  }
  console.log(
    `[telegram] ask callback action=${cb.value} from=${info.fromName}(${info.fromUserId}) request=${cb.requestId}`,
  );
  const value = cb.value;
  // Confirm-command "ack" — reveal the run gate by editing the
  // message in place; do NOT resolve the queue.
  if (link.kind === "confirm-command" && value === "ack") {
    const svc = telegramService;
    if (!svc) return;
    const stub: import("../shared/types").AskUserRequest = {
      request_id: cb.requestId,
      surface_id: "",
      kind: "confirm-command",
      title: requestTitleCache.get(cb.requestId) ?? "Confirm",
      created_at: 0,
    };
    const markup = buildButtonsForKind(stub, { confirmRevealed: true });
    const text = formatQuestionForTelegram(stub, {});
    void svc.editMessage(
      info.chatId,
      info.messageId,
      // Re-stamp the prompt with a warning emphasis on the body.
      text + "\n\n*\\!\\!\\! Tap Run to execute the destructive action\\.*",
      markup,
      "MarkdownV2",
    );
    return;
  }
  if (value === "cancel") {
    socketHandler("agent.ask_cancel", {
      request_id: cb.requestId,
      reason: `cancelled by ${info.fromName} via Telegram`,
    });
    return;
  }
  // Everything else is an answer. Map kind-specific tokens back to
  // the canonical answer values per AskUserResponse semantics.
  let answerValue = value;
  if (link.kind === "yesno") {
    answerValue = value === "yes" ? "yes" : value === "no" ? "no" : value;
  } else if (link.kind === "confirm-command") {
    if (value === "run") answerValue = "run";
    else return; // unknown token; ignore
  }
  socketHandler("agent.ask_answer", {
    request_id: cb.requestId,
    value: answerValue,
  });
}

async function handleTelegramCallback(info: {
  callbackQueryId: string;
  fromUserId: string;
  fromName: string;
  chatId: string;
  messageId: number;
  data: string;
}): Promise<void> {
  // Plan #10 commit B — ask|<id>|<value> wins routing first; the
  // notification dispatch below is the fallback for the legacy
  // ok/continue/stop family.
  const askCb = parseAskCallbackData(info.data);
  if (askCb) {
    await handleAskCallback(info, askCb);
    return;
  }
  const link = telegramDb.getNotificationLink(info.chatId, info.messageId);
  if (!link) {
    console.warn(
      `[telegram] callback ${info.data} ignored — no link for chat=${info.chatId} msg=${info.messageId}`,
    );
    return;
  }
  const sepIdx = info.data.indexOf("|");
  const action = sepIdx === -1 ? info.data : info.data.slice(0, sepIdx);
  console.log(
    `[telegram] callback action=${action} from=${info.fromName}(${info.fromUserId}) notif=${link.notificationId} surface=${link.surfaceId ?? "(none)"}`,
  );
  try {
    if (action === "ok") {
      socketHandler("notification.dismiss", { id: link.notificationId });
    } else if (action === "continue") {
      if (!link.surfaceId) return;
      socketHandler("surface.send_text", {
        surface_id: link.surfaceId,
        text: "\n",
      });
    } else if (action === "stop") {
      if (!link.surfaceId) return;
      socketHandler("surface.send_key", {
        surface_id: link.surfaceId,
        key: "ctrl+c",
      });
    } else {
      console.warn(`[telegram] callback action unknown: ${action}`);
    }
  } catch (err) {
    console.warn(
      `[telegram] callback dispatch failed: ${(err as Error).message}`,
    );
  }
}

/** Stash for the "enabled but no token" failure state so the sidebar
 *  + settings panel can tell the user WHY the service isn't running
 *  instead of silently reporting "disabled" (which looks the same as
 *  "user switched it off"). Read by `buildTelegramStatePayload`. */
let telegramMisconfigured: TelegramServiceStatus | null = null;

async function applyTelegramSettings(): Promise<void> {
  const s = settingsManager.get();

  // Always tear down the existing service first so a token change or
  // an enable→disable→enable cycle rebuilds cleanly.
  if (telegramService) {
    await telegramService.stop();
    telegramService = null;
  }

  if (!s.telegramEnabled) {
    telegramMisconfigured = null;
    health.set("telegram", "disabled", "Telegram not enabled in settings");
    broadcastTelegramState();
    return;
  }

  if (!s.telegramBotToken || s.telegramBotToken.length === 0) {
    // User asked for the service to run but hasn't supplied a token.
    // Previously we silently did nothing; the sidebar showed "Disabled"
    // and there was no clue. Now we surface the misconfiguration so the
    // UI can guide the user to paste a token.
    telegramMisconfigured = {
      state: "error",
      error: "enabled but no bot token — add one in Settings → Telegram",
    };
    console.warn(
      "[telegram] enabled but no bot token configured — see Settings → Telegram",
    );
    health.set(
      "telegram",
      "error",
      "Telegram enabled but no bot token configured",
    );
    broadcastTelegramState();
    return;
  }

  telegramMisconfigured = null;
  telegramService = new TelegramService({
    token: s.telegramBotToken,
    allowedUserIds: s.telegramAllowedUserIds,
    db: telegramDb,
    onIncoming: (message, extra) => {
      broadcastTelegramMessage(wireTelegramMessage(message));
      // Plan #10 commit B — route a force_reply answer back into
      // the AskUserQueue when the inbound message replies to one
      // of our ask-user prompts. Falls through silently for normal
      // chat messages.
      if (extra?.replyToMessageId !== undefined) {
        const link = telegramDb.getTextReplyLink(
          message.chatId,
          extra.replyToMessageId,
        );
        if (link) {
          console.log(
            `[telegram] text reply routed to ask request=${link.requestId}`,
          );
          socketHandler("agent.ask_answer", {
            request_id: link.requestId,
            value: message.text,
          });
        }
      }
    },
    onCallback: (info) => {
      void handleTelegramCallback(info);
    },
    onStatus: (status) => {
      broadcastTelegramState();
      // Mirror the service state machine into the health registry so
      // `system.health` and `ht health` reflect Telegram's actual
      // condition without polling. `polling` is fully ok; transient
      // states (`starting` / `conflict`) are degraded; `error` lights
      // a hard failure with the upstream reason.
      switch (status.state) {
        case "polling":
          health.set(
            "telegram",
            "ok",
            status.botUsername
              ? `Polling as @${status.botUsername}`
              : "Polling",
          );
          break;
        case "starting":
          health.set("telegram", "degraded", "Starting up");
          break;
        case "conflict":
          health.set(
            "telegram",
            "degraded",
            "Conflict — another consumer is using getUpdates",
          );
          break;
        case "error":
          health.set(
            "telegram",
            "error",
            status.error ?? "Telegram service error",
          );
          break;
        case "disabled":
          health.set("telegram", "disabled", "Telegram service stopped");
          break;
      }
    },
    onLog: (level, msg) => {
      if (level === "error" || level === "warn") {
        console.warn(`[telegram] ${msg}`);
      }
    },
  });
  telegramService.start();
  broadcastTelegramState();
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
    metadataPoller.getSnapshot(app.focusedSurfaceId ?? "")?.cwd ??
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

  app.focusedSurfaceId = agent.id;
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
  const splitFrom = app.focusedSurfaceId;
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

  app.focusedSurfaceId = agent.id;
  sendWebviewAction("agentSurfaceCreated", {
    surfaceId: agent.id,
    agentId: agent.id,
    splitFrom: splitFrom ?? undefined,
    direction,
  });
  void agent.start();
}

function renameActiveWorkspace(): void {
  const activeWorkspace = app.getActiveWorkspace();
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
        (data as { surfaceId?: string })?.surfaceId ?? app.focusedSurfaceId;
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
        renameSurface(app.focusedSurfaceId);
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
    case MENU_ACTIONS.revealLogFile:
      revealLogFile();
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

/** Open Finder with the active log file selected. Falls back to a
 *  toast when the file tee never opened (read-only home, etc) so the
 *  user understands why nothing happened. */
function revealLogFile(): void {
  const path = loggerHandle.currentPath;
  if (!path) {
    toast(
      "Log file unavailable — the app could not open its log directory.",
      "warning",
    );
    return;
  }
  // `open -R` reveals the file in Finder rather than opening it in
  // Console.app, which is what the menu label promises. macOS-only;
  // the app is macOS-only too.
  const proc = Bun.spawnSync(["/usr/bin/open", "-R", path]);
  if (proc.exitCode !== 0) {
    toast(`Could not reveal log file: ${path}`, "error");
  }
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
  const surfaceId = app.focusedSurfaceId;
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
  const running = app.webServer?.running ?? false;
  rpc.send("webServerStatus", {
    running,
    port: app.webServerPort,
    url: running ? `http://localhost:${app.webServerPort}` : undefined,
  });
  // Mirror state into the health registry so `ht health` reflects the
  // mirror's actual status without polling.
  if (running) {
    health.set(
      "web-mirror",
      "ok",
      `Running on http://localhost:${app.webServerPort}`,
    );
  } else {
    health.set("web-mirror", "disabled", "Stopped");
  }
}

function toggleWebServer(): void {
  if (app.webServer?.running) {
    app.webServer.stop();
  } else {
    if (!app.webServer) {
      app.webServer = new WebServer(
        app.webServerPort,
        sessions,
        () => app.getAppState(),
        () => app.focusedSurfaceId,
        () => app.sidebarVisible,
        settingsManager.get().webMirrorBind,
        settingsManager.get().webMirrorAuthToken,
      );
      setupWebServerCallbacks(app.webServer);
    }
    app.webServer.start();
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
  } else if (action === "runScript") {
    // Same flow as the webview-side `runScript` message: spawn a surface
    // in cwd, tag it with launchFor so the sidebar tracks the script as
    // "running", then feed the command into stdin after the login shell
    // finishes async init (zsh ~150ms; 600ms is a safe upper bound).
    const workspaceId = payload["workspaceId"] as string | undefined;
    const cwd = payload["cwd"] as string | undefined;
    const command = payload["command"] as string | undefined;
    const scriptKey = payload["scriptKey"] as string | undefined;
    if (workspaceId && cwd && command && scriptKey) {
      const surfaceId = sessions.createSurface(80, 24, cwd);
      const title = sessions.getSurface(surfaceId)?.title ?? "shell";
      rpc.send("surfaceCreated", {
        surfaceId,
        title,
        launchFor: { workspaceId, scriptKey },
      });
      broadcastSurfaceCreated(surfaceId, title);
      setTimeout(() => {
        sessions.writeStdin(surfaceId, command + "\n");
      }, 600);
    }
  } else if (action === "renameSurface") {
    const surfaceId = payload["surfaceId"];
    const title = payload["title"];
    if (typeof surfaceId === "string" && typeof title === "string" && title) {
      sessions.renameSurface(surfaceId, title);
      const workspace = app.workspaceState.find((ws) =>
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
    // Broadcast notification events to web clients. The dispatch
    // payload discriminates on which kind of change happened:
    //   - `latest`: a new notification was created
    //   - `dismissed`: a single notification was removed by id
    //   - `notifications: []`: the whole list was cleared
    const notifications = payload["notifications"] as unknown[] | undefined;
    const latest = payload["latest"] as Record<string, unknown> | undefined;
    const dismissed = payload["dismissed"] as string | undefined;
    if (latest) {
      app.webServer?.broadcast({
        type: "notification",
        id: latest["id"] ?? "",
        surfaceId: latest["surfaceId"] ?? null,
        title: latest["title"] ?? "",
        body: latest["body"] ?? "",
      });
      // Phase 2: forward to Telegram when the user opted in. The plan
      // function is pure — it returns the {chatId, text} deliveries to
      // perform; we just wire them through sendTelegramAndBroadcast so
      // the live service handles rate limiting + persistence.
      // Plan #08: when `telegramNotificationButtonsEnabled` is on,
      // route through the buttons-aware send so each forwarded
      // notification carries OK / Continue / Stop and persists a
      // notification_links row for the inbound callback handler.
      if (telegramService) {
        const settings = settingsManager.get();
        const surfaceId = (latest["surfaceId"] as string | null) ?? null;
        const ws = surfaceId
          ? (app.workspaceState.find((w) => w.surfaceIds.includes(surfaceId)) ??
            null)
          : null;
        const deliveries = planNotificationForwarding({
          enabled: settings.telegramNotificationsEnabled,
          allowedUserIds: settings.telegramAllowedUserIds,
          title: String(latest["title"] ?? ""),
          body: String(latest["body"] ?? ""),
          workspace: ws?.name ?? undefined,
          pane: (ws?.surfaceTitles?.[surfaceId ?? ""] as string) ?? undefined,
        });
        const notificationId = String(latest["id"] ?? "");
        const buttonsOn =
          settings.telegramNotificationButtonsEnabled && !!notificationId;
        for (const { chatId, text } of deliveries) {
          if (buttonsOn) {
            void sendTelegramNotificationWithButtons({
              chatId,
              text,
              notificationId,
              surfaceId,
            });
          } else {
            void sendTelegramAndBroadcast(chatId, text);
          }
        }
      }
    } else if (dismissed) {
      app.webServer?.broadcast({ type: "notificationDismiss", id: dismissed });
    } else if (notifications && notifications.length === 0) {
      app.webServer?.broadcast({ type: "notificationClear" });
    }
  } else if (
    action === "setStatus" ||
    action === "clearStatus" ||
    action === "setProgress" ||
    action === "clearProgress" ||
    action === "log"
  ) {
    app.webServer?.broadcast({ type: "sidebarAction", action, payload });
    if (action === "setStatus") {
      const key = payload["key"];
      if (
        typeof key === "string" &&
        key.length > 0 &&
        !app.htKeysSeen.has(key)
      ) {
        app.htKeysSeen.add(key);
        scheduleHtKeysSeenBroadcast();
      }
    }
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

// Webview round-trip: send a socketAction with a reqId and wait for the
// matching response message. Used for readScreen today; kept generic so new
// read-style APIs (panel.list, Tier 2 `__test.*`, …) can reuse the same
// plumbing without inventing a second pending map. The result is unknown
// because webviewResponse carries arbitrary JSON — readScreenResponse
// always resolves to a string for back-compat.

const pendingReads = new Map<string, (value: any) => void>();

async function requestWebview(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const reqId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return new Promise<unknown>((resolve) => {
    pendingReads.set(reqId, resolve);
    rpc.send("socketAction", {
      action: method,
      payload: { ...params, reqId },
    });
    setTimeout(() => {
      if (pendingReads.has(reqId)) {
        pendingReads.delete(reqId);
        // `readScreen` callers expect "" on timeout; every other method
        // treats `null` as "no response". Use null here and let the
        // surface.read_text handler coerce, if needed.
        resolve(method === "readScreen" ? "" : null);
      }
    }, 3000);
  });
}

// Socket path is computed before createRpcHandler so the dispatcher can
// expose it via `system.identify`. Bun resolves the path once; both the
// RPC handler and the SocketServer share the same constant so external
// tooling (`ht identify`) can never disagree with what was actually
// bound.
const socketPath = join(configDir, "hyperterm.sock");
// Ensure the config directory exists before binding the socket
if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
// Expose path to child shells so the `ht` CLI can locate the server
process.env["HT_SOCKET_PATH"] = socketPath;

// Audit registry — rebuilt from settings on demand so a flipped
// `auditsGitUserNameExpected` adds / removes the audit without a
// restart. The cached `lastAuditResults` powers `audit.list` so the
// CLI / future sidebar banner can read without re-shelling-out.
let cachedAudits: Audit[] = defaultAudits({
  gitUserNameExpected: settingsManager.get().auditsGitUserNameExpected,
});
let lastAuditResults: AuditResult[] = [];
function rebuildAudits(): void {
  cachedAudits = defaultAudits({
    gitUserNameExpected: settingsManager.get().auditsGitUserNameExpected,
  });
}

const socketHandler = createRpcHandler(
  sessions,
  () => app.getAppState(),
  dispatch,
  requestWebview,
  metadataPoller,
  browserSurfaces,
  browserHistory,
  pendingBrowserEvals,
  cookieStore,
  {
    panelRegistry,
    piAgentManager,
    shutdown: () => gracefulShutdown(),
    testModeEnabled: HT_TEST_MODE,
    telegramDb,
    getTelegramService: () => telegramService ?? undefined,
    restartTelegramService: () => applyTelegramSettings(),
    socketPath,
    logPath: loggerHandle.currentPath,
    audits: {
      getAudits: () => cachedAudits,
      getLast: () => lastAuditResults,
      setLast: (results) => {
        lastAuditResults = results;
      },
    },
    health,
    plans,
    askUser,
  },
);
const socketServer = new SocketServer(socketPath, socketHandler);
socketServer.start();
// Health: socket lifecycle. SocketServer logs binding errors itself
// (it doesn't throw) so by the time we reach this point either the
// listener is up or it failed silently and `ht` will be unreachable.
// We assume up; if a future refactor adds a real `bound` getter we'll
// flip to consulting it.
health.set("socket", "ok", `Bound to ${socketPath}`);

// Run audits once at startup. Cheap (one git invocation) and gives
// the user a canary against wrong-config drift right at boot. Logged
// at warn level when something flags so the log file (Plan #01) shows
// it even when no UI is consuming yet. Each result also pushes a
// health row keyed by the audit id so `ht health` surfaces failing
// canaries alongside the rest of the subsystem state.
void runAudits(cachedAudits).then((results) => {
  lastAuditResults = results;
  for (const r of results) {
    if (r.ok) {
      console.log(`[audit] ${r.id}: ${r.message}`);
    } else {
      console.warn(`[audit] ${r.id}: ${r.message}`);
    }
    const sev =
      r.severity === "info"
        ? "ok"
        : r.severity === "warn"
          ? "degraded"
          : "error";
    health.set(`audit:${r.id}`, sev, r.message);
  }
  if (cachedAudits.length === 0) {
    health.set("audits", "disabled", "No audits configured");
  }
});

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
    app.sidebarVisible = visible;
    // Forward to native webview (set-state, not toggle)
    rpc.send("socketAction", {
      action: "setSidebar",
      payload: { visible },
    });
  };
  ws.onSelectWorkspace = (workspaceId) => {
    dispatch("selectWorkspace", { workspaceId });
  };
  ws.onFocusSurface = (surfaceId) => {
    app.focusedSurfaceId = surfaceId;
    // Tell native webview to focus this surface
    sendWebviewAction("focusSurface", { surfaceId });
    // Broadcast to all web clients
    ws.broadcast({ type: "focusChanged", surfaceId });
  };
  ws.onClearNotifications = () => {
    // Clear via the RPC handler which dispatches to native + broadcasts
    socketHandler("notification.clear", {});
  };
  ws.onDismissNotification = (id) => {
    // Same shape as clear — let the RPC handler own the splice + dispatch
    // so native webview + web clients stay in sync on the same id.
    socketHandler("notification.dismiss", { id });
  };
  ws.onTelegramSend = (chatId, text) => {
    void sendTelegramAndBroadcast(chatId, text);
  };
  ws.onTelegramRequestHistory = (chatId, before) => {
    const rows = telegramDb
      .getHistory(chatId, 50, before)
      .map(wireTelegramMessage);
    ws.broadcast({
      type: "telegramHistory",
      chatId,
      messages: rows,
      isLatest: !before,
    });
  };
  ws.onTelegramRequestState = () => {
    ws.broadcast({ type: "telegramState", ...buildTelegramStatePayload() });
  };
}

// Env var (if set) implies explicit opt-in; otherwise honor the user setting.
const autoStartWebMirror = webServerPortEnv
  ? app.webServerPort > 0
  : settingsManager.get().autoStartWebMirror && app.webServerPort > 0;

if (autoStartWebMirror) {
  app.webServer = new WebServer(
    app.webServerPort,
    sessions,
    () => app.getAppState(),
    () => app.focusedSurfaceId,
    () => app.sidebarVisible,
  );
  setupWebServerCallbacks(app.webServer);
  app.webServer.start();
}
sendWebServerStatus();

/** Rebuild the web mirror on a new port. Restarts if it was running. */
function applyWebMirrorPort(newPort: number): void {
  if (webServerPortEnv) return; // env var wins, ignore setting change
  const wasRunning = app.webServer?.running ?? false;
  app.webServer?.stop();
  app.webServer = null;
  app.webServerPort = newPort;
  if (wasRunning && newPort > 0) {
    app.webServer = new WebServer(
      app.webServerPort,
      sessions,
      () => app.getAppState(),
      () => app.focusedSurfaceId,
      () => app.sidebarVisible,
    );
    setupWebServerCallbacks(app.webServer);
    app.webServer.start();
  }
  sendWebServerStatus();
}

// ── Layout Persistence ──

// Layout persists alongside settings / socket under the same configDir so a
// throwaway `HT_CONFIG_DIR` (e2e) sees a clean slate and no cross-test drift.
const layoutDir = configDir;
const layoutFile = join(layoutDir, "layout.json");

function saveLayout(): void {
  if (app.workspaceState.length === 0) return;
  try {
    const persisted: PersistedLayout = {
      activeWorkspaceIndex: app.workspaceState.findIndex(
        (ws) => ws.id === app.activeWorkspaceId,
      ),
      workspaces: app.workspaceState.map((ws) => ({
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
      sidebarVisible: app.sidebarVisible,
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

function scheduleLayoutSave(): void {
  app.scheduleLayoutSave(saveLayout);
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
        app.webServer?.broadcast({
          type: "browserSurfaceCreated",
          surfaceId: newId,
          url,
        });
      } else if (surfType === "telegram") {
        // Telegram panes have no PTY / no remote process — restoring just
        // re-mounts the chat DOM. We mint a fresh surface id so the
        // pane-tree mapping stays consistent with other types.
        const newId = nextTelegramSurfaceId();
        surfaceMapping[oldId] = newId;
        rpc.send("telegramSurfaceCreated", { surfaceId: newId });
        app.webServer?.broadcast({
          type: "telegramSurfaceCreated",
          surfaceId: newId,
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

  app.focusedSurfaceId = Object.values(surfaceMapping)[0] ?? null;
  return true;
}

// Clean up on exit. Both handlers do the same work — order matters:
//   1. Stop background producers (metadata poller) so no new async work
//      starts that could touch state we're about to save.
//   2. Persist durable state (layout, settings, history, cookies).
//   3. Dispose long-lived resources (pi agent, web server, socket, PTY
//      sessions) so their subprocesses get a SIGKILL/close before we
//      call process.exit.
// A safety watchdog exits hard after 2s if any of the above wedge, so a
// broken save path can never prevent shutdown.
async function gracefulShutdown(): Promise<void> {
  const hardExit = setTimeout(() => {
    console.warn("[main] graceful shutdown timed out after 2s; exiting hard");
    process.exit(1);
  }, 2000);
  (hardExit as { unref?: () => void }).unref?.();

  try {
    metadataPoller.stop();
  } catch (err) {
    console.warn("[main] metadataPoller.stop failed:", err);
  }
  // Force-flush the webview's pending `workspaceStateSync` before saving.
  // Without this, a just-made split is trapped in the 100ms debounce and
  // never lands in `app.workspaceState`, which `saveLayout` reads from —
  // next launch restores a stale layout. 500ms is generous; the real
  // round-trip is ~10ms.
  try {
    await Promise.race([
      requestWebview("forceLayoutSync", {}),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);
  } catch (err) {
    console.warn("[main] forceLayoutSync failed:", err);
  }
  try {
    saveLayout();
  } catch (err) {
    console.warn("[main] saveLayout failed:", err);
  }
  try {
    settingsManager.saveNow();
  } catch (err) {
    console.warn("[main] settingsManager.saveNow failed:", err);
  }
  try {
    browserHistory.saveNow();
  } catch (err) {
    console.warn("[main] browserHistory.saveNow failed:", err);
  }
  try {
    cookieStore.saveNow();
  } catch (err) {
    console.warn("[main] cookieStore.saveNow failed:", err);
  }
  try {
    piAgentManager.dispose();
  } catch (err) {
    console.warn("[main] piAgentManager.dispose failed:", err);
  }
  try {
    app.webServer?.stop();
  } catch (err) {
    console.warn("[main] webServer.stop failed:", err);
  }
  try {
    socketServer.stop();
  } catch (err) {
    console.warn("[main] socketServer.stop failed:", err);
  }
  try {
    sessions.destroy();
  } catch (err) {
    console.warn("[main] sessions.destroy failed:", err);
  }
  try {
    await telegramService?.stop();
  } catch (err) {
    console.warn("[main] telegramService.stop failed:", err);
  }
  try {
    telegramDb.close();
  } catch (err) {
    console.warn("[main] telegramDb.close failed:", err);
  }
  clearTimeout(hardExit);
  process.exit(0);
}
process.on("SIGINT", () => void gracefulShutdown());
process.on("SIGTERM", () => void gracefulShutdown());
