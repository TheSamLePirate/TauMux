import type { SessionManager } from "./session-manager";
import type { BrowserSurfaceManager } from "./browser-surface-manager";
import type { BrowserHistoryStore } from "./browser-history";
import type { CookieStore } from "./cookie-store";
import type { PanelRegistry } from "./panel-registry";
import type { PiAgentManager } from "./pi-agent-manager";
import type { SurfaceMetadataPoller } from "./surface-metadata";

import type { AppState, Handler, HandlerDeps } from "./rpc-handlers/types";
import { METHOD_SCHEMAS, validateParams } from "./rpc-handlers/shared";
import { type AuditRegistryHandle, registerAudit } from "./rpc-handlers/audit";
import { registerPlan } from "./rpc-handlers/plan";
import {
  registerAutoContinue,
  type AutoContinueDeps,
} from "./rpc-handlers/auto-continue";
import type { PlanStore } from "./plan-store";
import { registerAskUser } from "./rpc-handlers/ask-user";
import type { AskUserQueue } from "./ask-user-queue";
import { registerSystem } from "./rpc-handlers/system";
import { registerWorkspace } from "./rpc-handlers/workspace";
import { registerSurface } from "./rpc-handlers/surface";
import { registerSidebar } from "./rpc-handlers/sidebar";
import { registerPane } from "./rpc-handlers/pane";
import { registerPanel } from "./rpc-handlers/panel";
import { registerScript } from "./rpc-handlers/script";
import { registerTestHandlers } from "./rpc-handlers/__test";
import {
  createNotificationStore,
  registerNotification,
} from "./rpc-handlers/notification";
import type { Notification } from "./rpc-handlers/types";
import { registerAgent } from "./rpc-handlers/agent";
import { registerBrowserPage } from "./rpc-handlers/browser-page";
import { registerBrowserCookies } from "./rpc-handlers/browser-cookies";
import { registerBrowserDom } from "./rpc-handlers/browser-dom";
import { registerTelegram } from "./rpc-handlers/telegram";
import type { TelegramService } from "./telegram-service";
import type { TelegramDatabase } from "./telegram-db";

export type { AppState, WorkspaceSnapshot } from "./rpc-handlers/types";

/**
 * Build a JSON-RPC dispatcher for the socket + webview surfaces.
 *
 * Each domain (system, workspace, surface, sidebar, pane, notification,
 * agent, browser-*) lives in its own file under `rpc-handlers/` and
 * exposes a `register(deps)` function that returns a method-name →
 * handler map. The aggregator merges them, layers on schema validation
 * and an audit log, and returns the final dispatch function.
 *
 * Adding a method: add it to the relevant domain file. No changes here
 * unless a new domain gets its own file.
 */
export interface RpcHandlerOptions {
  panelRegistry?: PanelRegistry;
  /** Pi agent manager, passed through to `agent.*` handlers for list/close
   *  observability. Omitted in processes that don't own agents. */
  piAgentManager?: PiAgentManager;
  /** Callback to trigger a graceful shutdown (wired to `system.shutdown`). */
  shutdown?: () => void;
  /** Tier 2 gate. When true, `__test.*` handlers are registered; when false
   *  they are stripped from the dispatch map entirely. */
  testModeEnabled?: boolean;
  /** Live accessor for the long-poll Telegram bot service. Thunk so the
   *  registry sees the freshest instance after a settings change. */
  getTelegramService?: () => TelegramService | undefined;
  /** Tear down + recreate the Telegram service. Wired into the
   *  `telegram.restart` RPC. */
  restartTelegramService?: () => Promise<void>;
  /** SQLite log used by `telegram.history` / `telegram.chats`. */
  telegramDb?: TelegramDatabase;
  /** Absolute socket path the SocketServer is bound to. Defaults to
   *  the legacy `/tmp/hyperterm.sock` placeholder so test fixtures that
   *  do not exercise the socket can keep their existing setup; the real
   *  app must pass the bound path so `system.identify` reports truth. */
  socketPath?: string;
  /** Absolute path of the active log file. Pass null (or omit) when the
   *  caller has no log tee — `system.identify` will report null too. */
  logPath?: string | null;
  /** Audit registry — exposes the audit list + last-results cache so
   *  the `audit.*` RPC handlers can read/run/fix without owning the
   *  state. Omit when the caller (e.g. unit tests) doesn't need
   *  audits; the registry handlers will not be installed. */
  audits?: AuditRegistryHandle;
  /** Health aggregator. When wired, `system.health` returns the
   *  current snapshot. */
  health?: import("./health").HealthRegistry;
  /** Plan #09 — when wired, `plan.*` handlers register and the
   *  CLI / agents can publish multi-step plans into the store.
   *  Optional in test fixtures that don't need plan handlers. */
  plans?: PlanStore;
  /** Plan #10 — when wired, `agent.ask_*` handlers register and
   *  the queue holds pending agent → user questions. Optional in
   *  test fixtures. */
  askUser?: AskUserQueue;
  /** Plan #09 commit B — fired by the notification handler after
   *  every `notification.create`. The host wires this to the auto-
   *  continue engine so turn-end notifications drive a continue/wait
   *  decision without polling. Optional in tests. */
  onNotificationCreate?: (notification: Notification) => void;
  /** Plan #09 commit C — when wired, `autocontinue.*` handlers
   *  register and `ht autocontinue` plus the Settings panel can
   *  drive the engine. Optional in tests. */
  autoContinue?: AutoContinueDeps;
}

