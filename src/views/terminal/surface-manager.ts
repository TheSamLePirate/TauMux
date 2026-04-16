import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { PanelManager } from "./panel-manager";
import {
  PaneLayout,
  setPaneGap,
  type PaneDropPosition,
  type PaneRect,
} from "./pane-layout";
import { Sidebar } from "./sidebar";
import { createIcon } from "./icons";
import { TerminalEffects } from "./terminal-effects";
import type {
  PackageInfo,
  PanelEvent,
  PersistedLayout,
  SidebandMetaMessage,
  SurfaceContextMenuRequest,
  SurfaceMetadata,
} from "../../shared/types";
import { WORKSPACE_COLORS } from "../../shared/workspace-colors";
import { type AppSettings, hexToRgb } from "../../shared/settings";
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

const PANE_DRAG_THRESHOLD = 8;

interface SurfaceView {
  id: string;
  surfaceType: "terminal" | "browser" | "agent";
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
  // Shared
  container: HTMLDivElement;
  titleEl: HTMLSpanElement;
  chipsEl: HTMLDivElement;
  title: string;
}

interface Workspace {
  id: string;
  layout: PaneLayout;
  surfaceIds: Set<string>;
  name: string;
  color: string;
  status: Map<string, { value: string; icon?: string; color?: string }>;
  progress: { value: number; label?: string } | null;
  logs: { level: string; message: string; source?: string; time: number }[];
}

interface PaneDragHover {
  targetId: string;
  position: PaneDropPosition;
  bounds: PaneRect;
}

interface PaneDragState {
  surfaceId: string;
  offsetX: number;
  offsetY: number;
  ghostEl: HTMLDivElement;
  hover: PaneDragHover | null;
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
  private activePaneDrag: PaneDragState | null = null;
  private dropOverlayEl: HTMLDivElement | null = null;
  private dropOverlayLabelEl: HTMLSpanElement | null = null;
  private highlightedDropTargetId: string | null = null;
  private fontSize: number;
  private searchBarEl: HTMLDivElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private searchVisible = false;
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

  /** Add a surface as a new workspace. */
  addSurface(surfaceId: string, title: string): void {
    const view = this.createSurfaceView(surfaceId, title);
    this.surfaces.set(surfaceId, view);

    const ws: Workspace = {
      id: `ws:${++this.wsCounter}`,
      layout: new PaneLayout(surfaceId),
      surfaceIds: new Set([surfaceId]),
      name: title,
      color: WORKSPACE_COLORS[(this.wsCounter - 1) % WORKSPACE_COLORS.length],
      status: new Map(),
      progress: null,
      logs: [],
    };
    this.workspaces.push(ws);
    this.switchToWorkspace(this.workspaces.length - 1);
    this.updateSidebar();

    this.scheduleLayoutForNewSurface(() => view.term?.focus());
  }

  /** Add a browser surface as a new workspace. */
  addBrowserSurface(surfaceId: string, url: string): void {
    const view = this.createBrowserSurfaceView(surfaceId, url);
    this.surfaces.set(surfaceId, view);

    const ws: Workspace = {
      id: `ws:${++this.wsCounter}`,
      layout: new PaneLayout(surfaceId),
      surfaceIds: new Set([surfaceId]),
      name: "Browser",
      color: WORKSPACE_COLORS[(this.wsCounter - 1) % WORKSPACE_COLORS.length],
      status: new Map(),
      progress: null,
      logs: [],
    };
    this.workspaces.push(ws);
    this.switchToWorkspace(this.workspaces.length - 1);
    this.updateSidebar();
    this.scheduleLayoutForNewSurface(() => this.focusSurface(surfaceId));
  }

  /** Add a browser surface as a split within the active workspace. */
  addBrowserSurfaceAsSplit(
    surfaceId: string,
    url: string,
    splitFrom: string,
    direction: "horizontal" | "vertical",
  ): void {
    const view = this.createBrowserSurfaceView(surfaceId, url);
    this.surfaces.set(surfaceId, view);

    const ws = this.activeWorkspace();
    if (!ws) return;

    ws.layout.splitSurface(splitFrom, direction, surfaceId);
    ws.surfaceIds.add(surfaceId);

    this.scheduleLayoutForNewSurface(() => this.focusSurface(surfaceId));
  }

  /** Remove a browser surface (same as removeSurface — shared logic). */
  removeBrowserSurface(surfaceId: string): void {
    this.removeSurface(surfaceId);
  }

