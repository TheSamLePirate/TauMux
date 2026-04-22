import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { PanelManager } from "./panel-manager";
import { PaneLayout, setPaneGap } from "./pane-layout";
import { Sidebar } from "./sidebar";
import { createIcon } from "./icons";
import { applyTauPaneClasses } from "./tau-primitives";
import type { TauIdentity } from "./tau-tokens";

/** Map a surface kind to the τ-mux §7 identity signal (colour is identity). */
function surfaceIdentity(
  kind: "terminal" | "browser" | "agent" | "telegram",
): TauIdentity {
  // Agents are amber. Everything the user drives (shell, browser, chat) is cyan.
  return kind === "agent" ? "agent" : "human";
}
import { TerminalEffects } from "./terminal-effects";
import type {
  PanelEvent,
  PersistedLayout,
  SidebandContentMessage,
  SurfaceContextMenuRequest,
  SurfaceMetadata,
} from "../../shared/types";
import { createWorkspaceRecord } from "./workspace-factory";
import { TerminalSearchBar } from "./terminal-search";
import { buildSidebarWorkspaces, samePortSet } from "./sidebar-state";
import { PaneDragController } from "./pane-drag";
import { type AppSettings, hexToRgb } from "../../shared/settings";
import { attachSidebarResize } from "../../shared/sidebar-resize";
import { focusXtermPreservingScroll } from "../../shared/xterm-focus";
import { playNotificationSound, setNotificationSoundSettings } from "./sounds";
import {
  type AgentPaneView,
  createAgentPaneView,
  agentPanelHandleEvent,
  agentPanelAddUserMessage,
  agentPanelFocusInput,
} from "./agent-panel";
import {
  type BrowserPaneView,
  createBrowserPaneView,
  browserPaneNavigateTo,
  browserPaneGoBack,
  browserPaneGoForward,
  browserPaneReload,
  browserPaneEvalJs,
  browserPaneFindInPage,
  browserPaneStopFind,
  browserPaneToggleDevTools,
  browserPaneFocusAddressBar,
  browserPaneSyncDimensions,
  browserPaneSetHidden,
  browserPaneApplyDarkMode,
  browserPaneInjectCookies,
  browserPaneGetCookies,
  destroyBrowserPaneView,
} from "./browser-pane";
import {
  type TelegramPaneView,
  createTelegramPaneView,
  telegramPaneApplyState,
  telegramPaneApplyHistory,
  telegramPaneAppendMessage,
  destroyTelegramPaneView,
} from "./telegram-pane";
import type {
  TelegramChatWire,
  TelegramStatusWire,
  TelegramWireMessage,
} from "../../shared/types";

const defaultGlassTheme = {
  background: "rgba(10, 10, 10, 0)",
  foreground: "#f5f7fb",
  cursor: "#eab308",
  cursorAccent: "#0a0a0a",
  selectionBackground: "rgba(234, 179, 8, 0.2)",
  selectionForeground: "#f5f7fb",
  black: "#0a0a0a",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#f59e0b",
  blue: "#a1a1aa",
  magenta: "#c4c4cf",
  cyan: "#d7dae1",
  white: "#d7dce7",
  brightBlack: "#5c6270",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fbbf24",
  brightBlue: "#c7cad2",
  brightMagenta: "#d7dae1",
  brightCyan: "#e5e7eb",
  brightWhite: "#f5f7fb",
};

interface SurfaceView {
  id: string;
  surfaceType: "terminal" | "browser" | "agent" | "telegram";
  // Terminal-specific (null for browser panes)
  term: Terminal | null;
  fitAddon: FitAddon | null;
  searchAddon: SearchAddon | null;
  effects: TerminalEffects | null;
  panelManager: PanelManager | null;
  panelsEl: HTMLDivElement | null;
  // Browser-specific (null for terminal panes)
  browserView: BrowserPaneView | null;
  // Agent-specific (null for non-agent panes)
  agentView: AgentPaneView | null;
  // Telegram-specific (null for non-telegram panes)
  telegramView: TelegramPaneView | null;
  // Shared
  container: HTMLDivElement;
  titleEl: HTMLSpanElement;
  chipsEl: HTMLDivElement;
  title: string;
  /** True when the user explicitly renamed this surface (prompt-dialog
   *  flow or an `ht surface.rename`). OSC 0/2 title escapes are ignored
   *  after this until the surface is closed — protects a user's chosen
   *  pane name from being overwritten by e.g. `vim` setting the title. */
  titleLockedByUser?: boolean;
}

export interface Workspace {
  id: string;
  layout: PaneLayout;
  surfaceIds: Set<string>;
  name: string;
  color: string;
  status: Map<string, { value: string; icon?: string; color?: string }>;
  progress: { value: number; label?: string } | null;
  logs: { level: string; message: string; source?: string; time: number }[];
}

export class SurfaceManager {
  private surfaces = new Map<string, SurfaceView>();
  private workspaces: Workspace[] = [];
  private activeWorkspaceIndex = -1;
  private focusedSurfaceId: string | null = null;
  private dividerEls: HTMLDivElement[] = [];
  private sidebar: Sidebar;
  private terminalEffectsEnabled = true;
  private wsCounter = 0;
  private paneDrag: PaneDragController;
  private fontSize: number;
  private searchBar: TerminalSearchBar;
  private metadata = new Map<string, SurfaceMetadata>();
  /** surfaceId → metadata about why we launched this surface, for script
   *  status tracking. Cleared on surfaceExited. */
  private scriptTrackers = new Map<
    string,
    { workspaceId: string; scriptKey: string }
  >();
  /** key "<workspaceId>:<scriptKey>" → epoch ms of last non-zero exit.
   *  Read by the sidebar to render the red dot (auto-clears after 10 s). */
  private scriptErrors = new Map<string, number>();
  /** workspaceId → cwd the user explicitly marked as the workspace's cwd.
   *  Drives which surface's package.json feeds the card when multiple panes
   *  are in different directories. Auto-cleared when the cwd goes stale. */
  private selectedCwds = new Map<string, string>();

  constructor(
    private terminalContainer: HTMLElement,
    sidebarContainer: HTMLElement,
    private onStdin: (surfaceId: string, data: string) => void,
    private onResize: (surfaceId: string, cols: number, rows: number) => void,
    private onPanelEvent: (surfaceId: string, event: PanelEvent) => void,
    initialFontSize = 13,
  ) {
    this.fontSize = initialFontSize;
    this.paneDrag = new PaneDragController({
      terminalContainer: this.terminalContainer,
      getActiveWorkspace: () => this.activeWorkspace() ?? null,
      getSurface: (id) => this.surfaces.get(id),
      focusSurface: (id) => this.focusSurface(id),
      onDropCommitted: () => {
        this.applyLayout();
        this.updateSidebar();
      },
    });
    this.searchBar = new TerminalSearchBar(this.terminalContainer, {
      getActiveSearchAddon: () => {
        const view = this.focusedSurfaceId
          ? this.surfaces.get(this.focusedSurfaceId)
          : null;
        return view?.searchAddon ?? null;
      },
      onClose: () => {
        const view = this.focusedSurfaceId
          ? this.surfaces.get(this.focusedSurfaceId)
          : null;
        focusSurfaceTerminal(view);
      },
    });
    this.sidebar = new Sidebar(sidebarContainer, {
      onSelectWorkspace: (id) => {
        const idx = this.workspaces.findIndex((w) => w.id === id);
        if (idx !== -1) this.switchToWorkspace(idx);
      },
      onNewWorkspace: () => {
        window.dispatchEvent(new CustomEvent("ht-new-workspace"));
      },
      onCloseWorkspace: (id) => {
        const ws = this.workspaces.find((w) => w.id === id);
        if (ws) {
          for (const sid of [...ws.surfaceIds]) {
            window.dispatchEvent(
              new CustomEvent("ht-close-surface", {
                detail: { surfaceId: sid },
              }),
            );
          }
        }
      },
    });
    this.wireSidebarResize();
  }

  /** Attach the drag-to-resize behavior to the sidebar's handle. Live
   *  moves update the CSS variable + re-fit every xterm in the active
   *  workspace; commits persist through the settings RPC so the value
   *  survives restarts. The update traffic is already rAF-throttled in
   *  `attachSidebarResize`. */
  private wireSidebarResize(): void {
    attachSidebarResize({
      handle: this.sidebar.getResizeHandle(),
      min: 200,
      max: 600,
      defaultWidth: 320,
      // Native webview: the sidebar is pinned to x=0 of the viewport,
      // so the new width is simply clientX.
      getSidebarLeft: () => 0,
      onLive: (width) => {
        document.documentElement.style.setProperty(
          "--sidebar-width",
          `${width}px`,
        );
        this.applyLayout();
      },
      onCommit: (width) => {
        document.documentElement.style.setProperty(
          "--sidebar-width",
          `${width}px`,
        );
        this.applyLayout();
        window.dispatchEvent(
          new CustomEvent("ht-sidebar-resize-commit", {
            detail: { width },
          }),
        );
      },
    });
  }

  toggleSidebar(): void {
    this.sidebar.toggle();
    this.scheduleLayoutAfterTransition();
  }

  setSidebarVisible(visible: boolean): void {
    if (this.sidebar.isVisible() !== visible) {
      this.sidebar.toggle();
      this.scheduleLayoutAfterTransition();
    }
  }

  /** Apply layout after the sidebar CSS transition completes. */
  private scheduleLayoutAfterTransition(): void {
    const handler = () => {
      this.terminalContainer.removeEventListener("transitionend", handler);
      this.applyLayout();
    };
    this.terminalContainer.addEventListener("transitionend", handler);
    // Fallback in case transitionend doesn't fire (e.g. no transition)
    setTimeout(() => {
      this.terminalContainer.removeEventListener("transitionend", handler);
      this.applyLayout();
    }, 300);
  }

  isSidebarVisible(): boolean {
    return this.sidebar.isVisible();
  }

