import type { BrowserHistoryStore } from "../browser-history";
import type { BrowserSurfaceManager } from "../browser-surface-manager";
import type { CookieStore } from "../cookie-store";
import type { PanelRegistry } from "../panel-registry";
import type { PiAgentManager } from "../pi-agent-manager";
import type { SessionManager } from "../session-manager";
import type { SurfaceMetadataPoller } from "../surface-metadata";
import type { TelegramService } from "../telegram-service";
import type { TelegramDatabase } from "../telegram-db";
import type { PaneNode } from "../../shared/types";

export interface AppState {
  focusedSurfaceId: string | null;
  workspaces: WorkspaceSnapshot[];
  activeWorkspaceId: string | null;
}

export interface WorkspaceSnapshot {
  id: string;
  name: string;
  color: string;
  surfaceIds: string[];
  focusedSurfaceId: string | null;
  layout: PaneNode;
  /** Persisted display title per surface id (pane rename). */
  surfaceTitles?: Record<string, string>;
  /** Live cwd per surface; persisted so restarts reopen shells in place. */
  surfaceCwds?: Record<string, string>;
  /** User-pinned cwd that drives the sidebar package.json card. */
  selectedCwd?: string;
  /** Persisted URL per browser surface id for restore. */
  surfaceUrls?: Record<string, string>;
  /** Surface type per surface id (only stored for "browser" or "agent"). */
  surfaceTypes?: Record<string, "terminal" | "browser" | "agent" | "telegram">;
}

export type Handler = (
  params: Record<string, unknown>,
) => unknown | Promise<unknown>;

export interface Notification {
  id: string;
  title: string;
  subtitle?: string;
  body: string;
  time: number;
  surfaceId?: string;
}

/** Mutable notification list owned by the aggregator and shared with
 *  the notification handlers. Kept as a plain object so registers can
 *  read + append without needing an abstraction. */
export interface NotificationStore {
  list: Notification[];
  counter: number;
}

/** Everything a handler module needs to serve requests. Populated once
 *  by `createRpcHandler` and passed unchanged to every register(). */
export interface HandlerDeps {
  sessions: SessionManager;
  getState: () => AppState;
  dispatch: (action: string, payload: Record<string, unknown>) => void;
  requestWebview?: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
  metadataPoller?: SurfaceMetadataPoller;
  browserSurfaces?: BrowserSurfaceManager;
  browserHistory?: BrowserHistoryStore;
  pendingBrowserEvals?: Map<string, (v: string) => void>;
  cookieStore?: CookieStore;
  notifications: NotificationStore;
  /** Bun-side mirror of the webview's per-surface panel state. Populated
   *  by the sideband meta tap; consumed by the `panel.list` RPC. */
  panelRegistry?: PanelRegistry;
  /** Pi agent manager — exposed for read-only `agent.*` handlers so tests
   *  and external clients can observe agent state without reaching into
   *  the webview. */
  piAgentManager?: PiAgentManager;
  /** Initiate a graceful shutdown. Wired to `system.shutdown`. */
  shutdown?: () => void;
  /** Live accessor for the long-poll Telegram bot service. Returns the
   *  current instance, or `undefined` when the user has not enabled
   *  Telegram. Defined as a thunk because the underlying instance is
   *  recreated on token / enabled changes — handlers must always read
   *  the freshest reference. */
  getTelegramService?: () => TelegramService | undefined;
  /** SQLite log behind the Telegram service. Always defined when the
   *  bot integration is wired in, used by the read-side RPC even when
   *  the long-poll loop is off. */
  telegramDb?: TelegramDatabase;
  /** Absolute path the socket server is bound to. Surfaced via
   *  `system.identify` so external tooling sees the real path instead
   *  of the historical `/tmp/hyperterm.sock` placeholder. */
  socketPath: string;
  /** Absolute path of the active log file (rotates daily; null when the
   *  file tee is disabled — read-only home, missing perms, etc). Surfaced
   *  via `system.identify` so the CLI can point at it without re-deriving
   *  the platform path. */
  logPath: string | null;
}