  /** Add an agent surface as a new workspace. */
  addAgentSurface(surfaceId: string, agentId: string): void {
    const view = this.createAgentSurfaceView(surfaceId, agentId);
    this.surfaces.set(surfaceId, view);

    const ws: Workspace = {
      id: `ws:${++this.wsCounter}`,
      layout: new PaneLayout(surfaceId),
      surfaceIds: new Set([surfaceId]),
      name: "Pi Agent",
      color: WORKSPACE_COLORS[(this.wsCounter - 1) % WORKSPACE_COLORS.length],
      status: new Map(),
      progress: null,
      logs: [],
    };
    this.workspaces.push(ws);
    this.switchToWorkspace(this.workspaces.length - 1);
    this.updateSidebar();
    this.scheduleLayoutForNewSurface(() => this.focusSurface(surfaceId));
  }

  /** Add an agent surface as a split within the active workspace. */
  addAgentSurfaceAsSplit(
    surfaceId: string,
    agentId: string,
    splitFrom: string,
    direction: "horizontal" | "vertical",
  ): void {
    const view = this.createAgentSurfaceView(surfaceId, agentId);
    this.surfaces.set(surfaceId, view);

    const ws = this.activeWorkspace();
    if (!ws) return;

    ws.layout.splitSurface(splitFrom, direction, surfaceId);
    ws.surfaceIds.add(surfaceId);

    this.scheduleLayoutForNewSurface(() => this.focusSurface(surfaceId));
  }

  /** Remove an agent surface (same as removeSurface — shared logic). */
  removeAgentSurface(surfaceId: string): void {
    this.removeSurface(surfaceId);
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
    this.surfaces.set(surfaceId, view);

    const ws = this.activeWorkspace();
    if (!ws) return;

    ws.layout.splitSurface(splitFrom, direction, surfaceId);
    ws.surfaceIds.add(surfaceId);

    this.scheduleLayoutForNewSurface(() => this.focusSurface(surfaceId));
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

    if (
      this.activePaneDrag?.surfaceId === surfaceId ||
      this.highlightedDropTargetId === surfaceId
    ) {
      this.cleanupPaneDrag();
    }

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
    view.container.remove();
    this.surfaces.delete(surfaceId);
    this.metadata.delete(surfaceId);
    this.updateSidebar();
  }

  focusSurface(surfaceId: string): void {
    this.focusedSurfaceId = surfaceId;
    for (const v of this.surfaces.values()) {
      v.container.classList.toggle("focused", v.id === surfaceId);
      v.effects?.setFocused(v.id === surfaceId);
    }
    // Clear notification glow when surface becomes selected
    this.clearGlow(surfaceId);
    const focusedView = this.surfaces.get(surfaceId);
    if (focusedView?.surfaceType === "browser" && focusedView.browserView) {
      // Browser panes don't have a terminal to focus
    } else {
      focusedView?.term?.focus();
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

  handleSidebandMeta(surfaceId: string, msg: SidebandMetaMessage): void {
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
    if (!view || view.surfaceType === "browser") return null;
    return view.term;
  }

  getActiveSurfaceType(): "terminal" | "browser" | "agent" | null {
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
      if (view.surfaceType === "browser") continue;
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
      if (view.surfaceType === "browser" || !view.term) continue;
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
    if (this.searchVisible) {
      this.hideSearchBar();
    } else {
      this.showSearchBar();
    }
  }

  private showSearchBar(): void {
    if (this.searchVisible) {
      this.searchInputEl?.focus();
      return;
    }
    this.searchVisible = true;

    if (!this.searchBarEl) {
      this.searchBarEl = document.createElement("div");
      this.searchBarEl.className = "search-bar";

      this.searchInputEl = document.createElement("input");
      this.searchInputEl.className = "search-bar-input";
      this.searchInputEl.type = "text";
      this.searchInputEl.placeholder = "Find in terminal\u2026";
      this.searchInputEl.setAttribute("aria-label", "Search terminal");

      const prevBtn = document.createElement("button");
      prevBtn.className = "search-bar-btn";
      prevBtn.title = "Previous (Shift+Enter)";
      prevBtn.setAttribute("aria-label", "Previous match");
      prevBtn.append(createIcon("chevronUp", "", 14));
      prevBtn.addEventListener("click", () => this.searchPrevious());

      const nextBtn = document.createElement("button");
      nextBtn.className = "search-bar-btn";
      nextBtn.title = "Next (Enter)";
      nextBtn.setAttribute("aria-label", "Next match");
      nextBtn.append(createIcon("chevronDown", "", 14));
      nextBtn.addEventListener("click", () => this.searchNext());

      const closeBtn = document.createElement("button");
      closeBtn.className = "search-bar-btn search-bar-close";
      closeBtn.title = "Close (Escape)";
      closeBtn.setAttribute("aria-label", "Close search");
      closeBtn.append(createIcon("close", "", 12));
      closeBtn.addEventListener("click", () => this.hideSearchBar());

      this.searchInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.shiftKey) {
          e.preventDefault();
          this.searchPrevious();
        } else if (e.key === "Enter") {
          e.preventDefault();
          this.searchNext();
        } else if (e.key === "Escape") {
          e.preventDefault();
          this.hideSearchBar();
        }
      });

      this.searchInputEl.addEventListener("input", () => {
        this.searchNext();
      });

      this.searchBarEl.appendChild(this.searchInputEl);
      this.searchBarEl.appendChild(prevBtn);
      this.searchBarEl.appendChild(nextBtn);
      this.searchBarEl.appendChild(closeBtn);
      this.terminalContainer.appendChild(this.searchBarEl);
    }