  /** Shared tail of every `addXxxSurface` method: register the view,
   *  build a workspace record, switch to it, schedule the initial
   *  layout pass with a type-appropriate focus callback. */
  private addNewWorkspace(
    surfaceId: string,
    name: string,
    view: SurfaceView,
    onReady: () => void,
  ): void {
    this.surfaces.set(surfaceId, view);
    const ws = createWorkspaceRecord({
      surfaceId,
      name: this.uniqueWorkspaceName(name),
      counter: ++this.wsCounter,
    });
    this.workspaces.push(ws);
    this.switchToWorkspace(this.workspaces.length - 1);
    this.updateSidebar();
    this.scheduleLayoutForNewSurface(onReady);
  }

  /** Pick a workspace name that doesn't collide with existing workspaces.
   *  Default behaviour used to stack 5 workspaces all named "zsh" (or
   *  "Browser", "Pi Agent") because `addSurface` used the surface title
   *  directly. Append a " 2", " 3", … suffix on collision so the sidebar
   *  stays readable. */
  private uniqueWorkspaceName(base: string): string {
    const existing = new Set(this.workspaces.map((w) => w.name));
    if (!existing.has(base)) return base;
    for (let n = 2; n < 1000; n++) {
      const candidate = `${base} ${n}`;
      if (!existing.has(candidate)) return candidate;
    }
    return base;
  }

  /** Shared tail of every `addXxxSurfaceAsSplit` method: register the
   *  view, split the active workspace's pane tree, focus the new pane. */
  private addSurfaceAsSplitImpl(
    surfaceId: string,
    view: SurfaceView,
    splitFrom: string,
    direction: "horizontal" | "vertical",
  ): void {
    this.surfaces.set(surfaceId, view);
    const ws = this.activeWorkspace();
    if (!ws) return;
    ws.layout.splitSurface(splitFrom, direction, surfaceId);
    ws.surfaceIds.add(surfaceId);
    this.scheduleLayoutForNewSurface(() => this.focusSurface(surfaceId));
  }

  /** Add a surface as a new workspace. */
  addSurface(surfaceId: string, title: string): void {
    const view = this.createSurfaceView(surfaceId, title);
    this.addNewWorkspace(surfaceId, title, view, () =>
      focusSurfaceTerminal(view),
    );
  }

  /** Add a browser surface as a new workspace. */
  addBrowserSurface(surfaceId: string, url: string): void {
    const view = this.createBrowserSurfaceView(surfaceId, url);
    this.addNewWorkspace(surfaceId, "Browser", view, () =>
      this.focusSurface(surfaceId),
    );
  }

  /** Add a browser surface as a split within the active workspace. */
  addBrowserSurfaceAsSplit(
    surfaceId: string,
    url: string,
    splitFrom: string,
    direction: "horizontal" | "vertical",
  ): void {
    const view = this.createBrowserSurfaceView(surfaceId, url);
    this.addSurfaceAsSplitImpl(surfaceId, view, splitFrom, direction);
  }

  /** Remove a browser surface (same as removeSurface — shared logic). */
  removeBrowserSurface(surfaceId: string): void {
    this.removeSurface(surfaceId);
  }

  /** Add an agent surface as a new workspace. */
  addAgentSurface(surfaceId: string, agentId: string): void {
    const view = this.createAgentSurfaceView(surfaceId, agentId);
    this.addNewWorkspace(surfaceId, "Pi Agent", view, () =>
      this.focusSurface(surfaceId),
    );
  }

  /** Add an agent surface as a split within the active workspace. */
  addAgentSurfaceAsSplit(
    surfaceId: string,
    agentId: string,
    splitFrom: string,
    direction: "horizontal" | "vertical",
  ): void {
    const view = this.createAgentSurfaceView(surfaceId, agentId);
    this.addSurfaceAsSplitImpl(surfaceId, view, splitFrom, direction);
  }

  /** Remove an agent surface (same as removeSurface — shared logic). */
  removeAgentSurface(surfaceId: string): void {
    this.removeSurface(surfaceId);
  }

  /** Add a Telegram pane as a new workspace. */
  addTelegramSurface(surfaceId: string): void {
    const view = this.createTelegramSurfaceView(surfaceId);
    this.addNewWorkspace(surfaceId, "Telegram", view, () =>
      this.focusSurface(surfaceId),
    );
  }

  /** Add a Telegram pane as a split within the active workspace. */
  addTelegramSurfaceAsSplit(
    surfaceId: string,
    splitFrom: string,
    direction: "horizontal" | "vertical",
  ): void {
    const view = this.createTelegramSurfaceView(surfaceId);
    this.addSurfaceAsSplitImpl(surfaceId, view, splitFrom, direction);
  }

  /** Remove a Telegram pane (shared lifecycle path). */
  removeTelegramSurface(surfaceId: string): void {
    this.removeSurface(surfaceId);
  }

  /** Push a freshly-arrived Telegram message into every Telegram pane.
   *  Multiple panes may show the same chat — broadcast keeps them in
   *  sync without round-tripping through the server. Inbound messages
   *  also pulse glow + play the notification chime if the user isn't
   *  already focused on a Telegram pane (so a fresh DM doesn't get
   *  silently lost when the user is in a terminal pane). */
  handleTelegramMessage(message: TelegramWireMessage): void {
    let landedInTelegramPane = false;
    for (const view of this.surfaces.values()) {
      if (view.telegramView) {
        telegramPaneAppendMessage(view.telegramView, message);
        landedInTelegramPane = true;
        if (view.id !== this.focusedSurfaceId && message.direction === "in") {
          this.notifyGlow(view.id);
        }
      }
    }
    if (
      landedInTelegramPane &&
      message.direction === "in" &&
      this.focusedSurfaceId !== null
    ) {
      const focused = this.surfaces.get(this.focusedSurfaceId);
      if (focused?.surfaceType !== "telegram") {
        playNotificationSound();
      }
    }
  }

  /** Apply a paginated history payload to every Telegram pane that's
   *  currently bound to the chat. */
  handleTelegramHistory(payload: {
    chatId: string;
    messages: TelegramWireMessage[];
    isLatest: boolean;
  }): void {
    for (const view of this.surfaces.values()) {
      if (view.telegramView) {
        telegramPaneApplyHistory(view.telegramView, payload);
      }
    }
  }

  /** Apply a service status + chat list snapshot to every Telegram pane. */
  handleTelegramState(state: {
    chats: TelegramChatWire[];
    status: TelegramStatusWire;
  }): void {
    for (const view of this.surfaces.values()) {
      if (view.telegramView) {
        telegramPaneApplyState(view.telegramView, state);
      }
    }
  }

  /** Handle a pi agent event for the corresponding agent surface. */
  handleAgentEvent(agentId: string, event: Record<string, unknown>): void {
    const view = this.surfaces.get(agentId);
    if (!view?.agentView) return;
    agentPanelHandleEvent(view.agentView, event);
  }

  /** Send a user message to an agent panel's display. */
  agentAddUserMessage(
    agentId: string,
    text: string,
    images?: {
      type: "image";
      data: string;
      mimeType: string;
      fileName?: string;
    }[],
  ): void {
    const view = this.surfaces.get(agentId);
    if (!view?.agentView) return;
    agentPanelAddUserMessage(view.agentView, text, images);
  }

  /** Focus the agent panel input. */
  agentFocusInput(agentId: string): void {
    const view = this.surfaces.get(agentId);
    if (!view?.agentView) return;
    agentPanelFocusInput(view.agentView);
  }

  /** Add a surface as a split within the active workspace. */
  addSurfaceAsSplit(
    surfaceId: string,
    title: string,
    splitFrom: string,
    direction: "horizontal" | "vertical",
  ): void {
    const view = this.createSurfaceView(surfaceId, title);
    this.addSurfaceAsSplitImpl(surfaceId, view, splitFrom, direction);
  }

  restoreLayout(
    layout: PersistedLayout,
    _surfaceMapping: Record<string, string>,
  ): void {
    // Clear any default workspace that was auto-created
    // (surfaces were already created by bun and added via surfaceCreated)
    this.workspaces = [];
    this.activeWorkspaceIndex = -1;

    for (const ws of layout.workspaces) {
      const leafIds = PaneLayout.fromNode(ws.layout).getAllSurfaceIds();
      const paneLayout = PaneLayout.fromNode(ws.layout);

      const workspace: Workspace = {
        id: `ws:${++this.wsCounter}`,
        layout: paneLayout,
        surfaceIds: new Set(leafIds),
        name: ws.name,
        color: ws.color,
        status: new Map(),
        progress: null,
        logs: [],
      };
      this.workspaces.push(workspace);
      // Rehydrate the user's pinned "workspace cwd" — the card will pick it
      // back up on the next updateSidebar, and auto-clear if the pinned dir
      // doesn't match any of the (re-)spawned surfaces.
      if (ws.selectedCwd) this.selectedCwds.set(workspace.id, ws.selectedCwd);
    }

    const targetIdx = Math.max(
      0,
      Math.min(layout.activeWorkspaceIndex, this.workspaces.length - 1),
    );
    this.switchToWorkspace(targetIdx);

    if (!layout.sidebarVisible && this.sidebar.isVisible()) {
      this.sidebar.toggle();
    }

    this.updateSidebar();
    this.scheduleLayoutForNewSurface();
    this.notifyWorkspaceChanged();
  }

