/**
 * Context object passed to every webview-handler registrar.
 *
 * The bun process serves two distinct RPC surfaces:
 *
 *   1. Socket RPC — external CLI / web clients, dispatched by
 *      `createRpcHandler` in `src/bun/rpc-handler.ts`. Handlers live
 *      under `src/bun/rpc-handlers/<domain>.ts` and receive a
 *      `HandlerDeps` bundle.
 *
 *   2. Electrobun webview RPC — bidirectional message channel between
 *      the bun main process and the system WebView. Handlers were
 *      historically inlined into `src/bun/index.ts` (~82 methods,
 *      ~670 lines) inside a `bunMessageHandlers` const guarded by
 *      `satisfies BunMessageHandlers`. They have now been extracted
 *      into per-domain modules under `src/bun/webview-handlers/`.
 *
 * Each domain module exports `register<Name>WebviewHandlers(ctx)`
 * returning a `Partial<BunMessageHandlers>`. `index.ts` merges them
 * with a single object-spread expression that keeps the
 * `satisfies BunMessageHandlers` exhaustiveness check intact.
 *
 * # Lifetime / binding notes
 *
 * Several module-scoped values referenced by the handlers are declared
 * AFTER the `bunMessageHandlers` literal (the Electrobun `rpc` itself,
 * the `autoContinue` engine, the main window, the socket handler, the
 * pending-reply maps, …). The original inline handlers worked because
 * each name was resolved lazily at call time via the lexical closure.
 *
 * To preserve that behaviour without forcing every helper to be defined
 * before the handler factory runs, the late-bound fields on this
 * interface are exposed via getters backed by a small holder object
 * (`createWebviewHandlerContext` in this file). Callers fill the late
 * fields in once their backing values exist; until then the holder
 * throws on access — which is fine because no handler can fire before
 * the Electrobun message pump is wired up.
 *
 * Helper functions are passed by reference. They are function
 * declarations and are hoisted in `index.ts`, so they are guaranteed to
 * be defined by the time `createWebviewHandlerContext` runs.
 */

import type { BrowserView, BrowserWindow } from "electrobun/bun";
import type { AppContext } from "../app-context";
import type { AskUserQueue } from "../ask-user-queue";
import type { AutoContinueEngine } from "../auto-continue-engine";
import type { BrowserHistoryStore } from "../browser-history";
import type { BrowserSurfaceManager } from "../browser-surface-manager";
import type { CookieStore } from "../cookie-store";
import type { PiAgentManager } from "../pi-agent-manager";
import type { ExtensionManager } from "../extension-manager";
import type { SessionManager } from "../session-manager";
import type { SettingsManager } from "../settings-manager";
import type { SurfaceMetadataPoller } from "../surface-metadata";
import type { TelegramDatabase } from "../telegram-db";
import type { TauMuxRPC } from "../../shared/types";
import type { setupLogging } from "../logger";

/** Concrete return type of `BrowserView.defineRPC<TauMuxRPC>`. Kept
 *  inferred rather than re-declared so any future Electrobun bump
 *  flows through automatically. */
export type WebviewRpc = ReturnType<typeof BrowserView.defineRPC<TauMuxRPC>>;

/** The set of message keys the bun side accepts from the webview.
 *  Exactly mirrors `TauMuxRPC["bun"]["messages"]` but expressed as a
 *  handler-shape so that adding a new wire message without a matching
 *  handler produces a compile error via `satisfies BunMessageHandlers`. */
export type BunMessageHandlers = {
  [K in keyof TauMuxRPC["bun"]["messages"]]: TauMuxRPC["bun"]["messages"][K] extends void
    ? () => void | Promise<void>
    : (payload: TauMuxRPC["bun"]["messages"][K]) => void | Promise<void>;
};

/** Per-domain slice of the full handler map. Each `register*` function
 *  declares the exact set of keys it owns, which lets the aggregator
 *  in `index.ts` rely on `satisfies BunMessageHandlers` to detect both
 *  missing keys AND wrong handler signatures. */
export type BunMessageHandlerSlice<K extends keyof BunMessageHandlers> = Pick<
  BunMessageHandlers,
  K
>;

export interface WebviewHandlerContext {
  // ── Early-bound dependencies (available when `createWebviewHandlerContext` runs) ──
  app: AppContext;
  sessions: SessionManager;
  settingsManager: SettingsManager;
  piAgentManager: PiAgentManager;
  browserSurfaces: BrowserSurfaceManager;
  browserHistory: BrowserHistoryStore;
  cookieStore: CookieStore;
  metadataPoller: SurfaceMetadataPoller;
  extensionManager: ExtensionManager;
  telegramDb: TelegramDatabase;
  askUser: AskUserQueue;
  configDir: string;
  loggerHandle: ReturnType<typeof setupLogging>;
  htTestMode: boolean;

  // ── Late-bound dependencies (filled in after their `const` decls) ──
  readonly autoContinue: AutoContinueEngine;
  readonly rpc: WebviewRpc;
  readonly mainWindow: BrowserWindow;
  readonly socketPath: string;
  readonly socketHandler: (
    method: string,
    params: Record<string, unknown>,
  ) => unknown | Promise<unknown>;
  readonly pendingReads: Map<string, (value: unknown) => void>;
  readonly pendingBrowserEvals: Map<string, (value: string) => void>;
  readonly domReadyDebounce: Map<string, ReturnType<typeof setTimeout>>;

