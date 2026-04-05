import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { PanelManager } from "./panel-manager";
import { PaneLayout } from "./pane-layout";
import { Sidebar } from "./sidebar";
import { createIcon } from "./icons";
import type {
  PanelEvent,
  SidebandMetaMessage,
  SurfaceContextMenuRequest,
} from "../../shared/types";
import { WORKSPACE_COLORS } from "../../shared/workspace-colors";

const obsidianGlassTheme = {
  background: "#09090b",
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

interface SurfaceView {
  id: string;
  term: Terminal;
  fitAddon: FitAddon;
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

export class SurfaceManager {
  private surfaces = new Map<string, SurfaceView>();
  private workspaces: Workspace[] = [];
  private activeWorkspaceIndex = -1;
  private focusedSurfaceId: string | null = null;
  private dividerEls: HTMLDivElement[] = [];
  private sidebar: Sidebar;
  private wsCounter = 0;

  constructor(
    private terminalContainer: HTMLElement,
    sidebarContainer: HTMLElement,
    private onStdin: (surfaceId: string, data: string) => void,
    private onResize: (surfaceId: string, cols: number, rows: number) => void,
    private onPanelEvent: (surfaceId: string, event: PanelEvent) => void,
  ) {
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
    // Refit after sidebar animation
    setTimeout(() => this.applyLayout(), 200);
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

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.applyLayout();
        view.term.focus();
      });
    });
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

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.applyLayout();
        this.focusSurface(surfaceId);
      });
    });
  }

  removeSurface(surfaceId: string): void {
    const view = this.surfaces.get(surfaceId);
    if (!view) return;

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

    view.term.dispose();
    view.container.remove();
    this.surfaces.delete(surfaceId);
    this.updateSidebar();
  }

  focusSurface(surfaceId: string): void {
    this.focusedSurfaceId = surfaceId;
    for (const v of this.surfaces.values()) {
      v.container.classList.toggle("focused", v.id === surfaceId);
    }
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
    this.surfaces.get(surfaceId)?.term.write(data);
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

  getSurfaceTitle(surfaceId: string): string | null {
    return this.surfaces.get(surfaceId)?.title ?? null;
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
    }[];
    activeWorkspaceId: string | null;
  } {
    return {
      workspaces: this.workspaces.map((ws) => ({
        id: ws.id,
        name: ws.name,
        color: ws.color,
        surfaceIds: [...ws.surfaceIds],
        focusedSurfaceId: this.focusedSurfaceId,
      })),
      activeWorkspaceId: this.workspaces[this.activeWorkspaceIndex]?.id ?? null,
    };
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
    return this.workspaces.find((workspace) => workspace.surfaceIds.has(surfaceId)) ?? null;
  }

  private switchToWorkspace(index: number): void {
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

    bar.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const detail: SurfaceContextMenuRequest = {
        kind: "surface",
        surfaceId,
        title: this.surfaces.get(surfaceId)?.title ?? barTitle.textContent ?? surfaceId,
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
    container.appendChild(termEl);

    const panelsEl = document.createElement("div");
    panelsEl.className = "surface-panels";
    container.appendChild(panelsEl);

    this.terminalContainer.appendChild(container);

    const term = new Terminal({
      theme: obsidianGlassTheme,
      fontFamily:
        "'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Berkeley Mono', 'SF Mono', 'Menlo', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(termEl);

    term.onData((data) => {
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
      panelManager,
      container,
      panelsEl,
      titleEl: barTitle,
      title,
    };
  }

  private applyLayout(): void {
    this.applyPositions();
    const ws = this.activeWorkspace();
    if (!ws) return;
    for (const surfaceId of ws.surfaceIds) {
      const view = this.surfaces.get(surfaceId);
      if (!view) continue;
      view.fitAddon.fit();
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