  /**
   * Schedule layout after a new surface is added.
   * Position containers immediately, then fit terminals after xterm has
   * rendered into the DOM so fitAddon gets the correct dimensions.
   */
  private scheduleLayoutForNewSurface(after?: () => void): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // First pass: position the containers so xterm can measure
        this.applyPositions();
        // Second pass after a tick: fit terminals now that xterm has rendered
        setTimeout(() => {
          this.applyLayout();
          after?.();
        }, 50);
      });
    });
  }

  removeSurface(surfaceId: string): void {
    const view = this.surfaces.get(surfaceId);
    if (!view) return;

    this.paneDrag.cancelIfInvolves(surfaceId);

    const wsIndex = this.workspaces.findIndex((w) =>
      w.surfaceIds.has(surfaceId),
    );
    if (wsIndex === -1) return;

    const ws = this.workspaces[wsIndex];
    ws.surfaceIds.delete(surfaceId);

    if (ws.surfaceIds.size === 0) {
      this.removeWorkspace(wsIndex);
    } else {
      ws.layout.removeSurface(surfaceId);
      if (this.focusedSurfaceId === surfaceId) {
        const remaining = ws.layout.getAllSurfaceIds();
        if (remaining.length > 0) this.focusSurface(remaining[0]);
      }
      this.applyLayout();
    }

    // Order matters: destroy PanelManager (and its xterm subscriptions)
    // and effects BEFORE disposing the xterm instance, otherwise
    // subscriptions can fire against a disposed terminal or close over
    // freed state.
    view.panelManager?.destroy();
    view.panelManager = null;
    view.effects?.destroy();
    view.term?.dispose();
    // Browser panes keep webviewEl.on() handlers that close over
    // surfaceId + callbacks; detach them explicitly or they leak for
    // the lifetime of the electrobun <electrobun-webview> tag.
    if (view.browserView) destroyBrowserPaneView(view.browserView);
    if (view.telegramView) destroyTelegramPaneView(view.telegramView);
    view.container.remove();
    this.surfaces.delete(surfaceId);
    this.metadata.delete(surfaceId);
    this.updateSidebar();
  }

  focusSurface(surfaceId: string): void {
    this.focusedSurfaceId = surfaceId;
    for (const v of this.surfaces.values()) {
      const isFocused = v.id === surfaceId;
      v.container.classList.toggle("focused", isFocused);
      // τ-mux §4: the focused pane is the only element that glows.
      // applyTauPaneClasses writes `.tau-pane` + `.tau-pane-{identity}`
      // + `.is-focused`; the CSS at the end of index.css routes the
      // cyan/amber border + glow from there.
      applyTauPaneClasses(
        v.container,
        surfaceIdentity(v.surfaceType),
        isFocused,
      );
      v.effects?.setFocused(isFocused);
    }
    // Clear notification glow when surface becomes selected
    this.clearGlow(surfaceId);
    // And quiet any sidebar notifications emitted from this surface —
    // focusing the pane is an implicit "I've seen it" signal.
    this.sidebar.acknowledgeBySurface(surfaceId);
    const focusedView = this.surfaces.get(surfaceId);
    if (
      focusedView?.surfaceType === "browser" ||
      focusedView?.surfaceType === "telegram"
    ) {
      // Non-terminal panes don't have a terminal to focus
    } else {
      focusSurfaceTerminal(focusedView);
    }
    const activeWorkspace = this.activeWorkspace();
    if (activeWorkspace?.surfaceIds.has(surfaceId)) {
      this.updateTitlebar(activeWorkspace);
      this.updateSidebar();
    }
    window.dispatchEvent(
      new CustomEvent("ht-surface-focused", { detail: { surfaceId } }),
    );
  }

  focusDirection(dir: "left" | "right" | "up" | "down"): void {
    const ws = this.activeWorkspace();
    if (!ws || !this.focusedSurfaceId) return;
    const neighbor = ws.layout.findNeighbor(this.focusedSurfaceId, dir);
    if (neighbor) this.focusSurface(neighbor);
  }

  writeToSurface(surfaceId: string, data: string): void {
    const view = this.surfaces.get(surfaceId);
    if (!view) return;
    if (!view.term) return;
    view.effects?.pulseOutput(data.length);
    view.term.write(data);
  }

  handleSidebandMeta(surfaceId: string, msg: SidebandContentMessage): void {
    this.surfaces.get(surfaceId)?.panelManager?.handleMeta(msg);
  }

  handleSidebandData(surfaceId: string, id: string, base64: string): void {
    this.surfaces.get(surfaceId)?.panelManager?.handleData(id, base64);
  }

  handleSidebandBinary(
    surfaceId: string,
    id: string,
    binary: Uint8Array,
  ): void {
    this.surfaces.get(surfaceId)?.panelManager?.handleBinary(id, binary);
  }

  handleSidebandDataFailed(
    surfaceId: string,
    id: string,
    reason: string,
  ): void {
    this.surfaces.get(surfaceId)?.panelManager?.handleDataFailed(id, reason);
  }

  resizeAll(): void {
    this.applyLayout();
  }

  getSidebar(): Sidebar {
    return this.sidebar;
  }

  /** Cap per-workspace log entries. A script calling `ht sidebar.log` in
   *  a loop used to grow the list unboundedly, bloating both memory and
   *  the workspaceStateSync payload. Matches the notification-store cap
   *  convention on the bun side. */
  private static MAX_LOGS_PER_WORKSPACE = 200;

  addLog(
    workspaceId: string | undefined,
    level: string,
    message: string,
    source?: string,
  ): void {
    const ws = workspaceId
      ? this.workspaces.find((w) => w.id === workspaceId)
      : this.activeWorkspace();
    if (ws) {
      ws.logs.push({ level, message, source, time: Date.now() });
      const cap = SurfaceManager.MAX_LOGS_PER_WORKSPACE;
      if (ws.logs.length > cap) {
        ws.logs.splice(0, ws.logs.length - cap);
      }
      this.sidebar.setLogs(ws.logs);
    }
  }

  clearLogs(): void {
    const ws = this.activeWorkspace();
    if (ws) {
      ws.logs = [];
      this.sidebar.setLogs([]);
    }
  }

  getActiveSurfaceId(): string | null {
    return this.focusedSurfaceId;
  }

  getActiveTerm(): Terminal | null {
    if (!this.focusedSurfaceId) return null;
    const view = this.surfaces.get(this.focusedSurfaceId);
    if (
      !view ||
      view.surfaceType === "browser" ||
      view.surfaceType === "telegram"
    )
      return null;
    return view.term;
  }

  getActiveSurfaceType(): "terminal" | "browser" | "agent" | "telegram" | null {
    if (!this.focusedSurfaceId) return null;
    return this.surfaces.get(this.focusedSurfaceId)?.surfaceType ?? null;
  }

  setTerminalEffectsEnabled(enabled: boolean): void {
    this.terminalEffectsEnabled = enabled;
    for (const view of this.surfaces.values()) {
      if (view.effects) {
        view.effects.setEnabled(enabled);
        view.effects.setFocused(view.id === this.focusedSurfaceId);
      }
    }
  }

  toggleTerminalEffects(): boolean {
    this.setTerminalEffectsEnabled(!this.terminalEffectsEnabled);
    return this.terminalEffectsEnabled;
  }

  areTerminalEffectsEnabled(): boolean {
    return this.terminalEffectsEnabled;
  }

  getSurfaceTitle(surfaceId: string): string | null {
    return this.surfaces.get(surfaceId)?.title ?? null;
  }

  /** Snapshot used by the per-surface details panel. */
  getSurfaceDetailsRef(surfaceId: string): {
    id: string;
    title: string;
    workspaceName: string;
    workspaceColor?: string;
    metadata: SurfaceMetadata | null;
  } | null {
    const view = this.surfaces.get(surfaceId);
    if (!view) return null;
    const ws = this.workspaces.find((w) => w.surfaceIds.has(surfaceId));
    return {
      id: surfaceId,
      title: view.title,
      workspaceName: ws?.name ?? "",
      workspaceColor: ws?.color,
      metadata: this.metadata.get(surfaceId) ?? null,
    };
  }

  /** Snapshot used by the process manager panel. */
  getProcessManagerData(): {
    id: string;
    name: string;
    color?: string;
    active: boolean;
    surfaces: { id: string; title: string; metadata: SurfaceMetadata | null }[];
  }[] {
    return this.workspaces.map((ws, i) => ({
      id: ws.id,
      name: ws.name,
      color: ws.color,
      active: i === this.activeWorkspaceIndex,
      surfaces: [...ws.surfaceIds].map((sid) => ({
        id: sid,
        title: this.surfaces.get(sid)?.title ?? sid,
        metadata: this.metadata.get(sid) ?? null,
      })),
    }));
  }

  setSurfaceMetadata(surfaceId: string, metadata: SurfaceMetadata): void {
    const prev = this.metadata.get(surfaceId);
    this.metadata.set(surfaceId, metadata);
    const view = this.surfaces.get(surfaceId);
    if (view) renderSurfaceChips(view.chipsEl, metadata);
    // Rebuild the sidebar when any field the card displays may have changed:
    // the port set, the focused-pane fg command, the cwd (multi-cwd chip
    // row), or the package.json (header + scripts + running status). Tree
    // shape also affects running-script dots, so include a cheap proxy.
    const portsChanged =
      !prev || !samePortSet(prev.listeningPorts, metadata.listeningPorts);
    const fgChanged =
      surfaceId === this.focusedSurfaceId &&
      (!prev || prev.foregroundPid !== metadata.foregroundPid);
    const cwdChanged = (prev?.cwd ?? "") !== metadata.cwd;
    const pkgChanged =
      (prev?.packageJson?.path ?? null) !==
      (metadata.packageJson?.path ?? null);
    const treeLenChanged = (prev?.tree.length ?? -1) !== metadata.tree.length;
    if (
      portsChanged ||
      fgChanged ||
      cwdChanged ||
      pkgChanged ||
      treeLenChanged
    ) {
      this.updateSidebar();
    }
    // cwd changes also affect what gets persisted (surfaceCwds) — nudge the
    // debounced sync so the on-disk layout tracks where shells currently
    // are, not where they were when the workspace shape last changed.
    if (cwdChanged) this.notifyWorkspaceChanged();
  }

  getSurfaceMetadata(surfaceId: string): SurfaceMetadata | null {
    return this.metadata.get(surfaceId) ?? null;
  }

  /** Mark `cwd` as the workspace's "primary" cwd — the sidebar package card
   *  reads the packageJson from the surface running at that cwd, and the
   *  card disappears gracefully when the cwd is no longer active. */
  setWorkspaceCwd(workspaceId: string, cwd: string): void {
    this.selectedCwds.set(workspaceId, cwd);
    this.updateSidebar();
    // Pinned cwd is a persisted field — sync so restarts respect the pick.
    this.notifyWorkspaceChanged();
  }

  /**
   * The "workspace cwd" driving splits/new panes/script runs. Preference
   * order: user-pinned cwd for the active workspace, focused surface's live
   * cwd from the metadata poller, or null when nothing is known yet.
   */
  getActiveWorkspaceCwd(): string | null {
    const ws = this.workspaces[this.activeWorkspaceIndex];
    if (!ws) return null;
    const pinned = this.selectedCwds.get(ws.id);
    if (pinned) return pinned;
    const focused =
      this.focusedSurfaceId && ws.surfaceIds.has(this.focusedSurfaceId)
        ? this.metadata.get(this.focusedSurfaceId)
        : null;
    return focused?.cwd || null;
  }

  /** Attach a script-tracker to a freshly-created surface so surfaceExited
   *  can paint the red dot when the run fails. */
  registerScriptSurface(
    surfaceId: string,
    workspaceId: string,
    scriptKey: string,
  ): void {
    this.scriptTrackers.set(surfaceId, { workspaceId, scriptKey });
  }

  /** Called by index.ts on the surfaceExited RPC. */
  handleSurfaceExit(surfaceId: string, exitCode: number): void {
    const tracker = this.scriptTrackers.get(surfaceId);
    if (!tracker) return;
    this.scriptTrackers.delete(surfaceId);
    if (exitCode !== 0) {
      const key = `${tracker.workspaceId}:${tracker.scriptKey}`;
      const ts = Date.now();
      this.scriptErrors.set(key, ts);
      setTimeout(() => {
        if (this.scriptErrors.get(key) === ts) {
          this.scriptErrors.delete(key);
          this.updateSidebar();
        }
      }, 10000);
      this.updateSidebar();
    }
  }

  /**
   * Place a new surface inside an existing workspace by splitting off one of
   * its panes — which keeps it in that workspace rather than creating a new
   * one (plain `addSurface` always spawns a fresh workspace). Splits from the
   * focused pane when the target is already active; otherwise splits from
   * the workspace's focused-or-first pane.
   *
   * Falls back to `addSurface` only when the workspace disappeared or has
   * zero panes — both "should never happen" paths for the runScript flow.
   */
  addSurfaceToWorkspace(
    surfaceId: string,
    title: string,
    workspaceId: string,
  ): void {
    const idx = this.workspaces.findIndex((w) => w.id === workspaceId);
    if (idx === -1) {
      this.addSurface(surfaceId, title);
      return;
    }
    const ws = this.workspaces[idx];
    if (ws.surfaceIds.size === 0) {
      this.addSurface(surfaceId, title);
      return;
    }
    if (idx !== this.activeWorkspaceIndex) this.switchToWorkspace(idx);
    const splitFrom =
      this.focusedSurfaceId && ws.surfaceIds.has(this.focusedSurfaceId)
        ? this.focusedSurfaceId
        : [...ws.surfaceIds][0];
    this.addSurfaceAsSplit(surfaceId, title, splitFrom, "horizontal");
  }

  // ── Settings ──

  applySettings(s: AppSettings): void {
    this.fontSize = s.fontSize;
    this.terminalEffectsEnabled = s.terminalBloom;
    setNotificationSoundSettings({
      enabled: s.notificationSoundEnabled,
      volume: s.notificationSoundVolume,
    });

    const bg = s.bgBase;
    const secRgb = hexToRgb(s.secondaryColor);
    const accRgb = hexToRgb(s.accentColor);

    // Build xterm theme from settings
    const theme = {
      background: `rgba(${bg}, 0)`,
      foreground: s.foregroundColor,
      cursor: s.accentColor,
      cursorAccent: `rgb(${bg})`,
      selectionBackground: `rgba(${accRgb}, 0.22)`,
      selectionForeground: s.foregroundColor,
      ...s.ansiColors,
    };

    setPaneGap(s.paneGap);

    for (const view of this.surfaces.values()) {
      if (view.surfaceType === "browser" || view.surfaceType === "telegram")
        continue;
      const t = view.term;
      if (!t) continue;
      t.options.fontSize = s.fontSize;
      t.options.fontFamily = s.fontFamily;
      t.options.lineHeight = s.lineHeight;
      t.options.cursorBlink = s.cursorBlink;
      t.options.cursorStyle = s.cursorStyle;
      t.options.scrollback = s.scrollbackLines;
      t.options.theme = theme;
      // Force xterm to re-render with new colors
      t.refresh(0, t.rows - 1);
      fitSurfaceTerminal(view);
      if (view.effects) {
        view.effects.setEnabled(s.terminalBloom);
        view.effects.setIntensity(s.bloomIntensity);
        view.effects.setFocused(view.id === this.focusedSurfaceId);
      }
    }

    // Update CSS custom properties — bgBase drives the entire UI chrome
    const root = document.documentElement;
    root.style.setProperty("--accent-primary", s.accentColor);
    root.style.setProperty("--accent-primary-soft", `rgba(${accRgb}, 0.18)`);
    root.style.setProperty("--accent-primary-strong", `rgba(${accRgb}, 0.52)`);
    root.style.setProperty("--accent-secondary", s.secondaryColor);
    root.style.setProperty("--accent-secondary-soft", `rgba(${secRgb}, 0.22)`);
    root.style.setProperty("--accent-secondary-strong", `rgba(${secRgb}, 0.5)`);
    root.style.setProperty("--glow-gold", `rgba(${accRgb}, 0.42)`);
    root.style.setProperty("--glow-gold-strong", `rgba(${accRgb}, 0.72)`);
    root.style.setProperty("--glow-purple", `rgba(${secRgb}, 0.42)`);
    root.style.setProperty("--glow-purple-strong", `rgba(${secRgb}, 0.68)`);
    root.style.setProperty("--text-strong", s.foregroundColor);
    root.style.setProperty("--sidebar-width", `${s.sidebarWidth}px`);
    root.style.setProperty("--bg-shell", `rgba(${bg}, ${s.terminalBgOpacity})`);
    root.style.setProperty("--bg-title", `rgba(${bg}, 0.44)`);
    root.style.setProperty("--bg-sidebar", `rgba(${bg}, 0.66)`);
    root.style.setProperty("--bg-terminal", `rgb(${bg})`);
    root.style.setProperty("--bg-terminal-muted", `rgba(${bg}, 0.94)`);
    root.style.setProperty("--bg-glass", `rgba(${bg}, 0.7)`);
    root.style.setProperty("--bg-glass-strong", `rgba(${bg}, 0.9)`);

    // Apply dark mode to all browser panes
    for (const view of this.surfaces.values()) {
      if (view.surfaceType === "browser" && view.browserView) {
        browserPaneApplyDarkMode(view.browserView, s.browserForceDarkMode);
      }
    }

    // Re-report size for active surface
    const active = this.focusedSurfaceId
      ? this.surfaces.get(this.focusedSurfaceId)
      : null;
    if (active?.term) {
      this.onResize(active.id, active.term.cols, active.term.rows);
    }

    this.applyLayout();
  }

  // ── Font size ──

  getFontSize(): number {
    return this.fontSize;
  }

  setFontSize(size: number): void {
    this.fontSize = size;
    for (const view of this.surfaces.values()) {
      if (
        view.surfaceType === "browser" ||
        view.surfaceType === "telegram" ||
        !view.term
      )
        continue;
      view.term.options.fontSize = size;
      fitSurfaceTerminal(view);
    }
    // Re-report size to bun for the active surface
    const active = this.focusedSurfaceId
      ? this.surfaces.get(this.focusedSurfaceId)
      : null;
    if (active?.term) {
      this.onResize(active.id, active.term.cols, active.term.rows);
    }
  }

  // ── Terminal search ──

  toggleSearchBar(): void {
    this.searchBar.toggle();
  }

  /** Tier 2 test introspection: is the find-in-page bar visible? */
  isSearchBarVisible(): boolean {
    return this.searchBar.isVisible;
  }

  /** Tier 2 test introspection: id of the currently-active workspace, or null
   *  if no workspace exists yet (pre-first-resize state). */
  getActiveWorkspaceId(): string | null {
    return this.activeWorkspace()?.id ?? null;
  }

  readScreen(surfaceId: string, lines?: number, scrollback?: boolean): string {
    const view = this.surfaces.get(surfaceId);
    if (!view || !view.term) return "";

    const buf = view.term.buffer.active;
    const rows = view.term.rows;

    // End = last line with content (cursor position)
    const contentEnd = buf.baseY + buf.cursorY + 1;
    const n = lines ?? rows;

    let startRow: number;
    let endRow: number;

    if (scrollback) {
      endRow = contentEnd;
      startRow = Math.max(0, endRow - n);
    } else {
      // Recent visible content
      endRow = contentEnd;
      startRow = Math.max(0, endRow - n);
    }

    const result: string[] = [];
    for (let i = startRow; i < endRow; i++) {
      const line = buf.getLine(i);
      result.push(line ? line.translateToString(true) : "");
    }
    return result.join("\n");
  }

  // ── Browser pane actions ──

  /** Run fn against the browser view of `surfaceId` — or the focused
   *  surface if null/undefined. A no-op when nothing resolves to a
   *  browser pane. This collapses the guard that used to be inlined
   *  at the top of every browser* method. */
  private withBrowserView(
    surfaceId: string | null | undefined,
    fn: (view: BrowserPaneView, resolvedId: string) => void,
  ): void {
    const id = surfaceId ?? this.focusedSurfaceId;
    if (!id) return;
    const view = this.surfaces.get(id);
    if (view?.browserView) fn(view.browserView, id);
  }

  /** Set a browser pane's zoom + dispatch the persistence event. */
  private applyBrowserZoom(
    view: BrowserPaneView,
    surfaceId: string,
    zoom: number,
  ): void {
    view.zoom = zoom;
    window.dispatchEvent(
      new CustomEvent("ht-browser-zoom", {
        detail: { surfaceId, zoom },
      }),
    );
  }

  browserNavigateTo(surfaceId: string | null, url: string): void {
    this.withBrowserView(surfaceId, (v) => browserPaneNavigateTo(v, url));
  }

  browserGoBack(surfaceId?: string | null): void {
    this.withBrowserView(surfaceId, (v) => browserPaneGoBack(v));
  }

  browserGoForward(surfaceId?: string | null): void {
    this.withBrowserView(surfaceId, (v) => browserPaneGoForward(v));
  }

  browserReload(surfaceId?: string | null): void {
    this.withBrowserView(surfaceId, (v) => browserPaneReload(v));
  }

  browserEvalJs(
    surfaceId: string | null,
    script: string,
    reqId?: string,
  ): void {
    this.withBrowserView(surfaceId, (v) => browserPaneEvalJs(v, script, reqId));
  }

  browserFindInPage(surfaceId?: string | null, query?: string): void {
    this.withBrowserView(surfaceId, (v) =>
      browserPaneFindInPage(v, query ?? ""),
    );
  }

  browserStopFind(surfaceId?: string | null): void {
    this.withBrowserView(surfaceId, (v) => browserPaneStopFind(v));
  }

  browserToggleDevTools(surfaceId?: string | null): void {
    this.withBrowserView(surfaceId, (v) => browserPaneToggleDevTools(v));
  }

  browserInjectCookies(
    surfaceId: string,
    cookies: Array<{
      name: string;
      value: string;
      path: string;
      expires: number;
      secure: boolean;
      sameSite: string;
    }>,
  ): void {
    this.withBrowserView(surfaceId, (v) =>
      browserPaneInjectCookies(v, cookies),
    );
  }

  browserGetCookies(surfaceId: string, reqId: string): void {
    this.withBrowserView(surfaceId, (v) => browserPaneGetCookies(v, reqId));
  }

  focusBrowserAddressBar(): void {
    this.withBrowserView(null, (v) => browserPaneFocusAddressBar(v));
  }

  browserZoomIn(): void {
    this.withBrowserView(null, (v, id) => {
      this.applyBrowserZoom(v, id, Math.min(5.0, (v.zoom || 1.0) + 0.1));
    });
  }

  browserZoomOut(): void {
    this.withBrowserView(null, (v, id) => {
      this.applyBrowserZoom(v, id, Math.max(0.25, (v.zoom || 1.0) - 0.1));
    });
  }

  browserZoomReset(): void {
    this.withBrowserView(null, (v, id) => this.applyBrowserZoom(v, id, 1.0));
  }

  /** Hide all browser webview overlays (called when overlays open). */
  hideBrowserWebviews(): void {
    for (const view of this.surfaces.values()) {
      if (view.browserView) browserPaneSetHidden(view.browserView, true);
    }
  }

  /** Show browser webview overlays for the active workspace. */
  showBrowserWebviews(): void {
    const ws = this.activeWorkspace();
    if (!ws) return;
    for (const sid of ws.surfaceIds) {
      const view = this.surfaces.get(sid);
      if (view?.browserView) {
        browserPaneSetHidden(view.browserView, false);
        browserPaneSyncDimensions(view.browserView);
      }
    }
  }

  // Workspace navigation
  nextWorkspace(): void {
    if (this.workspaces.length <= 1) return;
    this.switchToWorkspace(
      (this.activeWorkspaceIndex + 1) % this.workspaces.length,
    );
  }

  prevWorkspace(): void {
    if (this.workspaces.length <= 1) return;
    this.switchToWorkspace(
      (this.activeWorkspaceIndex - 1 + this.workspaces.length) %
        this.workspaces.length,
    );
  }

  focusWorkspaceByIndex(index: number): void {
    if (index >= 0 && index < this.workspaces.length) {
      this.switchToWorkspace(index);
    }
  }

  focusWorkspaceById(id: string): void {
    const idx = this.workspaces.findIndex((w) => w.id === id);
    if (idx !== -1) this.switchToWorkspace(idx);
  }

  findWorkspaceForSurface(
    surfaceId: string,
  ): { id: string; index: number } | null {
    const idx = this.workspaces.findIndex((w) => w.surfaceIds.has(surfaceId));
    if (idx === -1) return null;
    return { id: this.workspaces[idx].id, index: idx };
  }

  /** Surface container's rect in CSS pixels relative to the webview
   *  window, plus the current DPR. Returned to the bun side so
   *  `ht screenshot --surface <id>` can crop a window capture to the
   *  pane region. Returns null if the surface isn't currently mounted. */
  getSurfaceRect(surfaceId: string): {
    x: number;
    y: number;
    width: number;
    height: number;
    devicePixelRatio: number;
  } | null {
    const view = this.surfaces.get(surfaceId);
    if (!view) return null;
    const r = view.container.getBoundingClientRect();
    return {
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
      devicePixelRatio: window.devicePixelRatio || 1,
    };
  }

  closeWorkspaceById(id: string): void {
    const ws = this.workspaces.find((w) => w.id === id);
    if (!ws) return;
    for (const sid of [...ws.surfaceIds]) {
      window.dispatchEvent(
        new CustomEvent("ht-close-surface", { detail: { surfaceId: sid } }),
      );
    }
  }

  renameWorkspace(id: string, name: string): void {
    const ws = this.workspaces.find((w) => w.id === id);
    if (ws) {
      ws.name = name;
      if (this.activeWorkspace()?.id === id) {
        this.updateTitlebar(ws);
      }
      this.updateSidebar();
      this.notifyWorkspaceChanged();
    }
  }

  renameSurface(
    surfaceId: string,
    title: string,
    opts: { fromOsc?: boolean } = {},
  ): void {
    const view = this.surfaces.get(surfaceId);
    if (!view) return;

    // OSC 0/2 rename requests lose to an explicit user rename. Without
    // this guard, a user who renames a pane to "my build watcher" and
    // then runs vim watches the title flip to "vim foo.txt" every time
    // they open a file. User rename always wins.
    if (opts.fromOsc && view.titleLockedByUser) return;

    view.title = title;
    view.titleEl.textContent = title;
    if (!opts.fromOsc) view.titleLockedByUser = true;

    const workspace = this.findWorkspaceBySurfaceId(surfaceId);
    if (workspace && this.activeWorkspace()?.id === workspace.id) {
      this.updateTitlebar(workspace);
    }
    this.updateSidebar();
    this.notifyWorkspaceChanged();
  }

  setWorkspaceColor(id: string, color: string): void {
    const ws = this.workspaces.find((w) => w.id === id);
    if (!ws) return;

    ws.color = color;
    if (this.activeWorkspace()?.id === id) {
      document.documentElement.style.setProperty("--workspace-accent", color);
    }
    this.updateSidebar();
    this.notifyWorkspaceChanged();
  }

  getWorkspaceState(): {
    workspaces: {
      id: string;
      name: string;
      color: string;
      surfaceIds: string[];
      focusedSurfaceId: string | null;
      layout: import("../../shared/types").PaneNode;
      surfaceTitles?: Record<string, string>;
      surfaceCwds?: Record<string, string>;
      selectedCwd?: string;
      surfaceUrls?: Record<string, string>;
      surfaceTypes?: Record<
        string,
        "terminal" | "browser" | "agent" | "telegram"
      >;
    }[];
    activeWorkspaceId: string | null;
  } {
    return {
      workspaces: this.workspaces.map((ws) => {
        const surfaceIds = ws.layout.getAllSurfaceIds();
        const surfaceTitles: Record<string, string> = {};
        const surfaceCwds: Record<string, string> = {};
        const surfaceUrls: Record<string, string> = {};
        const surfaceTypes: Record<
          string,
          "terminal" | "browser" | "agent" | "telegram"
        > = {};
        for (const sid of surfaceIds) {
          const view = this.surfaces.get(sid);
          const title = view?.title;
          if (title) surfaceTitles[sid] = title;
          if (view?.surfaceType === "browser") {
            surfaceTypes[sid] = "browser";
            if (view.browserView) {
              surfaceUrls[sid] = view.browserView.currentUrl;
            }
          } else if (view?.surfaceType === "agent") {
            surfaceTypes[sid] = "agent";
          } else if (view?.surfaceType === "telegram") {
            surfaceTypes[sid] = "telegram";
          } else {
            const cwd = this.metadata.get(sid)?.cwd;
            if (cwd) surfaceCwds[sid] = cwd;
          }
        }
        const pinned = this.selectedCwds.get(ws.id);
        return {
          id: ws.id,
          name: ws.name,
          color: ws.color,
          surfaceIds,
          focusedSurfaceId:
            this.focusedSurfaceId && ws.surfaceIds.has(this.focusedSurfaceId)
              ? this.focusedSurfaceId
              : null,
          layout: ws.layout.root,
          surfaceTitles:
            Object.keys(surfaceTitles).length > 0 ? surfaceTitles : undefined,
          surfaceCwds:
            Object.keys(surfaceCwds).length > 0 ? surfaceCwds : undefined,
          selectedCwd: pinned,
          surfaceUrls:
            Object.keys(surfaceUrls).length > 0 ? surfaceUrls : undefined,
          surfaceTypes:
            Object.keys(surfaceTypes).length > 0 ? surfaceTypes : undefined,
        };
      }),
      activeWorkspaceId: this.workspaces[this.activeWorkspaceIndex]?.id ?? null,
    };
  }

  /** Start a persistent notification glow on a surface pane. */
  notifyGlow(surfaceId: string | null): void {
    if (surfaceId) {
      const view = this.surfaces.get(surfaceId);
      if (view) {
        view.container.classList.add("notify-glow");
        this.emitNotifyState();
        return;
      }
    }
    // External notification or unknown surface — glow all surfaces
    for (const view of this.surfaces.values()) {
      view.container.classList.add("notify-glow");
    }
    this.emitNotifyState();
  }

  /** Clear notification glow from a specific surface or all surfaces. */
  clearGlow(surfaceId?: string): void {
    if (surfaceId) {
      this.surfaces.get(surfaceId)?.container.classList.remove("notify-glow");
    } else {
      for (const view of this.surfaces.values()) {
        view.container.classList.remove("notify-glow");
      }
    }
    this.emitNotifyState();
  }

  /** Dispatch a window event so variant chrome (Bridge pills, Cockpit
   *  rail, Atlas graph, sidebar cards) can mirror the notify-glow
   *  state without polling the DOM. */
  private emitNotifyState(): void {
    const surfacesWithNotify = new Set<string>();
    const workspacesWithNotify = new Set<string>();
    for (const [id, view] of this.surfaces) {
      if (view.container.classList.contains("notify-glow")) {
        surfacesWithNotify.add(id);
      }
    }
    for (const ws of this.workspaces) {
      for (const sid of ws.surfaceIds) {
        if (surfacesWithNotify.has(sid)) {
          workspacesWithNotify.add(ws.id);
          break;
        }
      }
    }
    window.dispatchEvent(
      new CustomEvent("ht-notify-state-changed", {
        detail: {
          surfaces: [...surfacesWithNotify],
          workspaces: [...workspacesWithNotify],
        },
      }),
    );
  }

  private notifyWorkspaceChanged(): void {
    window.dispatchEvent(new CustomEvent("ht-workspace-changed"));
  }

  // Metadata
  /** Cap the per-workspace status-pill map. A script that set many
   *  unique keys used to pile up pills indefinitely; the sidebar's
   *  renderer doesn't wrap gracefully and the workspaceStateSync
   *  payload grew with every one. 32 pills is plenty for any
   *  reasonable status dashboard; overflow evicts the oldest. */
  private static MAX_STATUS_PILLS = 32;

  setStatus(
    workspaceId: string | undefined,
    key: string,
    value: string,
    icon?: string,
    color?: string,
  ): void {
    const ws = workspaceId
      ? this.workspaces.find((w) => w.id === workspaceId)
      : this.activeWorkspace();
    if (ws) {
      const alreadyPresent = ws.status.has(key);
      ws.status.set(key, { value, icon, color });
      if (!alreadyPresent && ws.status.size > SurfaceManager.MAX_STATUS_PILLS) {
        // Map preserves insertion order — the first entry is the oldest.
        const oldestKey = ws.status.keys().next().value;
        if (oldestKey !== undefined) ws.status.delete(oldestKey);
      }
      this.updateSidebar();
    }
  }

  clearStatus(workspaceId: string | undefined, key: string): void {
    const ws = workspaceId
      ? this.workspaces.find((w) => w.id === workspaceId)
      : this.activeWorkspace();
    if (ws) {
      ws.status.delete(key);
      this.updateSidebar();
    }
  }

  setProgress(
    workspaceId: string | undefined,
    value: number,
    label?: string,
  ): void {
    const ws = workspaceId
      ? this.workspaces.find((w) => w.id === workspaceId)
      : this.activeWorkspace();
    if (ws) {
      ws.progress = { value, label };
      this.updateSidebar();
    }
  }

  clearProgress(workspaceId: string | undefined): void {
    const ws = workspaceId
      ? this.workspaces.find((w) => w.id === workspaceId)
      : this.activeWorkspace();
    if (ws) {
      ws.progress = null;
      this.updateSidebar();
    }
  }

  get workspaceCount(): number {
    return this.workspaces.length;
  }

  // --- Private ---

  private activeWorkspace(): Workspace | null {
    return this.workspaces[this.activeWorkspaceIndex] ?? null;
  }

  private findWorkspaceBySurfaceId(surfaceId: string): Workspace | null {
    return (
      this.workspaces.find((workspace) =>
        workspace.surfaceIds.has(surfaceId),
      ) ?? null
    );
  }

  private switchToWorkspace(index: number): void {
    this.paneDrag.cancel();
    this.activeWorkspaceIndex = index;
    const activeWs = this.workspaces[index];

    for (const view of this.surfaces.values()) {
      const inActive = activeWs?.surfaceIds.has(view.id) ?? false;
      view.container.style.display = inActive ? "flex" : "none";
      // Manage browser webview OOPIF overlay visibility
      if (view.browserView) {
        browserPaneSetHidden(view.browserView, !inActive);
      }
    }

    if (activeWs) {
      document.documentElement.style.setProperty(
        "--workspace-accent",
        activeWs.color,
      );
      this.applyLayout();
      const ids = activeWs.layout.getAllSurfaceIds();
      if (
        this.focusedSurfaceId &&
        activeWs.surfaceIds.has(this.focusedSurfaceId)
      ) {
        this.focusSurface(this.focusedSurfaceId);
      } else if (ids.length > 0) {
        this.focusSurface(ids[0]);
      }
      this.updateTitlebar(activeWs);
    } else {
      this.updateTitlebar(null);
    }

    this.updateSidebar();
  }

  private removeWorkspace(index: number): void {
    this.workspaces.splice(index, 1);

    if (this.workspaces.length === 0) {
      this.activeWorkspaceIndex = -1;
      this.focusedSurfaceId = null;
    } else {
      const newIndex = Math.min(index, this.workspaces.length - 1);
      this.switchToWorkspace(newIndex);
    }
    this.updateSidebar();
  }

  private updateSidebar(): void {
    this.sidebar.setWorkspaces(
      buildSidebarWorkspaces({
        workspaces: this.workspaces,
        surfaces: this.surfaces,
        focusedSurfaceId: this.focusedSurfaceId,
        activeWorkspaceIndex: this.activeWorkspaceIndex,
        metadata: this.metadata,
        selectedCwds: this.selectedCwds,
        scriptErrors: this.scriptErrors,
      }),
    );
    this.notifyWorkspaceChanged();
  }

  private updateTitlebar(workspace: Workspace | null): void {
    const titleEl = document.getElementById("titlebar-text");

    if (titleEl) {
      titleEl.textContent = workspace?.name ?? "τ-mux";
    }

    const badgeEl = document.getElementById("titlebar-badge-text");
    if (badgeEl) {
      badgeEl.textContent = workspace
        ? `Workspace ${String(this.activeWorkspaceIndex + 1).padStart(2, "0")}`
        : "No Workspace";
    }
  }

  private createBrowserSurfaceView(
    surfaceId: string,
    url: string,
  ): SurfaceView {
    const browserView = createBrowserPaneView(surfaceId, url, {
      onNavigated: (sid, navUrl, navTitle) => {
        window.dispatchEvent(
          new CustomEvent("ht-browser-navigated", {
            detail: { surfaceId: sid, url: navUrl, title: navTitle },
          }),
        );
      },
      onTitleChanged: (sid, newTitle) => {
        const view = this.surfaces.get(sid);
        if (view) {
          view.title = newTitle;
          view.titleEl.textContent = newTitle;
        }
        window.dispatchEvent(
          new CustomEvent("ht-browser-title-changed", {
            detail: { surfaceId: sid, title: newTitle },
          }),
        );
        this.updateSidebar();
      },
      onNewWindow: (sid, newUrl) => {
        // Open links from the page in the same browser pane
        const view = this.surfaces.get(sid);
        if (view?.browserView) {
          browserPaneNavigateTo(view.browserView, newUrl);
        }
      },
      onFocus: (sid) => {
        this.focusSurface(sid);
      },
      onClose: (sid) => {
        window.dispatchEvent(
          new CustomEvent("ht-close-surface", {
            detail: { surfaceId: sid },
          }),
        );
      },
      onSplit: (sid, direction) => {
        window.dispatchEvent(
          new CustomEvent("ht-split", {
            detail: { surfaceId: sid, direction },
          }),
        );
      },
      onEvalResult: (sid, reqId, result, error) => {
        window.dispatchEvent(
          new CustomEvent("ht-browser-eval-result", {
            detail: { surfaceId: sid, reqId, result, error },
          }),
        );
      },
      onConsoleLog: (sid, level, args, timestamp) => {
        window.dispatchEvent(
          new CustomEvent("ht-browser-console-log", {
            detail: { surfaceId: sid, level, args, timestamp },
          }),
        );
      },
      onError: (sid, message, filename, lineno, timestamp) => {
        window.dispatchEvent(
          new CustomEvent("ht-browser-error", {
            detail: { surfaceId: sid, message, filename, lineno, timestamp },
          }),
        );
      },
      onDomReady: (sid, domUrl) => {
        window.dispatchEvent(
          new CustomEvent("ht-browser-dom-ready", {
            detail: { surfaceId: sid, url: domUrl },
          }),
        );
      },
    });

    this.terminalContainer.appendChild(browserView.container);

    return {
      id: surfaceId,
      surfaceType: "browser",
      term: null,
      fitAddon: null,
      searchAddon: null,
      effects: null,
      panelManager: null,
      panelsEl: null,
      browserView,
      agentView: null,
      telegramView: null,
      container: browserView.container,
      titleEl: browserView.titleEl,
      chipsEl: browserView.chipsEl,
      title: browserView.title,
    };
  }

  private createAgentSurfaceView(
    surfaceId: string,
    agentId: string,
  ): SurfaceView {
    const agentView = createAgentPaneView(surfaceId, agentId, {
      onSendPrompt: (aid, message, images) => {
        window.dispatchEvent(
          new CustomEvent("ht-agent-prompt", {
            detail: { agentId: aid, message, images },
          }),
        );
      },
      onAbort: (aid) => {
        window.dispatchEvent(
          new CustomEvent("ht-agent-abort", { detail: { agentId: aid } }),
        );
      },
      onSetModel: (aid, provider, modelId) => {
        window.dispatchEvent(
          new CustomEvent("ht-agent-set-model", {
            detail: { agentId: aid, provider, modelId },
          }),
        );
      },
      onSetThinking: (aid, level) => {
        window.dispatchEvent(
          new CustomEvent("ht-agent-set-thinking", {
            detail: { agentId: aid, level },
          }),
        );
      },
      onNewSession: (aid) => {
        window.dispatchEvent(
          new CustomEvent("ht-agent-new-session", { detail: { agentId: aid } }),
        );
      },
      onCompact: (aid) => {
        window.dispatchEvent(
          new CustomEvent("ht-agent-compact", { detail: { agentId: aid } }),
        );
      },
      onClose: (sid) => {
        window.dispatchEvent(
          new CustomEvent("ht-close-surface", { detail: { surfaceId: sid } }),
        );
      },
      onSplit: (sid, direction) => {
        window.dispatchEvent(
          new CustomEvent("ht-split", {
            detail: { surfaceId: sid, direction },
          }),
        );
      },
      onFocus: (sid) => {
        this.focusSurface(sid);
      },
      onGetModels: (aid) => {
        window.dispatchEvent(
          new CustomEvent("ht-agent-get-models", { detail: { agentId: aid } }),
        );
      },
      onGetState: (aid) => {
        window.dispatchEvent(
          new CustomEvent("ht-agent-get-state", { detail: { agentId: aid } }),
        );
      },
    });

    this.terminalContainer.appendChild(agentView.container);

    return {
      id: surfaceId,
      surfaceType: "agent",
      term: null,
      fitAddon: null,
      searchAddon: null,
      effects: null,
      panelManager: null,
      panelsEl: null,
      browserView: null,
      agentView,
      telegramView: null,
      container: agentView.container,
      titleEl: agentView.titleEl,
      chipsEl: agentView.chipsEl,
      title: agentView.title,
    };
  }

  private createSurfaceView(surfaceId: string, title: string): SurfaceView {
    const container = document.createElement("div");
    container.className = "surface-container";
    container.dataset["surfaceId"] = surfaceId;
    container.style.display = "none";

    // Status bar
    const bar = document.createElement("div");
    bar.className = "surface-bar";

    const barTitleWrap = document.createElement("div");
    barTitleWrap.className = "surface-bar-title-wrap";

    const barIcon = createIcon("terminal", "surface-bar-icon", 12);
    barTitleWrap.appendChild(barIcon);

    const barTitle = document.createElement("span");
    barTitle.className = "surface-bar-title";
    barTitle.textContent = title;
    barTitleWrap.appendChild(barTitle);
    bar.appendChild(barTitleWrap);

    const chipsEl = document.createElement("div");
    chipsEl.className = "surface-bar-chips";
    bar.appendChild(chipsEl);

    const barActions = document.createElement("div");
    barActions.className = "surface-bar-actions";

    const infoBtn = document.createElement("button");
    infoBtn.className = "surface-bar-btn";
    infoBtn.title = "Pane Info (\u2318I)";
    infoBtn.setAttribute("aria-label", "Pane info");
    infoBtn.append(createIcon("info"));
    infoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("ht-show-surface-info", { detail: { surfaceId } }),
      );
    });
    barActions.appendChild(infoBtn);

    const splitRightBtn = document.createElement("button");
    splitRightBtn.className = "surface-bar-btn";
    splitRightBtn.title = "Split Right (Cmd+D)";
    splitRightBtn.setAttribute("aria-label", "Split right");
    splitRightBtn.append(createIcon("splitHorizontal"));
    splitRightBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("ht-split", {
          detail: { surfaceId, direction: "horizontal" },
        }),
      );
    });
    barActions.appendChild(splitRightBtn);

    const splitDownBtn = document.createElement("button");
    splitDownBtn.className = "surface-bar-btn";
    splitDownBtn.title = "Split Down (Cmd+Shift+D)";
    splitDownBtn.setAttribute("aria-label", "Split down");
    splitDownBtn.append(createIcon("splitVertical"));
    splitDownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("ht-split", {
          detail: { surfaceId, direction: "vertical" },
        }),
      );
    });
    barActions.appendChild(splitDownBtn);

    const closeBtn = document.createElement("button");
    closeBtn.className = "surface-bar-btn surface-bar-close";
    closeBtn.title = "Close (Cmd+W)";
    closeBtn.setAttribute("aria-label", "Close pane");
    closeBtn.append(createIcon("close"));
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("ht-close-surface", { detail: { surfaceId } }),
      );
    });
    barActions.appendChild(closeBtn);

    bar.appendChild(barActions);
    this.paneDrag.setupSurfaceDrag(surfaceId, bar);

    bar.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.focusSurface(surfaceId);
      const detail: SurfaceContextMenuRequest = {
        kind: "surface",
        surfaceId,
        title:
          this.surfaces.get(surfaceId)?.title ??
          barTitle.textContent ??
          surfaceId,
        x: e.clientX,
        y: e.clientY,
      };
      window.dispatchEvent(
        new CustomEvent("ht-open-surface-context-menu", {
          detail,
        }),
      );
    });

    container.appendChild(bar);

    const termEl = document.createElement("div");
    termEl.className = "surface-terminal";
    const termLayerEl = document.createElement("div");
    termLayerEl.className = "surface-terminal-layer";
    termEl.appendChild(termLayerEl);
    container.appendChild(termEl);

    const panelsEl = document.createElement("div");
    panelsEl.className = "surface-panels";
    termEl.appendChild(panelsEl);

    this.terminalContainer.appendChild(container);

    const term = new Terminal({
      theme: defaultGlassTheme,
      fontFamily:
        "'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Berkeley Mono', 'SF Mono', 'Menlo', monospace",
      fontSize: this.fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      allowTransparency: true,
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);
    term.open(termLayerEl);

    const effects = new TerminalEffects(termEl, term);
    effects.setEnabled(this.terminalEffectsEnabled);

    term.onData((data) => {
      effects.pulseInput(data.length);
      this.onStdin(surfaceId, data);
    });

    // OSC 0/2 title propagation: programs like `vim`, `htop`, `ssh` emit
    // these escapes to set the terminal window title. Before this, the
    // sidebar + pane bar always showed the login shell's basename (usually
    // "zsh") even while vim was editing a file. Cap at 60 chars so a
    // runaway title can't blow out the sidebar layout.
    // `onTitleChange` is only present on the real xterm instance; the
    // happy-dom SurfaceManager test mock stubs `Terminal` without it.
    // Guard the call so tests don't need to teach their mock a new
    // method each time we subscribe to another xterm event.
    if (typeof term.onTitleChange === "function") {
      term.onTitleChange((title) => {
        const clean = title.trim().slice(0, 60);
        if (!clean) return;
        this.renameSurface(surfaceId, clean, { fromOsc: true });
      });
    }

    container.addEventListener("mousedown", () => {
      this.focusSurface(surfaceId);
    });

    const panelManager = new PanelManager(panelsEl, term, (event) => {
      this.onPanelEvent(surfaceId, event);
    });

    term.onScroll(() => panelManager.updateInlinePanels());

    return {
      id: surfaceId,
      surfaceType: "terminal" as const,
      term,
      fitAddon,
      searchAddon,
      effects,
      panelManager,
      panelsEl,
      browserView: null,
      agentView: null,
      telegramView: null,
      container,
      titleEl: barTitle,
      chipsEl,
      title,
    };
  }

  private createTelegramSurfaceView(surfaceId: string): SurfaceView {
    const telegramView = createTelegramPaneView(surfaceId, {
      onSend: (chatId, text) => {
        window.dispatchEvent(
          new CustomEvent("ht-telegram-send", {
            detail: { chatId, text },
          }),
        );
      },
      onRequestHistory: (chatId, before) => {
        window.dispatchEvent(
          new CustomEvent("ht-telegram-request-history", {
            detail: { chatId, before },
          }),
        );
      },
      onRequestState: () => {
        window.dispatchEvent(new CustomEvent("ht-telegram-request-state"));
      },
      onClose: (sid) => {
        window.dispatchEvent(
          new CustomEvent("ht-close-surface", { detail: { surfaceId: sid } }),
        );
      },
      onSplit: (sid, direction) => {
        window.dispatchEvent(
          new CustomEvent("ht-split", {
            detail: { surfaceId: sid, direction },
          }),
        );
      },
      onFocus: (sid) => this.focusSurface(sid),
    });

    this.terminalContainer.appendChild(telegramView.container);

    return {
      id: surfaceId,
      surfaceType: "telegram",
      term: null,
      fitAddon: null,
      searchAddon: null,
      effects: null,
      panelManager: null,
      panelsEl: null,
      browserView: null,
      agentView: null,
      telegramView,
      container: telegramView.container,
      titleEl: telegramView.titleEl,
      chipsEl: telegramView.chipsEl,
      title: telegramView.title,
    };
  }

  private applyLayout(): void {
    this.applyPositions();
    const ws = this.activeWorkspace();
    if (!ws) return;
    for (const surfaceId of ws.surfaceIds) {
      const view = this.surfaces.get(surfaceId);
      if (!view) continue;
      if (view.surfaceType === "browser") {
        // Browser panes: sync the OOPIF overlay dimensions
        if (view.browserView) {
          browserPaneSyncDimensions(view.browserView);
        }
      } else if (view.surfaceType === "telegram") {
        // Telegram panes are pure DOM — no terminal to fit, no OOPIF to
        // size. The container was already positioned in applyPositions().
      } else {
        fitSurfaceTerminal(view);
        view.effects?.setFocused(view.id === this.focusedSurfaceId);
        if (view.term) {
          this.onResize(surfaceId, view.term.cols, view.term.rows);
        }
        view.panelManager?.updateInlinePanels();
      }
    }
  }

  private applyPositions(): void {
    const ws = this.activeWorkspace();
    if (!ws) return;

    const bounds = {
      x: 0,
      y: 0,
      w: this.terminalContainer.offsetWidth,
      h: this.terminalContainer.offsetHeight,
    };

    if (bounds.w === 0 || bounds.h === 0) return;

    const rects = ws.layout.computeRects(bounds);
    let bottomRightSurfaceId: string | null = null;
    let bottomMost = -1;
    let rightMost = -1;

    for (const [surfaceId, rect] of rects) {
      const bottom = rect.y + rect.h;
      const right = rect.x + rect.w;
      if (bottom > bottomMost || (bottom === bottomMost && right > rightMost)) {
        bottomMost = bottom;
        rightMost = right;
        bottomRightSurfaceId = surfaceId;
      }
    }

    for (const [surfaceId, rect] of rects) {
      const view = this.surfaces.get(surfaceId);
      if (!view) continue;

      const s = view.container.style;
      s.left = `${rect.x}px`;
      s.top = `${rect.y}px`;
      s.width = `${rect.w}px`;
      s.height = `${rect.h}px`;
      s.display = "flex";
      view.container.classList.toggle(
        "surface-window-corner",
        surfaceId === bottomRightSurfaceId,
      );
    }

    this.renderDividers(ws, bounds);
  }

  private renderDividers(
    ws: Workspace,
    bounds: { x: number; y: number; w: number; h: number },
  ): void {
    for (const el of this.dividerEls) el.remove();
    this.dividerEls = [];

    const dividers = ws.layout.getDividers(bounds);

    for (const div of dividers) {
      const el = document.createElement("div");
      el.className = `pane-divider ${div.direction}`;
      el.style.left = `${div.x}px`;
      el.style.top = `${div.y}px`;
      el.style.width = `${div.direction === "horizontal" ? 6 : div.w}px`;
      el.style.height = `${div.direction === "vertical" ? 6 : div.h}px`;
      if (div.direction === "horizontal") {
        el.style.left = `${div.x - 2}px`;
      } else {
        el.style.top = `${div.y - 2}px`;
      }

      const splitNode = div.node;

      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const startPos = div.direction === "horizontal" ? e.clientX : e.clientY;
        const startRatio = splitNode.ratio;
        const totalSize = div.direction === "horizontal" ? bounds.w : bounds.h;

        const onMove = (me: MouseEvent) => {
          const currentPos =
            div.direction === "horizontal" ? me.clientX : me.clientY;
          const delta = currentPos - startPos;
          splitNode.ratio = Math.max(
            0.1,
            Math.min(0.9, startRatio + delta / totalSize),
          );
          this.applyPositions();
        };

        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          this.applyLayout();
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      this.terminalContainer.appendChild(el);
      this.dividerEls.push(el);
    }
  }
}

