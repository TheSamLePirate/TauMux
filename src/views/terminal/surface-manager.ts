import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { PanelManager } from "./panel-manager";
import {
  PaneLayout,
  type PaneDropPosition,
  type PaneRect,
} from "./pane-layout";
import { Sidebar } from "./sidebar";
import { createIcon } from "./icons";
import { TerminalEffects } from "./terminal-effects";
import type {
  PanelEvent,
  PersistedLayout,
  SidebandMetaMessage,
  SurfaceContextMenuRequest,
} from "../../shared/types";
import { WORKSPACE_COLORS } from "../../shared/workspace-colors";
import { type AppSettings, hexToRgb } from "../../shared/settings";

const obsidianGlassTheme = {
  background: "rgba(9, 9, 11, 0)",
  foreground: "#f4f4f5",
  cursor: "#eab308",
  cursorAccent: "#09090b",
  selectionBackground: "rgba(168, 85, 247, 0.24)",
  selectionForeground: "#f4f4f5",
  black: "#18181b",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#eab308",
  blue: "#c4b5fd",
  magenta: "#a855f7",
  cyan: "#67e8f9",
  white: "#e4e4e7",
  brightBlack: "#52525b",
  brightRed: "#fb7185",
  brightGreen: "#86efac",
  brightYellow: "#facc15",
  brightBlue: "#ddd6fe",
  brightMagenta: "#d8b4fe",
  brightCyan: "#a5f3fc",
  brightWhite: "#fafafa",
};

const PANE_DRAG_THRESHOLD = 8;

interface SurfaceView {
  id: string;
  term: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  effects: TerminalEffects;
  panelManager: PanelManager;
  container: HTMLDivElement;
  panelsEl: HTMLDivElement;
  titleEl: HTMLSpanElement;
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

    this.scheduleLayoutForNewSurface(() => view.term.focus());
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

    view.effects.destroy();
    view.term.dispose();
    view.container.remove();
    this.surfaces.delete(surfaceId);
    this.updateSidebar();
  }

  focusSurface(surfaceId: string): void {
    this.focusedSurfaceId = surfaceId;
    for (const v of this.surfaces.values()) {
      v.container.classList.toggle("focused", v.id === surfaceId);
      v.effects.setFocused(v.id === surfaceId);
    }
    // Clear notification glow when surface becomes selected
    this.clearGlow(surfaceId);
    this.surfaces.get(surfaceId)?.term.focus();
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
    view.effects.pulseOutput(data.length);
    view.term.write(data);
  }

  handleSidebandMeta(surfaceId: string, msg: SidebandMetaMessage): void {
    this.surfaces.get(surfaceId)?.panelManager.handleMeta(msg);
  }

  handleSidebandData(surfaceId: string, id: string, base64: string): void {
    this.surfaces.get(surfaceId)?.panelManager.handleData(id, base64);
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
    return this.surfaces.get(this.focusedSurfaceId)?.term ?? null;
  }

  setTerminalEffectsEnabled(enabled: boolean): void {
    this.terminalEffectsEnabled = enabled;
    for (const view of this.surfaces.values()) {
      view.effects.setEnabled(enabled);
      view.effects.setFocused(view.id === this.focusedSurfaceId);
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
      selectionBackground: `rgba(${secRgb}, 0.28)`,
      selectionForeground: s.foregroundColor,
      ...s.ansiColors,
    };

    for (const view of this.surfaces.values()) {
      const t = view.term;
      t.options.fontSize = s.fontSize;
      t.options.fontFamily = s.fontFamily;
      t.options.lineHeight = s.lineHeight;
      t.options.cursorBlink = s.cursorBlink;
      t.options.cursorStyle = s.cursorStyle;
      t.options.scrollback = s.scrollbackLines;
      t.options.theme = theme;
      // Force xterm to re-render with new colors
      t.refresh(0, t.rows - 1);
      view.fitAddon.fit();
      view.effects.setEnabled(s.terminalBloom);
      view.effects.setFocused(view.id === this.focusedSurfaceId);
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

    // Re-report size for active surface
    const active = this.focusedSurfaceId
      ? this.surfaces.get(this.focusedSurfaceId)
      : null;
    if (active) {
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
      view.term.options.fontSize = size;
      view.fitAddon.fit();
    }
    // Re-report size to bun for the active surface
    const active = this.focusedSurfaceId
      ? this.surfaces.get(this.focusedSurfaceId)
      : null;
    if (active) {
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
    if (view) {
      view.searchAddon.clearDecorations();
      view.term.focus();
    }
  }

  private searchNext(): void {
    const query = this.searchInputEl?.value;
    if (!query) return;
    const view = this.focusedSurfaceId
      ? this.surfaces.get(this.focusedSurfaceId)
      : null;
    view?.searchAddon.findNext(query);
  }

  private searchPrevious(): void {
    const query = this.searchInputEl?.value;
    if (!query) return;
    const view = this.focusedSurfaceId
      ? this.surfaces.get(this.focusedSurfaceId)
      : null;
    view?.searchAddon.findPrevious(query);
  }

  readScreen(surfaceId: string, lines?: number, scrollback?: boolean): string {
    const view = this.surfaces.get(surfaceId);
    if (!view) return "";

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
    }[];
    activeWorkspaceId: string | null;
  } {
    return {
      workspaces: this.workspaces.map((ws) => ({
        id: ws.id,
        name: ws.name,
        color: ws.color,
        surfaceIds: ws.layout.getAllSurfaceIds(),
        focusedSurfaceId:
          this.focusedSurfaceId && ws.surfaceIds.has(this.focusedSurfaceId)
            ? this.focusedSurfaceId
            : null,
        layout: ws.layout.root,
      })),
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

        return {
          id: ws.id,
          name: ws.name,
          color: ws.color,
          active: i === this.activeWorkspaceIndex,
          paneCount: ws.surfaceIds.size,
          surfaceTitles,
          focusedSurfaceTitle,
          statusPills: [...ws.status.entries()].map(([key, s]) => ({
            key,
            value: s.value,
            color: s.color,
            icon: s.icon,
          })),
          progress: ws.progress,
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

    const barActions = document.createElement("div");
    barActions.className = "surface-bar-actions";

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
      const detail: SurfaceContextMenuRequest = {
        kind: "surface",
        surfaceId,
        title:
          this.surfaces.get(surfaceId)?.title ??
          barTitle.textContent ??
          surfaceId,
      };
      window.dispatchEvent(
        new CustomEvent("ht-open-context-menu", {
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
      theme: obsidianGlassTheme,
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
      term,
      fitAddon,
      searchAddon,
      effects,
      panelManager,
      container,
      panelsEl,
      titleEl: barTitle,
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
      view.fitAddon.fit();
      view.effects.setFocused(view.id === this.focusedSurfaceId);
      this.onResize(surfaceId, view.term.cols, view.term.rows);
      view.panelManager.updateInlinePanels();
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

    for (const [surfaceId, rect] of rects) {
      const view = this.surfaces.get(surfaceId);
      if (!view) continue;

      const s = view.container.style;
      s.left = `${rect.x}px`;
      s.top = `${rect.y}px`;
      s.width = `${rect.w}px`;
      s.height = `${rect.h}px`;
      s.display = "flex";
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
