import type { BrowserHistoryStore } from "./browser-history";
import type { BrowserSurfaceManager } from "./browser-surface-manager";
import type { CookieStore } from "./cookie-store";
import type { PiAgentManager } from "./pi-agent-manager";
import type { SessionManager } from "./session-manager";
import type { SettingsManager } from "./settings-manager";
import type { SurfaceMetadataPoller } from "./surface-metadata";
import type { WebServer } from "./web-server";
import type { AppState, WorkspaceSnapshot } from "./rpc-handler";

export interface AppContextOptions {
  configDir: string;
  sessions: SessionManager;
  piAgents: PiAgentManager;
  browserSurfaces: BrowserSurfaceManager;
  browserHistory: BrowserHistoryStore;
  cookieStore: CookieStore;
  metadataPoller: SurfaceMetadataPoller;
  settings: SettingsManager;
  webServerPort: number;
}

/**
 * Central holder of runtime state and long-lived managers.
 *
 * Before this existed, these fields were module-level `let` bindings in
 * `src/bun/index.ts`, which made the RPC handlers implicitly depend on
 * globals and blocked unit testing of the orchestration logic. Passing
 * an `AppContext` through instead lets a test stand up a fake of every
 * subsystem without booting Electrobun.
 *
 * This class deliberately contains no RPC, window, or socket wiring —
 * those are Electrobun-specific concerns that stay in `index.ts`. The
 * context is a plain state + dependency bundle.
 */
export class AppContext {
  readonly configDir: string;
  readonly sessions: SessionManager;
  readonly piAgents: PiAgentManager;
  readonly browserSurfaces: BrowserSurfaceManager;
  readonly browserHistory: BrowserHistoryStore;
  readonly cookieStore: CookieStore;
  readonly metadataPoller: SurfaceMetadataPoller;
  readonly settings: SettingsManager;

  /** Surface currently receiving keyboard input. Null before first focus. */
  focusedSurfaceId: string | null = null;
  /** Latest workspace snapshot pushed from the webview. Authoritative. */
  workspaceState: WorkspaceSnapshot[] = [];
  /** Id of the workspace showing in the pane tree. */
  activeWorkspaceId: string | null = null;
  /** Whether the sidebar is expanded. Mirrored to web clients. */
  sidebarVisible = true;
  /** Flips true after the webview's first `resize` RPC lands — that's
   *  our cue to send settings + restore persisted layout. */
  initialResizeReceived = false;

  /** Web mirror server. Null when disabled; replaced on port change. */
  webServer: WebServer | null = null;
  /** Port the web mirror binds to. Mutated by the settings panel. */
  webServerPort: number;

  /** Debounce handle for the layout saver. */
  layoutSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: AppContextOptions) {
    this.configDir = opts.configDir;
    this.sessions = opts.sessions;
    this.piAgents = opts.piAgents;
    this.browserSurfaces = opts.browserSurfaces;
    this.browserHistory = opts.browserHistory;
    this.cookieStore = opts.cookieStore;
    this.metadataPoller = opts.metadataPoller;
    this.settings = opts.settings;
    this.webServerPort = opts.webServerPort;
  }

  /** Snapshot suitable for the RPC handler's `getState` callback. */
  getAppState(): AppState {
    return {
      focusedSurfaceId: this.focusedSurfaceId,
      workspaces: this.workspaceState,
      activeWorkspaceId: this.activeWorkspaceId,
    };
  }

  /** Return the workspace currently shown in the pane tree, if any. */
  getActiveWorkspace(): WorkspaceSnapshot | null {
    return this.findWorkspace(this.activeWorkspaceId);
  }

  findWorkspace(id: string | null | undefined): WorkspaceSnapshot | null {
    if (!id) return null;
    return this.workspaceState.find((ws) => ws.id === id) ?? null;
  }

  /** Debounce a layout save — callers pass the actual save function so
   *  the context stays free of filesystem concerns. */
  scheduleLayoutSave(saveFn: () => void, delayMs = 500): void {
    if (this.layoutSaveTimer) clearTimeout(this.layoutSaveTimer);
    this.layoutSaveTimer = setTimeout(() => {
      this.layoutSaveTimer = null;
      saveFn();
    }, delayMs);
  }
}