// --- Surface chips renderer -------------------------------------------------

function renderSurfaceChips(host: HTMLElement, meta: SurfaceMetadata): void {
  // Bail if the chips row would be byte-identical to the last render.
  // Metadata broadcasts at 1 Hz per surface and the poller already
  // de-dupes equivalent snapshots — but workspace switches, focus
  // changes, and web-mirror replays all trigger a re-render, so it's
  // still worth skipping the DOM churn when the visible data is
  // unchanged. Cheap hash, no JSON.stringify.
  const sig = chipsSignature(meta);
  if (host.dataset["chipsSig"] === sig) return;
  host.dataset["chipsSig"] = sig;

  host.replaceChildren();

  const fg = meta.tree.find((n) => n.pid === meta.foregroundPid);
  // Hide command chip when the foreground IS the shell itself — rendering
  // "zsh" / "bash" forever is noise.
  const showCommand =
    fg && meta.foregroundPid !== meta.pid && fg.command.length > 0;
  if (showCommand) {
    host.appendChild(buildChip("chip-command", truncate(fg.command, 48)));
  }

  if (meta.cwd) {
    const chip = buildChip("chip-cwd", shortenCwd(meta.cwd));
    chip.title = meta.cwd;
    host.appendChild(chip);
  }

  if (meta.git) {
    const chip = document.createElement("span");
    chip.className = "surface-chip chip-git";
    if (isDirtyGit(meta.git)) chip.classList.add("dirty");
    chip.title = formatGitTooltip(meta.git);
    fillGitChip(chip, meta.git);
    host.appendChild(chip);
  }

  // Dedup ports shown in the chip row by port number (a single proc often
  // binds both v4 and v6 for the same port).
  const seen = new Set<number>();
  for (const p of meta.listeningPorts) {
    if (seen.has(p.port)) continue;
    seen.add(p.port);
    const chip = buildChip("chip-port", `:${p.port}`);
    chip.title = `${p.proto} ${p.address}:${p.port} (pid ${p.pid}) — click to open`;
    chip.setAttribute("role", "button");
    chip.tabIndex = 0;
    const url = `http://localhost:${p.port}`;
    const open = (e: Event): void => {
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("ht-open-external", { detail: { url } }),
      );
    };
    chip.addEventListener("click", open);
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") open(e);
    });
    host.appendChild(chip);
  }
}