export function createRpcHandler(
  sessions: SessionManager,
  getState: () => AppState,
  dispatch: (action: string, payload: Record<string, unknown>) => void,
  requestWebview?: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>,
  metadataPoller?: SurfaceMetadataPoller,
  browserSurfaces?: BrowserSurfaceManager,
  browserHistory?: BrowserHistoryStore,
  pendingBrowserEvals?: Map<string, (v: string) => void>,
  cookieStore?: CookieStore,
  options: RpcHandlerOptions = {},
): (
  method: string,
  params: Record<string, unknown>,
) => unknown | Promise<unknown> {
  const deps: HandlerDeps = {
    sessions,
    getState,
    dispatch,
    requestWebview,
    metadataPoller,
    browserSurfaces,
    browserHistory,
    pendingBrowserEvals,
    cookieStore,
    notifications: {
      ...createNotificationStore(),
      onCreate: options.onNotificationCreate,
    },
    panelRegistry: options.panelRegistry,
    piAgentManager: options.piAgentManager,
    shutdown: options.shutdown,
    getTelegramService: options.getTelegramService,
    restartTelegramService: options.restartTelegramService,
    telegramDb: options.telegramDb,
    socketPath: options.socketPath ?? "/tmp/hyperterm.sock",
    logPath: options.logPath ?? null,
    health: options.health,
    autoContinueEngine: options.autoContinue?.engine,
  };

  // `system.capabilities` needs to know the full registered surface —
  // pass it a thunk so it resolves at call time, after every domain's
  // handlers have been merged.
  const methods: Record<string, Handler> = {};
  const allMethodNames = () => Object.keys(methods);

  Object.assign(
    methods,
    registerSystem(deps, allMethodNames),
    registerWorkspace(deps),
    registerSurface(deps),
    registerSidebar(deps),
    registerPane(deps),
    registerPanel(deps),
    registerScript(deps),
    registerTestHandlers(deps, { enabled: options.testModeEnabled === true }),
    registerNotification(deps),
    registerAgent(deps),
    registerBrowserPage(deps),
    registerBrowserCookies(deps),
    registerBrowserDom(deps),
    registerTelegram(deps),
    options.audits ? registerAudit(deps, options.audits) : {},
    options.plans ? registerPlan(deps, options.plans) : {},
    options.askUser ? registerAskUser(deps, options.askUser) : {},
    options.autoContinue
      ? registerAutoContinue(deps, options.autoContinue)
      : {},
  );

  return (method: string, params: Record<string, unknown>) => {
    // Schema check runs first, before any side effects. Only sensitive
    // methods have schemas registered; everything else falls through
    // unchanged so we keep backwards compat with the broad existing
    // API surface.
    const schema = METHOD_SCHEMAS[method];
    if (schema) validateParams(method, schema, params);

    // Audit log: one line per call with the size of the params payload
    // and the method name. No param contents — they may include tokens
    // or user text. Written to stderr at debug level so it's trivially
    // filterable but off-by-default in production via LOG_RPC=0.
    if (process.env["LOG_RPC"] !== "0") {
      try {
        const size = JSON.stringify(params ?? {}).length;
        console.debug(`[rpc] ${method} paramBytes=${size}`);
      } catch {
        /* params not serializable — ignore */
      }
    }

    const handler = methods[method];
    if (!handler) throw new Error(`Unknown method: ${method}`);
    return handler(params);
  };
}