    this.searchBarEl.classList.add("search-bar-visible");
    this.searchInputEl!.value = "";
    this.searchInputEl!.focus();
  }

  private hideSearchBar(): void {
    if (!this.searchVisible) return;
    this.searchVisible = false;
    this.searchBarEl?.classList.remove("search-bar-visible");

    // Clear search highlighting
    const view = this.focusedSurfaceId
      ? this.surfaces.get(this.focusedSurfaceId)
      : null;
    if (view?.searchAddon) {
      view.searchAddon.clearDecorations();
      view.term?.focus();
    }
  }

  private searchNext(): void {
    const query = this.searchInputEl?.value;
    if (!query) return;
    const view = this.focusedSurfaceId
      ? this.surfaces.get(this.focusedSurfaceId)
      : null;
    view?.searchAddon?.findNext(query);
  }

  private searchPrevious(): void {
    const query = this.searchInputEl?.value;
    if (!query) return;
    const view = this.focusedSurfaceId
      ? this.surfaces.get(this.focusedSurfaceId)
      : null;
    view?.searchAddon?.findPrevious(query);
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

  browserNavigateTo(surfaceId: string | null, url: string): void {
    const id = surfaceId ?? this.focusedSurfaceId;
    if (!id) return;
    const view = this.surfaces.get(id);
    if (view?.browserView) browserPaneNavigateTo(view.browserView, url);
  }

  browserGoBack(surfaceId?: string | null): void {
    const id = surfaceId ?? this.focusedSurfaceId;
    if (!id) return;
    const view = this.surfaces.get(id);
    if (view?.browserView) browserPaneGoBack(view.browserView);
  }

  browserGoForward(surfaceId?: string | null): void {
    const id = surfaceId ?? this.focusedSurfaceId;
    if (!id) return;
    const view = this.surfaces.get(id);
    if (view?.browserView) browserPaneGoForward(view.browserView);
  }

  browserReload(surfaceId?: string | null): void {
    const id = surfaceId ?? this.focusedSurfaceId;
    if (!id) return;
    const view = this.surfaces.get(id);
    if (view?.browserView) browserPaneReload(view.browserView);
  }

  browserEvalJs(
    surfaceId: string | null,
    script: string,
    reqId?: string,
  ): void {
    const id = surfaceId ?? this.focusedSurfaceId;
    if (!id) return;
    const view = this.surfaces.get(id);
    if (view?.browserView) browserPaneEvalJs(view.browserView, script, reqId);
  }

  browserFindInPage(surfaceId?: string | null, query?: string): void {
    const id = surfaceId ?? this.focusedSurfaceId;
    if (!id) return;
    const view = this.surfaces.get(id);
    if (view?.browserView) browserPaneFindInPage(view.browserView, query ?? "");
  }

  browserStopFind(surfaceId?: string | null): void {
    const id = surfaceId ?? this.focusedSurfaceId;
    if (!id) return;
    const view = this.surfaces.get(id);
    if (view?.browserView) browserPaneStopFind(view.browserView);
  }

  browserToggleDevTools(surfaceId?: string | null): void {
    const id = surfaceId ?? this.focusedSurfaceId;
    if (!id) return;
    const view = this.surfaces.get(id);
    if (view?.browserView) browserPaneToggleDevTools(view.browserView);
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
    const view = this.surfaces.get(surfaceId);
    if (view?.browserView) browserPaneInjectCookies(view.browserView, cookies);
  }

  browserGetCookies(surfaceId: string, reqId: string): void {
    const view = this.surfaces.get(surfaceId);
    if (view?.browserView) browserPaneGetCookies(view.browserView, reqId);
  }

  focusBrowserAddressBar(): void {
    const id = this.focusedSurfaceId;
    if (!id) return;
    const view = this.surfaces.get(id);
    if (view?.browserView) browserPaneFocusAddressBar(view.browserView);
  }

  browserZoomIn(): void {
    const id = this.focusedSurfaceId;
    if (!id) return;
    const view = this.surfaces.get(id);
    if (view?.browserView) {
      const newZoom = Math.min(5.0, (view.browserView.zoom || 1.0) + 0.1);
      view.browserView.zoom = newZoom;
      // Notify bun for persistence
      window.dispatchEvent(
        new CustomEvent("ht-browser-zoom", {
          detail: { surfaceId: id, zoom: newZoom },
        }),
      );
    }
  }

  browserZoomOut(): void {
    const id = this.focusedSurfaceId;
    if (!id) return;
    const view = this.surfaces.get(id);
    if (view?.browserView) {
      const newZoom = Math.max(0.25, (view.browserView.zoom || 1.0) - 0.1);
      view.browserView.zoom = newZoom;
      window.dispatchEvent(
        new CustomEvent("ht-browser-zoom", {
          detail: { surfaceId: id, zoom: newZoom },
        }),
      );
    }
  }

  browserZoomReset(): void {
    const id = this.focusedSurfaceId;
    if (!id) return;
    const view = this.surfaces.get(id);
    if (view?.browserView) {
      view.browserView.zoom = 1.0;
      window.dispatchEvent(
        new CustomEvent("ht-browser-zoom", {
          detail: { surfaceId: id, zoom: 1.0 },
        }),
      );
    }
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

  renameSurface(surfaceId: string, title: string): void {
    const view = this.surfaces.get(surfaceId);
    if (!view) return;

    view.title = title;
    view.titleEl.textContent = title;

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
      surfaceTypes?: Record<string, "terminal" | "browser" | "agent">;
    }[];
    activeWorkspaceId: string | null;
  } {
    return {
      workspaces: this.workspaces.map((ws) => {
        const surfaceIds = ws.layout.getAllSurfaceIds();
        const surfaceTitles: Record<string, string> = {};
        const surfaceCwds: Record<string, string> = {};
        const surfaceUrls: Record<string, string> = {};
        const surfaceTypes: Record<string, "terminal" | "browser" | "agent"> =
          {};
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
        return;
      }
    }
    // External notification or unknown surface — glow all surfaces
    for (const view of this.surfaces.values()) {
      view.container.classList.add("notify-glow");
    }
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
  }

  private notifyWorkspaceChanged(): void {
    window.dispatchEvent(new CustomEvent("ht-workspace-changed"));
  }

  // Metadata
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
      ws.status.set(key, { value, icon, color });
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
    this.cleanupPaneDrag();
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
      this.workspaces.map((ws, i) => {
        const surfaceTitles = ws.layout
          .getAllSurfaceIds()
          .map((surfaceId) => this.surfaces.get(surfaceId)?.title ?? surfaceId);
        const focusedSurfaceTitle =
          this.focusedSurfaceId && ws.surfaceIds.has(this.focusedSurfaceId)
            ? (this.surfaces.get(this.focusedSurfaceId)?.title ??
              this.focusedSurfaceId)
            : (surfaceTitles[0] ?? null);

        const portSet = new Set<number>();
        for (const surfaceId of ws.surfaceIds) {
          const meta = this.metadata.get(surfaceId);
          if (!meta) continue;
          for (const p of meta.listeningPorts) portSet.add(p.port);
        }
        const listeningPorts = [...portSet].sort((a, b) => a - b);

        const focusedMeta =
          this.focusedSurfaceId && ws.surfaceIds.has(this.focusedSurfaceId)
            ? (this.metadata.get(this.focusedSurfaceId) ?? null)
            : null;
        const focusedSurfaceCommand =
          focusedMeta && focusedMeta.foregroundPid !== focusedMeta.pid
            ? (focusedMeta.tree.find((n) => n.pid === focusedMeta.foregroundPid)
                ?.command ?? null)
            : null;

        // Collect the distinct cwds across this workspace's surfaces.
        const cwdSet: string[] = [];
        const seen = new Set<string>();
        for (const sid of ws.surfaceIds) {
          const m = this.metadata.get(sid);
          if (!m?.cwd) continue;
          if (seen.has(m.cwd)) continue;
          seen.add(m.cwd);
          cwdSet.push(m.cwd);
        }

        // The user may have pinned a cwd; if it's gone stale (no surface
        // still at that path), drop the pin and fall back to focused.
        const pinned = this.selectedCwds.get(ws.id);
        if (pinned && !seen.has(pinned)) this.selectedCwds.delete(ws.id);
        const effectivePin = this.selectedCwds.get(ws.id) ?? null;
        const selectedCwd = effectivePin ?? focusedMeta?.cwd ?? null;

        // Resolve packageJson by locating the surface whose cwd matches the
        // selected cwd — that surface's snapshot already has the right
        // PackageInfo computed upstream by the poller.
        let packageJson: PackageInfo | null = null;
        if (selectedCwd) {
          for (const sid of ws.surfaceIds) {
            const m = this.metadata.get(sid);
            if (m?.cwd === selectedCwd && m.packageJson) {
              packageJson = m.packageJson;
              break;
            }
          }
        }

        const runningScripts: string[] = [];
        const erroredScripts: string[] = [];
        if (packageJson?.scripts) {
          const knownScripts = Object.keys(packageJson.scripts);
          const running = new Set<string>();
          for (const sid of ws.surfaceIds) {
            const m = this.metadata.get(sid);
            if (!m) continue;
            for (const node of m.tree) {
              const name = extractScriptName(node.command);
              if (name && knownScripts.includes(name)) running.add(name);
            }
          }
          for (const s of knownScripts) {
            if (running.has(s)) runningScripts.push(s);
            else if (this.scriptErrors.has(`${ws.id}:${s}`))
              erroredScripts.push(s);
          }
        }

        return {
          id: ws.id,
          name: ws.name,
          color: ws.color,
          active: i === this.activeWorkspaceIndex,
          paneCount: ws.surfaceIds.size,
          surfaceTitles,
          focusedSurfaceTitle,
          focusedSurfaceCommand,
          statusPills: [...ws.status.entries()].map(([key, s]) => ({
            key,
            value: s.value,
            color: s.color,
            icon: s.icon,
          })),
          progress: ws.progress,
          listeningPorts,
          packageJson,
          runningScripts,
          erroredScripts,
          cwds: cwdSet,
          selectedCwd,
        };
      }),
    );
    this.notifyWorkspaceChanged();
  }

  private updateTitlebar(workspace: Workspace | null): void {
    const titleEl = document.getElementById("titlebar-text");

    if (titleEl) {
      titleEl.textContent = workspace?.name ?? "HyperTerm Canvas";
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
    this.setupSurfaceDrag(surfaceId, bar);

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
      container,
      titleEl: barTitle,
      chipsEl,
      title,
    };
  }

  private setupSurfaceDrag(surfaceId: string, bar: HTMLDivElement): void {
    bar.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".surface-bar-btn")) return;

      const ws = this.activeWorkspace();
      if (!ws || !ws.surfaceIds.has(surfaceId)) return;

      this.focusSurface(surfaceId);

      if (ws.surfaceIds.size < 2) return;

      const view = this.surfaces.get(surfaceId);
      if (!view) return;

      e.preventDefault();

      const rect = view.container.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      let dragStarted = false;

      const onMove = (moveEvent: MouseEvent) => {
        if (!dragStarted) {
          const distance = Math.hypot(
            moveEvent.clientX - e.clientX,
            moveEvent.clientY - e.clientY,
          );
          if (distance < PANE_DRAG_THRESHOLD) return;
          dragStarted = true;
          this.startPaneDrag(surfaceId, offsetX, offsetY);
        }

        this.updatePaneDrag(moveEvent.clientX, moveEvent.clientY);
      };

      const onUp = (upEvent: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);

        if (!dragStarted) return;
        this.finishPaneDrag(upEvent.clientX, upEvent.clientY);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  private startPaneDrag(
    surfaceId: string,
    offsetX: number,
    offsetY: number,
  ): void {
    this.cleanupPaneDrag();

    const view = this.surfaces.get(surfaceId);
    if (!view) return;

    const ghostEl = document.createElement("div");
    ghostEl.className = "surface-drag-ghost";
    ghostEl.style.width = `${view.container.offsetWidth}px`;
    ghostEl.style.height = `${view.container.offsetHeight}px`;

    const header = document.createElement("div");
    header.className = "surface-drag-ghost-header";

    const title = document.createElement("span");
    title.className = "surface-drag-ghost-title";
    title.textContent = view.title;
    header.appendChild(title);

    const badge = document.createElement("span");
    badge.className = "surface-drag-ghost-badge";
    badge.textContent = "Move pane";
    header.appendChild(badge);

    ghostEl.appendChild(header);
    this.terminalContainer.appendChild(ghostEl);
    view.container.classList.add("drag-origin");
    this.terminalContainer.classList.add("pane-drag-active");
    document.body.classList.add("pane-dragging");

    this.activePaneDrag = {
      surfaceId,
      offsetX,
      offsetY,
      ghostEl,
      hover: null,
    };
  }

  private updatePaneDrag(clientX: number, clientY: number): void {
    const drag = this.activePaneDrag;
    if (!drag) return;

    const containerRect = this.terminalContainer.getBoundingClientRect();
    const maxX = Math.max(0, containerRect.width - drag.ghostEl.offsetWidth);
    const maxY = Math.max(0, containerRect.height - drag.ghostEl.offsetHeight);
    const nextX = clientX - containerRect.left - drag.offsetX;
    const nextY = clientY - containerRect.top - drag.offsetY;

    drag.ghostEl.style.left = `${Math.max(-24, Math.min(maxX + 24, nextX))}px`;
    drag.ghostEl.style.top = `${Math.max(-24, Math.min(maxY + 24, nextY))}px`;

    drag.hover = this.resolvePaneDropHover(drag.surfaceId, clientX, clientY);
    this.renderPaneDropOverlay(drag.hover);
  }

  private finishPaneDrag(clientX: number, clientY: number): void {
    if (!this.activePaneDrag) return;

    this.updatePaneDrag(clientX, clientY);

    const drag = this.activePaneDrag;
    const ws = this.activeWorkspace();
    const hover = drag.hover;

    this.cleanupPaneDrag();

    if (!ws || !hover) return;

    const changed = ws.layout.moveSurface(
      drag.surfaceId,
      hover.targetId,
      hover.position,
    );

    if (!changed) return;

    this.applyLayout();
    this.focusSurface(drag.surfaceId);
    this.updateSidebar();
  }

  private cleanupPaneDrag(): void {
    if (this.activePaneDrag) {
      this.surfaces
        .get(this.activePaneDrag.surfaceId)
        ?.container.classList.remove("drag-origin");
      this.activePaneDrag.ghostEl.remove();
      this.activePaneDrag = null;
    }

    this.terminalContainer.classList.remove("pane-drag-active");
    document.body.classList.remove("pane-dragging");
    this.renderPaneDropOverlay(null);
  }

  private resolvePaneDropHover(
    sourceId: string,
    clientX: number,
    clientY: number,
  ): PaneDragHover | null {
    const ws = this.activeWorkspace();
    if (!ws || !ws.surfaceIds.has(sourceId)) return null;

    const targetEl = document
      .elementFromPoint(clientX, clientY)
      ?.closest(".surface-container") as HTMLDivElement | null;
    const targetId = targetEl?.dataset["surfaceId"];

    if (!targetEl || !targetId || targetId === sourceId) {
      return null;
    }

    if (!ws.surfaceIds.has(targetId)) {
      return null;
    }

    const containerRect = this.terminalContainer.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();

    return {
      targetId,
      position: this.resolvePaneDropPosition(
        clientX - targetRect.left,
        clientY - targetRect.top,
        targetRect.width,
        targetRect.height,
      ),
      bounds: {
        x: targetRect.left - containerRect.left,
        y: targetRect.top - containerRect.top,
        w: targetRect.width,
        h: targetRect.height,
      },
    };
  }

  private resolvePaneDropPosition(
    localX: number,
    localY: number,
    width: number,
    height: number,
  ): PaneDropPosition {
    const thresholdForSize = (size: number) =>
      Math.min(Math.max(size * 0.24, 24), Math.max(16, size / 2 - 16));

    const xThreshold = thresholdForSize(width);
    const yThreshold = thresholdForSize(height);
    const candidates: { position: PaneDropPosition; distance: number }[] = [];

    if (localX <= xThreshold) {
      candidates.push({ position: "left", distance: localX });
    }
    if (width - localX <= xThreshold) {
      candidates.push({ position: "right", distance: width - localX });
    }
    if (localY <= yThreshold) {
      candidates.push({ position: "top", distance: localY });
    }
    if (height - localY <= yThreshold) {
      candidates.push({ position: "bottom", distance: height - localY });
    }

    if (candidates.length === 0) {
      return "swap";
    }

    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0].position;
  }

  private renderPaneDropOverlay(hover: PaneDragHover | null): void {
    if (!hover) {
      this.dropOverlayEl?.classList.remove("visible");
      this.clearDropTargetHighlight();
      return;
    }

    const overlay = this.ensurePaneDropOverlay();
    const bounds = this.getPaneDropOverlayBounds(hover.bounds, hover.position);

    overlay.dataset["dropPosition"] = hover.position;
    overlay.style.left = `${bounds.x}px`;
    overlay.style.top = `${bounds.y}px`;
    overlay.style.width = `${bounds.w}px`;
    overlay.style.height = `${bounds.h}px`;
    overlay.classList.add("visible");

    if (this.dropOverlayLabelEl) {
      this.dropOverlayLabelEl.textContent = this.getPaneDropOverlayLabel(
        hover.position,
      );
    }

    if (this.highlightedDropTargetId !== hover.targetId) {
      this.clearDropTargetHighlight();
      this.surfaces.get(hover.targetId)?.container.classList.add("drop-target");
      this.highlightedDropTargetId = hover.targetId;
    }
  }

  private ensurePaneDropOverlay(): HTMLDivElement {
    if (this.dropOverlayEl) {
      return this.dropOverlayEl;
    }

    const overlay = document.createElement("div");
    overlay.className = "surface-drop-overlay";

    const label = document.createElement("span");
    label.className = "surface-drop-label";
    overlay.appendChild(label);

    this.terminalContainer.appendChild(overlay);
    this.dropOverlayEl = overlay;
    this.dropOverlayLabelEl = label;
    return overlay;
  }

  private getPaneDropOverlayBounds(
    rect: PaneRect,
    position: PaneDropPosition,
  ): PaneRect {
    const padding = 12;
    const inner = {
      x: rect.x + padding,
      y: rect.y + padding,
      w: Math.max(28, rect.w - padding * 2),
      h: Math.max(28, rect.h - padding * 2),
    };

    if (position === "swap") {
      return inner;
    }

    const splitWidth = Math.min(inner.w, Math.max(24, inner.w * 0.38));
    const splitHeight = Math.min(inner.h, Math.max(24, inner.h * 0.38));

    switch (position) {
      case "left":
        return { ...inner, w: splitWidth };
      case "right":
        return {
          ...inner,
          x: inner.x + inner.w - splitWidth,
          w: splitWidth,
        };
      case "top":
        return { ...inner, h: splitHeight };
      case "bottom":
        return {
          ...inner,
          y: inner.y + inner.h - splitHeight,
          h: splitHeight,
        };
      default:
        return inner;
    }
  }

  private getPaneDropOverlayLabel(position: PaneDropPosition): string {
    switch (position) {
      case "left":
        return "Split left";
      case "right":
        return "Split right";
      case "top":
        return "Split up";
      case "bottom":
        return "Split down";
      case "swap":
      default:
        return "Move here";
    }
  }

  private clearDropTargetHighlight(): void {
    if (!this.highlightedDropTargetId) return;
    this.surfaces
      .get(this.highlightedDropTargetId)
      ?.container.classList.remove("drop-target");
    this.highlightedDropTargetId = null;
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

/** Extracts the script name from commands like "bun run build", "npm run
 *  dev", "pnpm test", "yarn run start". Returns null when no match. */
function extractScriptName(command: string): string | null {
  const m = command.match(
    /^(?:bun|npm|pnpm|yarn)(?:\s+run(?:-script)?)?\s+(\S+)/,
  );
  return m?.[1] ?? null;
}

function samePortSet(a: { port: number }[], b: { port: number }[]): boolean {
  if (a.length !== b.length) return false;
  const aSet = new Set(a.map((x) => x.port));
  for (const x of b) if (!aSet.has(x.port)) return false;
  return true;
}