function buildChip(cls: string, text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = `surface-chip ${cls}`;
  el.textContent = text;
  return el;
}

/** Terse signature of the rendered chip row. Any change in the inputs
 *  that renderSurfaceChips actually reads produces a different string;
 *  unchanged inputs produce the same string. Used to skip redundant
 *  DOM rebuilds. */
function chipsSignature(meta: SurfaceMetadata): string {
  const fg = meta.tree.find((n) => n.pid === meta.foregroundPid);
  const cmd = fg && meta.foregroundPid !== meta.pid ? fg.command : "";
  const ports = meta.listeningPorts
    .map((p) => p.port)
    .filter((p, i, a) => a.indexOf(p) === i)
    .join(",");
  const git = meta.git
    ? `${meta.git.branch ?? ""}|${meta.git.ahead}|${meta.git.behind}|` +
      `${meta.git.staged}|${meta.git.unstaged}|${meta.git.untracked}|` +
      `${meta.git.conflicts}|${meta.git.insertions}|${meta.git.deletions}`
    : "";
  return `${cmd}\u0001${meta.cwd ?? ""}\u0001${git}\u0001${ports}`;
}

/**
 * Compact cwd for the chip — last 2 path segments are almost always enough
 * context. Full absolute path lives on the chip's title attribute.
 */
