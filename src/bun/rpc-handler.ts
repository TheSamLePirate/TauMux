import type { SessionManager } from "./session-manager";
import type { BrowserSurfaceManager } from "./browser-surface-manager";
import type { BrowserHistoryStore } from "./browser-history";
import type { CookieStore } from "./cookie-store";
import type { PanelRegistry } from "./panel-registry";
import type { PiAgentManager } from "./pi-agent-manager";
import type { SurfaceMetadataPoller } from "./surface-metadata";

import type { AppState, Handler, HandlerDeps } from "./rpc-handlers/types";
import { METHOD_SCHEMAS, validateParams } from "./rpc-handlers/shared";
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
import { registerAgent } from "./rpc-handlers/agent";
import { registerBrowserPage } from "./rpc-handlers/browser-page";
import { registerBrowserCookies } from "./rpc-handlers/browser-cookies";
import { registerBrowserDom } from "./rpc-handlers/browser-dom";

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
    notifications: createNotificationStore(),
    panelRegistry: options.panelRegistry,
    piAgentManager: options.piAgentManager,
    shutdown: options.shutdown,
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