  // ── Helper functions ──
  broadcastSurfaceCreated: (surfaceId: string, title: string) => void;
  sendWebviewAction: (
    action: string,
    payload?: Record<string, unknown>,
  ) => void;
  sendWebServerStatus: () => void;
  toggleWebServer: () => void;
  handlePaste: () => Promise<void>;
  tryRestoreLayout: (cols: number, rows: number) => boolean;
  createWorkspaceSurface: (cols: number, rows: number, cwd?: string) => void;
  splitSurface: (
    direction: "horizontal" | "vertical",
    splitFrom?: string | null,
    cwdOverride?: string,
  ) => void;
  createBrowserWorkspaceSurface: (url?: string) => void;
  splitBrowserSurface: (
    direction: "horizontal" | "vertical",
    url?: string,
  ) => void;
  createAgentWorkspaceSurface: (opts: {
    provider?: string;
    model?: string;
    thinkingLevel?: string;
    cwd?: string;
  }) => void;
  splitAgentSurface: (
    direction: "horizontal" | "vertical",
    opts: {
      provider?: string;
      model?: string;
      thinkingLevel?: string;
      cwd?: string;
    },
  ) => void;
  createTelegramWorkspaceSurface: () => void;
  splitTelegramSurface: (direction: "horizontal" | "vertical") => void;
  createEditorWorkspaceSurface: (
    path?: string,
    cwd?: string,
    create?: boolean,
  ) => void;
  splitEditorSurface: (
    direction: "horizontal" | "vertical",
    path?: string,
    cwd?: string,
    create?: boolean,
  ) => void;
  createExtensionWorkspaceSurface: (extensionId: string) => void;
  splitExtensionSurface: (
    direction: "horizontal" | "vertical",
    extensionId: string,
  ) => void;
  sendTelegramAndBroadcast: (
    chatId: string,
    text: string,
    opts?: { allowUnknownChat?: boolean },
  ) => Promise<void>;
  sendTelegramStateToWebview: () => void;
  scheduleLayoutSave: () => void;
  listPiSessions: () => Array<Record<string, unknown>>;
  readPiSessionTree: (sessionPath?: string) => Array<Record<string, unknown>>;
  applyWebMirrorPort: (port: number) => void;
  /** Recreate the running web mirror (needed for a bind-address change —
   *  a live listener can't be rebound). No-op when not running. */
  restartWebMirror: () => void;
  /** Apply an auth-token change to the live web mirror without a restart. */
  setWebMirrorAuthToken: (token: string) => void;
  applyTelegramSettings: () => Promise<void>;
  rebuildAudits: () => void;
  runAndPublishAudits: () => Promise<void>;
  revealLogFile: () => void;
  dispatch: (action: string, payload: Record<string, unknown>) => void;
}

/** Late-bound fields filled in after the corresponding `const` is
 *  initialised. Kept separate from the early-bound bag so the call
 *  sites can't accidentally feed a half-constructed dep through. */
export interface WebviewHandlerLateBindings {
  autoContinue: AutoContinueEngine;
  rpc: WebviewRpc;
  mainWindow: BrowserWindow;
  socketPath: string;
  socketHandler: (
    method: string,
    params: Record<string, unknown>,
  ) => unknown | Promise<unknown>;
  pendingReads: Map<string, (value: unknown) => void>;
  pendingBrowserEvals: Map<string, (value: string) => void>;
  domReadyDebounce: Map<string, ReturnType<typeof setTimeout>>;
}

/** Build a `WebviewHandlerContext` whose late-bound fields are exposed
 *  as getters reading from a small holder object. Returns the context
 *  plus a single `setLateBindings` callback the host invokes after the
 *  corresponding `const` declarations have run.
 *
 *  Property access on a late field before `setLateBindings` has been
 *  called throws — an explicit fail-fast that is impossible to hit at
 *  runtime because no handler can fire before the Electrobun message
 *  pump is wired up by `BrowserView.defineRPC(...)`. */
export function createWebviewHandlerContext(
  base: Omit<WebviewHandlerContext, keyof WebviewHandlerLateBindings>,
): {
  ctx: WebviewHandlerContext;
  setLateBindings: (late: WebviewHandlerLateBindings) => void;
} {
  const holder: Partial<WebviewHandlerLateBindings> = {};
  const need = <K extends keyof WebviewHandlerLateBindings>(
    key: K,
  ): WebviewHandlerLateBindings[K] => {
    const value = holder[key];
    if (value === undefined) {
      throw new Error(
        `[webview-handlers] late binding "${String(key)}" accessed before initialisation`,
      );
    }
    return value as WebviewHandlerLateBindings[K];
  };
  const ctx = {
    ...base,
    get autoContinue() {
      return need("autoContinue");
    },
    get rpc() {
      return need("rpc");
    },
    get mainWindow() {
      return need("mainWindow");
    },
    get socketPath() {
      return need("socketPath");
    },
    get socketHandler() {
      return need("socketHandler");
    },
    get pendingReads() {
      return need("pendingReads");
    },
    get pendingBrowserEvals() {
      return need("pendingBrowserEvals");
    },
    get domReadyDebounce() {
      return need("domReadyDebounce");
    },
  } as WebviewHandlerContext;
  return {
    ctx,
    setLateBindings: (late) => {
      Object.assign(holder, late);
    },
  };
}