function shortenCwd(cwd: string): string {
  if (cwd === "/") return "/";
  const parts = cwd.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length <= 2)
    return cwd.startsWith("/") ? "/" + parts.join("/") : parts.join("/");
  return "\u2026/" + parts.slice(-2).join("/");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

function isDirtyGit(g: NonNullable<SurfaceMetadata["git"]>): boolean {
  return (
    g.staged > 0 ||
    g.unstaged > 0 ||
    g.untracked > 0 ||
    g.conflicts > 0 ||
    g.insertions > 0 ||
    g.deletions > 0
  );
}

/**
 * Build the git chip DOM: branch (neutral), optional ahead/behind + conflicts,
 * then green `+insertions` and red `-deletions` (from `git diff HEAD`). We
 * show line counts instead of staged/unstaged/untracked file counts because
 * +/- lines is what most prompts use and it's the most at-a-glance useful
 * signal; the full file-count breakdown lives in the hover tooltip.
 */
function fillGitChip(
  el: HTMLSpanElement,
  g: NonNullable<SurfaceMetadata["git"]>,
): void {
  el.replaceChildren();

  const branch = document.createElement("span");
  branch.className = "chip-git-branch";
  branch.textContent = "\u2387 " + g.branch;
  el.appendChild(branch);

  if (g.ahead > 0)
    el.appendChild(gitSpan("chip-git-ahead", `\u2191${g.ahead}`));
  if (g.behind > 0)
    el.appendChild(gitSpan("chip-git-behind", `\u2193${g.behind}`));
  if (g.conflicts > 0)
    el.appendChild(gitSpan("chip-git-conflicts", `!${g.conflicts}`));
  if (g.insertions > 0)
    el.appendChild(gitSpan("chip-git-add", `+${g.insertions}`));
  if (g.deletions > 0)
    el.appendChild(gitSpan("chip-git-del", `\u2212${g.deletions}`));
}

function gitSpan(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}

function formatGitTooltip(g: NonNullable<SurfaceMetadata["git"]>): string {
  const lines: string[] = [];
  lines.push(`branch: ${g.branch}${g.head ? " @ " + g.head : ""}`);
  if (g.upstream) {
    const ab: string[] = [];
    if (g.ahead > 0) ab.push(`↑${g.ahead}`);
    if (g.behind > 0) ab.push(`↓${g.behind}`);
    lines.push(
      `upstream: ${g.upstream}${ab.length ? " (" + ab.join(" ") + ")" : ""}`,
    );
  }
  if (g.staged || g.unstaged || g.untracked || g.conflicts) {
    lines.push(
      `files: ${g.staged} staged, ${g.unstaged} unstaged, ${g.untracked} untracked${g.conflicts ? `, ${g.conflicts} conflicts` : ""}`,
    );
  }
  if (g.insertions || g.deletions) {
    lines.push(`diff vs HEAD: +${g.insertions} -${g.deletions}`);
  }
  return lines.join("\n");
}

/**
 * Fit a terminal to its parent container's full width/height — no 14 px
 * scrollbar-gutter shave. FitAddon hardcodes `overviewRuler?.width || 14`
 * as an unconditional subtraction whenever `scrollback !== 0`, which costs
 * us a column or two on every pane. We hide the scrollbar via CSS already,
 * so there's no reason for FitAddon to reserve the gutter at all.
 *
 * Same math as FitAddon.proposeDimensions otherwise: parent getComputedStyle
 * width/height minus the terminal element's padding, floor-divided by the
 * cell dimensions the render service computed.
 */
function fitSurfaceTerminal(view: {
  term: Terminal | null;
  fitAddon: FitAddon | null;
}): void {
  const term = view.term;
  if (!term || !view.fitAddon) return;
  if (!term.element?.parentElement) return;

  const core = (
    term as unknown as {
      _core?: {
        _renderService?: {
          dimensions?: { css?: { cell?: { width: number; height: number } } };
          clear(): void;
        };
      };
    }
  )._core;
  const cell = core?._renderService?.dimensions?.css?.cell;
  if (!cell || !cell.width || !cell.height) {
    // Render service not ready — defer to FitAddon which has its own first-
    // frame guards; it'll subtract 14 px for one tick then we'll catch up.
    view.fitAddon.fit();
    return;
  }

  const ps = window.getComputedStyle(term.element.parentElement);
  const w = Math.max(0, parseInt(ps.getPropertyValue("width")) || 0);
  const h = parseInt(ps.getPropertyValue("height")) || 0;
  const es = window.getComputedStyle(term.element);
  const padX =
    (parseInt(es.getPropertyValue("padding-left")) || 0) +
    (parseInt(es.getPropertyValue("padding-right")) || 0);
  const padY =
    (parseInt(es.getPropertyValue("padding-top")) || 0) +
    (parseInt(es.getPropertyValue("padding-bottom")) || 0);

  const cols = Math.max(2, Math.floor((w - padX) / cell.width));
  const rows = Math.max(1, Math.floor((h - padY) / cell.height));
  if (term.cols === cols && term.rows === rows) return;
  core._renderService?.clear();
  term.resize(cols, rows);
}

function focusSurfaceTerminal(
  view:
    | {
        term: Terminal | null;
        container: ParentNode;
      }
    | null
    | undefined,
): void {
  if (!view?.term) return;
  focusXtermPreservingScroll(view.term, view.container);
}
