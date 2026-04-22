import type {
  CargoInfo,
  PackageInfo,
  TelegramStatusWire,
  WorkspaceContextMenuRequest,
} from "../../shared/types";
import { ICON_TEMPLATES, createIcon, type IconName } from "./icons";
import {
  renderManifestCard,
  type ManifestAction,
  type ManifestActionState,
} from "./sidebar-manifest-card";

export interface WorkspaceInfo {
  id: string;
  name: string;
  color?: string;
  active: boolean;
  surfaceTitles: string[];
  focusedSurfaceTitle?: string | null;
  /** Full argv of the focused surface's foreground process, if it differs
   *  from the shell. E.g. "bun run dev", "vim src/foo.ts". */
  focusedSurfaceCommand?: string | null;
  statusPills: { key: string; value: string; color?: string; icon?: string }[];
  progress: { value: number; label?: string } | null;
  /** Unique TCP ports listening across all panes in this workspace. */
  listeningPorts: number[];
  /** Nearest package.json for this workspace's surfaces (or null). */
  packageJson: PackageInfo | null;
  /** Script names from package.json that are currently running in any surface. */
  runningScripts: string[];
  /** Script names whose most recent run exited non-zero within the last ~10 s. */
  erroredScripts: string[];
  /** Nearest Cargo.toml for this workspace's surfaces (or null). */
  cargoToml: CargoInfo | null;
  /** Cargo subcommands currently running in the process tree. */
  runningCargoActions: string[];
  /** Cargo subcommands whose most recent run exited non-zero. */
  erroredCargoActions: string[];
  /** Distinct cwds across all surfaces in this workspace, in stable order. */
  cwds: string[];
  /** The cwd currently driving the manifest cards. */
  selectedCwd: string | null;
  /** Sum of %cpu across every descendant of every surface. */
  cpuPercent: number;
  /** Sum of resident-set-size in KB across every descendant. */
  memRssKb: number;
  /** Total process count across every surface. */
  processCount: number;
  /** Rolling CPU% history. Drives the sparkline in the active card. */
  cpuHistory: number[];
}

interface SidebarCallbacks {
  onSelectWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onCloseWorkspace: (id: string) => void;
}

export interface NotificationInfo {
  id: string;
  title: string;
  body: string;
  time: number;
  /** Surface that emitted this notification (null for external sources). */
  surfaceId?: string | null;
}

export interface LogEntry {
  level: string;
  message: string;
  source?: string;
}

type FilterMode = "all" | "active" | "pinned";

interface SectionOpenState {
  notifications: boolean;
  workspaces: boolean;
  logs: boolean;
}

/** Per-workspace UI state — what's expanded in each card, the sections
 *  within the active card, and where the card sits in the list. Kept
 *  purely client-side; the host can inspect `ht-pin-workspace` +
 *  `ht-reorder-workspaces` events to persist if it wants. */
interface WorkspaceUiState {
  pinned: boolean;
  manifestsOpen: boolean;
  panesOpen: boolean;
  portsOpen: boolean;
  statusOpen: boolean;
}

const LS_PREFIX = "tau-mux.sidebar.";
const LS_PINS = LS_PREFIX + "pins";
const LS_ORDER = LS_PREFIX + "order";
const LS_SECTIONS = LS_PREFIX + "sections";
const LS_FILTER = LS_PREFIX + "filter";
const LS_UI_STATE = LS_PREFIX + "ui-state";

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / disabled — silent */
  }
}

const DEFAULT_SECTIONS: SectionOpenState = {
  notifications: true,
  workspaces: true,
  logs: true,
};

const DEFAULT_WS_UI: WorkspaceUiState = {
  pinned: false,
  manifestsOpen: false,
  panesOpen: false,
  portsOpen: false,
  statusOpen: true,
};

export class Sidebar {
  private container: HTMLElement;
  private headerEl: HTMLElement;
  private searchInputEl!: HTMLInputElement;
  private filterBarEl!: HTMLElement;
  private notificationsEl: HTMLElement;
  private listSectionEl!: HTMLElement;
  private listEl: HTMLElement;
  private listCountEl!: HTMLElement;
  private logsEl: HTMLElement;
  private footerEl: HTMLElement;
  private telegramDotEl!: HTMLElement;
  private telegramLabelEl!: HTMLElement;
  private telegramValueEl!: HTMLElement;
  private serverDotEl!: HTMLElement;
  private serverLabelEl!: HTMLElement;
  private serverUrlEl!: HTMLElement;
  private resizeHandleEl: HTMLElement;
  private callbacks: SidebarCallbacks;

  private visible = true;
  private workspaces: WorkspaceInfo[] = [];
  private notifications: NotificationInfo[] = [];
  private logs: LogEntry[] = [];
  private acknowledgedNotifications: Set<string> = new Set();
  /** Notification DOM cache — reused across renders so CSS animations
   *  on unchanged rows keep their frame state. */
  private notificationListEl: HTMLElement | null = null;
  private notificationCountEl: HTMLElement | null = null;
  private notificationItemEls: Map<string, HTMLElement> = new Map();

  // UI state (local, persisted via localStorage)
  private searchTerm = "";
  private filterMode: FilterMode = "all";
  private sectionOpen: SectionOpenState;
  private pinnedIds: Set<string>;
  private manualOrder: string[];
  private uiState: Map<string, WorkspaceUiState>;
  private highlightIndex = -1;
  private renamingId: string | null = null;

  constructor(container: HTMLElement, callbacks: SidebarCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    // Hydrate persisted UI state.
    this.sectionOpen = {
      ...DEFAULT_SECTIONS,
      ...loadJson(LS_SECTIONS, {}),
    };
    this.pinnedIds = new Set(loadJson<string[]>(LS_PINS, []));
    this.manualOrder = loadJson<string[]>(LS_ORDER, []);
    this.filterMode = loadJson<FilterMode>(LS_FILTER, "all");
    const persistedUi = loadJson<Record<string, WorkspaceUiState>>(
      LS_UI_STATE,
      {},
    );
    this.uiState = new Map(Object.entries(persistedUi));

    // ── Header ─────────────────────────────────────────────────────
    this.headerEl = document.createElement("div");
    this.headerEl.className = "sidebar-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "sidebar-header-copy";

    const title = document.createElement("span");
    title.className = "sidebar-title";
    title.append(createIcon("sidebar", "sidebar-title-icon", 13));
    const titleText = document.createElement("span");
    titleText.textContent = "Workspaces";
    title.appendChild(titleText);
    titleWrap.appendChild(title);

    const subtitle = document.createElement("span");
    subtitle.className = "sidebar-subtitle";
    subtitle.textContent = "Navigation · context · live activity";
    titleWrap.appendChild(subtitle);

    this.headerEl.appendChild(titleWrap);

    const headerActions = document.createElement("div");
    headerActions.className = "sidebar-header-actions";

    const newBtn = document.createElement("button");
    newBtn.className = "sidebar-new-btn";
    newBtn.title = "New workspace (⌘T)";
    newBtn.setAttribute("aria-label", "New workspace");
    newBtn.type = "button";
    newBtn.append(createIcon("plus", "", 14));
    newBtn.addEventListener("click", () => callbacks.onNewWorkspace());
    headerActions.appendChild(newBtn);

    this.headerEl.appendChild(headerActions);
    container.appendChild(this.headerEl);

    // ── Search + segmented filter ──────────────────────────────────
    const searchBar = document.createElement("div");
    searchBar.className = "sidebar-search-bar";

    const searchWrap = document.createElement("label");
    searchWrap.className = "sidebar-search";
    searchWrap.append(createIcon("search", "sidebar-search-icon", 12));

    this.searchInputEl = document.createElement("input");
    this.searchInputEl.type = "search";
    this.searchInputEl.className = "sidebar-search-input";
    this.searchInputEl.placeholder = "Filter workspaces…";
    this.searchInputEl.setAttribute("aria-label", "Filter workspaces");
    this.searchInputEl.spellcheck = false;
    this.searchInputEl.autocomplete = "off";
    this.searchInputEl.addEventListener("input", () => {
      this.searchTerm = this.searchInputEl.value.trim();
      this.highlightIndex = -1;
      this.renderWorkspaces();
    });
    this.searchInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.searchInputEl.value) {
          this.searchInputEl.value = "";
          this.searchTerm = "";
          this.renderWorkspaces();
          e.preventDefault();
        } else {
          this.searchInputEl.blur();
        }
      }
    });
    searchWrap.appendChild(this.searchInputEl);
    searchBar.appendChild(searchWrap);

    this.filterBarEl = document.createElement("div");
    this.filterBarEl.className = "sidebar-filter-segment";
    this.filterBarEl.setAttribute("role", "tablist");
    this.filterBarEl.setAttribute("aria-label", "Workspace filter");
    for (const mode of ["all", "active", "pinned"] as FilterMode[]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sidebar-filter-btn";
      btn.dataset["mode"] = mode;
      btn.setAttribute("role", "tab");
      btn.setAttribute(
        "aria-selected",
        mode === this.filterMode ? "true" : "false",
      );
      btn.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
      btn.title = `Show ${mode} workspaces`;
      btn.addEventListener("click", () => this.setFilterMode(mode));
      this.filterBarEl.appendChild(btn);
    }
    searchBar.appendChild(this.filterBarEl);

    container.appendChild(searchBar);

    // ── Notifications section (collapsible) ────────────────────────
    this.notificationsEl = document.createElement("div");
    this.notificationsEl.className = "sidebar-notifications";
    container.appendChild(this.notificationsEl);

    // ── Workspaces count (inside the title row) ────────────────────
    this.listCountEl = document.createElement("span");
    this.listCountEl.className = "sidebar-title-count";
    title.appendChild(this.listCountEl);

    // ── Workspaces list (no explicit section header — this is the
    // sidebar's primary content, so a header would be noise). ──────
    this.listSectionEl = document.createElement("div");
    this.listSectionEl.className = "sidebar-list-section";

    this.listEl = document.createElement("div");
    this.listEl.className = "sidebar-workspaces";
    this.listSectionEl.appendChild(this.listEl);
    container.appendChild(this.listSectionEl);

    // ── Logs section (collapsible) ─────────────────────────────────
    this.logsEl = document.createElement("div");
    this.logsEl.className = "sidebar-logs";
    container.appendChild(this.logsEl);

    // ── Footer (Telegram + Web Mirror) ─────────────────────────────
    this.footerEl = document.createElement("div");
    this.footerEl.className = "sidebar-footer";
    this.footerEl.appendChild(this.buildFooter());
    container.appendChild(this.footerEl);

    // ── Resize handle ──────────────────────────────────────────────
    this.resizeHandleEl = document.createElement("div");
    this.resizeHandleEl.className = "sidebar-resize-handle";
    this.resizeHandleEl.setAttribute("role", "separator");
    this.resizeHandleEl.setAttribute("aria-orientation", "vertical");
    this.resizeHandleEl.setAttribute("aria-label", "Resize sidebar");
    this.resizeHandleEl.tabIndex = 0;
    this.resizeHandleEl.title = "Drag to resize · double-click to reset";
    container.appendChild(this.resizeHandleEl);

    // ── Global key bindings ────────────────────────────────────────
    this.wireKeyboard();

    // Initial apply of section-open classes.
    this.applySectionOpenClasses();
  }

  // ──────────────────────────────────────────────────────────────────
  // Public API (stable contract — tests + SurfaceManager depend on it)
  // ──────────────────────────────────────────────────────────────────

  getResizeHandle(): HTMLElement {
    return this.resizeHandleEl;
  }

  setWorkspaces(workspaces: WorkspaceInfo[]): void {
    this.workspaces = workspaces;
    this.reconcileManualOrder();
    this.reconcileUiState();
    this.renderWorkspaces();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.container.classList.toggle("collapsed", !this.visible);
    window.dispatchEvent(
      new CustomEvent("ht-sidebar-toggle", {
        detail: { visible: this.visible },
      }),
    );
  }

  isVisible(): boolean {
    return this.visible;
  }

  setNotifications(notifications: NotificationInfo[]): void {
    this.notifications = notifications;
    const alive = new Set(notifications.map((n) => n.id));
    for (const id of [...this.acknowledgedNotifications]) {
      if (!alive.has(id)) this.acknowledgedNotifications.delete(id);
    }
    this.renderNotifications();
  }

  acknowledgeBySurface(surfaceId: string): void {
    let changed = false;
    for (const n of this.notifications) {
      if (
        n.surfaceId === surfaceId &&
        !this.acknowledgedNotifications.has(n.id)
      ) {
        this.acknowledgedNotifications.add(n.id);
        changed = true;
      }
    }
    if (changed) this.renderNotifications();
  }

  setWebServerStatus(running: boolean, port: number, url?: string): void {
    this.serverDotEl.classList.toggle("online", running);
    this.serverDotEl.classList.toggle("offline", !running);
    if (running && url) {
      this.serverUrlEl.textContent = `:${port}`;
      this.serverUrlEl.title = url;
    } else {
      this.serverUrlEl.textContent = "Offline";
      this.serverUrlEl.title = "";
    }
  }

  setTelegramStatus(status: TelegramStatusWire): void {
    const dot = this.telegramDotEl;
    dot.classList.remove("online", "offline", "starting", "error", "conflict");
    let valueText = "—";
    switch (status.state) {
      case "polling":
        dot.classList.add("online");
        valueText = "Polling";
        break;
      case "starting":
        dot.classList.add("starting");
        valueText = "Starting…";
        break;
      case "conflict":
        dot.classList.add("conflict");
        valueText = "Conflict";
        break;
      case "error":
        dot.classList.add("error");
        valueText = "Error";
        break;
      case "disabled":
      default:
        dot.classList.add("offline");
        valueText = "Disabled";
        break;
    }
    const parts = [`Telegram — ${status.state}`];
    if (status.botUsername) parts.push(`@${status.botUsername}`);
    if (status.error) parts.push(status.error);
    const title = parts.join(" · ");
    dot.title = title;
    this.telegramLabelEl.title = title;
    this.telegramValueEl.textContent = status.botUsername
      ? `@${status.botUsername}`
      : valueText;
    const pill = dot.parentElement;
    if (pill) pill.title = title;
  }

  setLogs(logs: LogEntry[]): void {
    this.logs = logs;
    this.renderLogs();
  }

  // ──────────────────────────────────────────────────────────────────
  // Rendering
  // ──────────────────────────────────────────────────────────────────

  private renderWorkspaces(): void {
    const ordered = this.orderedWorkspaces();
    const filtered = this.applyFilter(ordered);

    if (this.listCountEl) {
      this.listCountEl.textContent = `${filtered.length}${filtered.length !== ordered.length ? ` / ${ordered.length}` : ""}`;
    }

    this.listEl.innerHTML = "";

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sidebar-empty";
      if (ordered.length === 0) {
        empty.textContent = "No workspaces yet";
      } else {
        empty.textContent =
          this.searchTerm.length > 0
            ? `No workspaces match "${this.searchTerm}"`
            : this.filterMode === "pinned"
              ? "No pinned workspaces"
              : "No matching workspaces";
      }
      this.listEl.appendChild(empty);
      return;
    }

    // Group: pinned first, then rest — a subtle separator between the
    // two groups when both exist keeps the pinned band easy to scan.
    const pinned = filtered.filter((w) => this.pinnedIds.has(w.id));
    const rest = filtered.filter((w) => !this.pinnedIds.has(w.id));

    if (pinned.length > 0) {
      const pinHeader = document.createElement("div");
      pinHeader.className = "sidebar-inline-divider";
      pinHeader.innerHTML = `<span>Pinned</span>`;
      this.listEl.appendChild(pinHeader);
      for (const ws of pinned)
        this.listEl.appendChild(this.buildWorkspaceCard(ws));
    }
    if (rest.length > 0) {
      if (pinned.length > 0) {
        const restHeader = document.createElement("div");
        restHeader.className = "sidebar-inline-divider";
        restHeader.innerHTML = `<span>All</span>`;
        this.listEl.appendChild(restHeader);
      }
      for (const ws of rest)
        this.listEl.appendChild(this.buildWorkspaceCard(ws));
    }

    this.applyHighlight();
  }

  /** Return the workspaces in display order: pinned-then-rest is
   *  applied at render time, but within each group we honor the
   *  user's manual order (if any). */
  private orderedWorkspaces(): WorkspaceInfo[] {
    if (this.manualOrder.length === 0) return this.workspaces.slice();
    const byId = new Map(this.workspaces.map((w) => [w.id, w]));
    const out: WorkspaceInfo[] = [];
    const seen = new Set<string>();
    for (const id of this.manualOrder) {
      const w = byId.get(id);
      if (w) {
        out.push(w);
        seen.add(id);
      }
    }
    for (const w of this.workspaces) {
      if (!seen.has(w.id)) out.push(w);
    }
    return out;
  }

  private applyFilter(list: WorkspaceInfo[]): WorkspaceInfo[] {
    const q = this.searchTerm.toLowerCase();
    return list.filter((ws) => {
      if (this.filterMode === "active" && !ws.active) return false;
      if (this.filterMode === "pinned" && !this.pinnedIds.has(ws.id))
        return false;
      if (!q) return true;
      if (ws.name.toLowerCase().includes(q)) return true;
      if (ws.focusedSurfaceCommand?.toLowerCase().includes(q)) return true;
      for (const t of ws.surfaceTitles)
        if (t.toLowerCase().includes(q)) return true;
      for (const p of ws.listeningPorts) if (String(p).includes(q)) return true;
      if (ws.packageJson?.name?.toLowerCase().includes(q)) return true;
      if (ws.cargoToml?.name?.toLowerCase().includes(q)) return true;
      return false;
    });
  }

  private buildWorkspaceCard(ws: WorkspaceInfo): HTMLElement {
    // Ensure the workspace has persisted UI state before the
    // sub-sections ask for it — they call `ensureUiState` on demand.
    this.ensureUiState(ws.id);
    const item = document.createElement("div");
    item.className = `workspace-item${ws.active ? " active" : ""}${
      this.pinnedIds.has(ws.id) ? " pinned" : ""
    }`;
    item.dataset["workspaceId"] = ws.id;
    item.style.setProperty("--workspace-accent", ws.color || "#89b4fa");
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "-1");
    item.setAttribute("aria-current", ws.active ? "true" : "false");
    item.draggable = true;

    // ── Header row ──
    const header = document.createElement("div");
    header.className = "workspace-card-header";

    const grip = document.createElement("span");
    grip.className = "workspace-grip";
    grip.title = "Drag to reorder";
    grip.setAttribute("aria-hidden", "true");
    grip.append(createIcon("grip", "", 10));
    header.appendChild(grip);

    const dot = document.createElement("div");
    dot.className = "workspace-dot";
    dot.style.background = ws.color || "#89b4fa";
    header.appendChild(dot);

    const name = document.createElement("span");
    name.className = "workspace-name";
    name.textContent = ws.name;
    name.title = `${ws.name} · double-click to rename`;
    name.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.beginRename(ws);
    });
    header.appendChild(name);

    if (this.renamingId === ws.id) {
      name.style.display = "none";
      header.appendChild(this.buildRenameInput(ws));
    }

    const headerRight = document.createElement("div");
    headerRight.className = "workspace-header-right";

    if (ws.active && ws.processCount > 0) {
      headerRight.appendChild(this.buildSparkline(ws));
      headerRight.appendChild(this.buildMetricsChip(ws));
    }

    const pinBtn = document.createElement("button");
    pinBtn.className = `workspace-pin${this.pinnedIds.has(ws.id) ? " active" : ""}`;
    pinBtn.type = "button";
    pinBtn.title = this.pinnedIds.has(ws.id)
      ? "Unpin workspace"
      : "Pin workspace";
    pinBtn.setAttribute(
      "aria-pressed",
      this.pinnedIds.has(ws.id) ? "true" : "false",
    );
    pinBtn.append(createIcon("pin", "", 11));
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.togglePin(ws.id);
    });
    headerRight.appendChild(pinBtn);

    const closeBtn = document.createElement("button");
    closeBtn.className = "workspace-close";
    closeBtn.type = "button";
    closeBtn.title = "Close workspace";
    closeBtn.setAttribute("aria-label", "Close workspace");
    closeBtn.append(createIcon("close", "", 11));
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.callbacks.onCloseWorkspace(ws.id);
    });
    headerRight.appendChild(closeBtn);

    header.appendChild(headerRight);
    item.appendChild(header);

    // ── Meta row: focused fg command ──
    if (ws.focusedSurfaceCommand) {
      const meta = document.createElement("div");
      meta.className = "workspace-meta-row";
      const fg = document.createElement("span");
      fg.className = "workspace-meta workspace-meta-fg";
      fg.textContent = ws.focusedSurfaceCommand;
      fg.title = ws.focusedSurfaceCommand;
      meta.appendChild(fg);
      item.appendChild(meta);
    } else if (ws.focusedSurfaceTitle && ws.focusedSurfaceTitle !== ws.name) {
      const meta = document.createElement("div");
      meta.className = "workspace-meta-row";
      const focused = document.createElement("span");
      focused.className = "workspace-meta";
      focused.textContent = ws.focusedSurfaceTitle;
      meta.appendChild(focused);
      item.appendChild(meta);
    }

    // Only render sub-sections for ACTIVE cards — inactive cards stay
    // compact so the list is easy to scan. The user still sees fg
    // command, name, and metrics for every workspace.
    if (ws.active) {
      // ── Collapsible: Panes ──
      if (ws.surfaceTitles.length > 1) {
        const sec = this.buildWorkspaceSection({
          wsId: ws.id,
          key: "panesOpen",
          title: "Panes",
          count: ws.surfaceTitles.length,
          build: () => {
            const wrap = document.createElement("div");
            wrap.className = "workspace-surfaces";
            for (const t of ws.surfaceTitles.slice(0, 8)) {
              const line = document.createElement("span");
              line.className = "workspace-surface-line";
              line.textContent = t;
              line.title = t;
              wrap.appendChild(line);
            }
            if (ws.surfaceTitles.length > 8) {
              const more = document.createElement("span");
              more.className = "workspace-surface-line workspace-surface-more";
              more.textContent = `+${ws.surfaceTitles.length - 8} more`;
              wrap.appendChild(more);
            }
            return wrap;
          },
        });
        item.appendChild(sec);
      }

      // ── Collapsible: Ports ──
      if (ws.listeningPorts.length > 0) {
        const sec = this.buildWorkspaceSection({
          wsId: ws.id,
          key: "portsOpen",
          title: "Ports",
          count: ws.listeningPorts.length,
          build: () => {
            const wrap = document.createElement("div");
            wrap.className = "workspace-ports";
            for (const port of ws.listeningPorts) {
              const chip = document.createElement("button");
              chip.type = "button";
              chip.className = "workspace-port-chip";
              chip.textContent = `:${port}`;
              chip.title = `Open http://localhost:${port}`;
              chip.addEventListener("click", (e) => {
                e.stopPropagation();
                window.dispatchEvent(
                  new CustomEvent("ht-open-external", {
                    detail: { url: `http://localhost:${port}` },
                  }),
                );
              });
              wrap.appendChild(chip);
            }
            return wrap;
          },
        });
        item.appendChild(sec);
      }

      // ── CWD selector (inline, only when >1 distinct cwd) ──
      if (ws.cwds.length > 1) {
        const cwdRow = document.createElement("div");
        cwdRow.className = "workspace-cwds";
        const label = document.createElement("span");
        label.className = "workspace-cwds-label";
        label.textContent = "cwd";
        cwdRow.appendChild(label);
        for (const cwd of ws.cwds) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = `workspace-cwd-chip${cwd === ws.selectedCwd ? " active" : ""}`;
          chip.textContent = shortCwd(cwd);
          chip.title = cwd;
          chip.addEventListener("click", (e) => {
            e.stopPropagation();
            window.dispatchEvent(
              new CustomEvent("ht-select-workspace-cwd", {
                detail: { workspaceId: ws.id, cwd },
              }),
            );
          });
          cwdRow.appendChild(chip);
        }
        item.appendChild(cwdRow);
      }

      // ── Manifest cards (collapsible section wrapping both npm + cargo) ──
      if (ws.packageJson || ws.cargoToml) {
        const count = (ws.packageJson ? 1 : 0) + (ws.cargoToml ? 1 : 0);
        const sec = this.buildWorkspaceSection({
          wsId: ws.id,
          key: "manifestsOpen",
          title: "Manifests",
          count,
          build: () => {
            const wrap = document.createElement("div");
            wrap.className = "workspace-manifests";
            if (ws.packageJson) {
              wrap.appendChild(
                this.renderPackageManifestCard(ws, ws.packageJson),
              );
            }
            if (ws.cargoToml) {
              wrap.appendChild(this.renderCargoManifestCard(ws, ws.cargoToml));
            }
            return wrap;
          },
        });
        item.appendChild(sec);
      }

      // ── Status pills ──
      if (ws.statusPills.length > 0) {
        const sec = this.buildWorkspaceSection({
          wsId: ws.id,
          key: "statusOpen",
          title: "Status",
          count: ws.statusPills.length,
          build: () => {
            const wrap = document.createElement("div");
            wrap.className = "workspace-status";
            for (const pill of ws.statusPills) {
              const entry = document.createElement("div");
              entry.className = "status-entry";

              const keyLine = document.createElement("div");
              keyLine.className = "status-entry-key";
              if (pill.icon && pill.icon in ICON_TEMPLATES) {
                keyLine.append(createIcon(pill.icon as IconName, "", 10));
              }
              const keyText = document.createElement("span");
              keyText.textContent = pill.key;
              keyLine.appendChild(keyText);
              entry.appendChild(keyLine);

              const valueLine = document.createElement("div");
              valueLine.className = "status-entry-value";
              valueLine.textContent = pill.value;
              valueLine.title = pill.value;
              if (pill.color) valueLine.style.color = pill.color;
              entry.appendChild(valueLine);

              wrap.appendChild(entry);
            }
            return wrap;
          },
        });
        item.appendChild(sec);
      }

      // ── Progress bar (always visible when present) ──
      if (ws.progress) {
        const progressWrap = document.createElement("div");
        progressWrap.className = "workspace-progress";
        const fill = document.createElement("div");
        fill.className = "progress-fill";
        fill.style.width = `${Math.round(ws.progress.value * 100)}%`;
        progressWrap.appendChild(fill);

        const progressLabel = document.createElement("span");
        progressLabel.className = "progress-inline-label";
        progressLabel.textContent = `${ws.progress.label || "Progress"} ${Math.round(ws.progress.value * 100)}%`;
        progressWrap.appendChild(progressLabel);

        item.appendChild(progressWrap);
      }
    }

    item.addEventListener("click", () => {
      this.callbacks.onSelectWorkspace(ws.id);
    });
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const detail: WorkspaceContextMenuRequest = {
        kind: "workspace",
        workspaceId: ws.id,
        name: ws.name,
        color: ws.color,
      };
      window.dispatchEvent(new CustomEvent("ht-open-context-menu", { detail }));
    });

    this.wireDragAndDrop(item, ws.id);
    return item;
  }

  private buildSparkline(ws: WorkspaceInfo): HTMLElement {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.classList.add("workspace-sparkline");
    svg.setAttribute("viewBox", "0 0 32 12");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("preserveAspectRatio", "none");

    const hist = ws.cpuHistory.length > 0 ? ws.cpuHistory : [0];
    // Normalize per-workspace: cap at 100% OR the max seen, whichever is
    // greater, so a burst to 400% (multi-core) still reads visually.
    const max = Math.max(100, ...hist);
    const w = 32;
    const h = 12;
    const stride = hist.length > 1 ? w / (hist.length - 1) : w;
    const pts = hist
      .map((v, i) => {
        const x = (i * stride).toFixed(2);
        const y = (h - (Math.min(v, max) / max) * h).toFixed(2);
        return `${x},${y}`;
      })
      .join(" ");

    const poly = document.createElementNS(NS, "polyline");
    poly.setAttribute("points", pts);
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", "currentColor");
    poly.setAttribute("stroke-width", "1.2");
    poly.setAttribute("stroke-linejoin", "round");
    poly.setAttribute("stroke-linecap", "round");
    svg.appendChild(poly);

    // Area fill underneath for subtle depth.
    const fill = document.createElementNS(NS, "polygon");
    fill.setAttribute("points", `0,${h} ${pts} ${w},${h}`);
    fill.setAttribute("fill", "currentColor");
    fill.setAttribute("opacity", "0.14");
    svg.insertBefore(fill, poly);

    svg.setAttribute(
      "aria-label",
      `CPU ${Math.round(ws.cpuPercent)}% across ${ws.processCount} process${ws.processCount === 1 ? "" : "es"}`,
    );
    return svg as unknown as HTMLElement;
  }

  private buildMetricsChip(ws: WorkspaceInfo): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "workspace-metrics";
    const cpu = document.createElement("span");
    cpu.className = "workspace-metric workspace-metric-cpu";
    cpu.textContent = `${Math.round(ws.cpuPercent)}%`;
    cpu.title = `CPU ${ws.cpuPercent.toFixed(1)}%`;
    const mem = document.createElement("span");
    mem.className = "workspace-metric workspace-metric-mem";
    mem.textContent = humanRss(ws.memRssKb);
    mem.title = `Resident ${humanRss(ws.memRssKb)} · ${ws.processCount} process${ws.processCount === 1 ? "" : "es"}`;
    chip.appendChild(cpu);
    chip.appendChild(mem);
    return chip;
  }

  private buildWorkspaceSection(opts: {
    wsId: string;
    key: keyof WorkspaceUiState;
    title: string;
    count: number;
    build: () => HTMLElement;
  }): HTMLElement {
    const ui = this.ensureUiState(opts.wsId);
    const open = Boolean(ui[opts.key]);

    const sec = document.createElement("div");
    sec.className = `workspace-section${open ? " open" : ""}`;

    const header = document.createElement("button");
    header.type = "button";
    header.className = "workspace-section-header";
    header.setAttribute("aria-expanded", open ? "true" : "false");

    const caret = document.createElement("span");
    caret.className = "workspace-section-caret";
    caret.append(createIcon(open ? "chevronDown" : "chevronRight", "", 10));
    header.appendChild(caret);

    const titleEl = document.createElement("span");
    titleEl.className = "workspace-section-title";
    titleEl.textContent = opts.title;
    header.appendChild(titleEl);

    const countEl = document.createElement("span");
    countEl.className = "workspace-section-count";
    countEl.textContent = String(opts.count);
    header.appendChild(countEl);

    header.addEventListener("click", (e) => {
      e.stopPropagation();
      const st = this.ensureUiState(opts.wsId);
      (st[opts.key] as boolean) = !st[opts.key];
      this.persistUiState();
      this.renderWorkspaces();
    });
    sec.appendChild(header);

    if (open) {
      const body = document.createElement("div");
      body.className = "workspace-section-body";
      body.appendChild(opts.build());
      sec.appendChild(body);
    }
    return sec;
  }

  private buildRenameInput(ws: WorkspaceInfo): HTMLElement {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "workspace-rename-input";
    input.value = ws.name;
    input.setAttribute("aria-label", `Rename workspace ${ws.name}`);
    input.spellcheck = false;
    input.autocomplete = "off";
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        this.commitRename(ws.id, input.value);
      } else if (e.key === "Escape") {
        this.cancelRename();
      }
    });
    input.addEventListener("blur", () => {
      if (this.renamingId === ws.id) this.commitRename(ws.id, input.value);
    });
    // Select-all after the item is in the DOM.
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return input;
  }

  private beginRename(ws: WorkspaceInfo): void {
    this.renamingId = ws.id;
    this.renderWorkspaces();
  }

  private commitRename(id: string, next: string): void {
    const trimmed = next.trim();
    this.renamingId = null;
    if (!trimmed) {
      this.renderWorkspaces();
      return;
    }
    window.dispatchEvent(
      new CustomEvent("ht-rename-workspace", {
        detail: { workspaceId: id, name: trimmed },
      }),
    );
    // Re-render immediately with the new name so the input blink is
    // tight; the host will broadcast the authoritative name on next
    // updateSidebar tick.
    const ws = this.workspaces.find((w) => w.id === id);
    if (ws) ws.name = trimmed;
    this.renderWorkspaces();
  }

  private cancelRename(): void {
    this.renamingId = null;
    this.renderWorkspaces();
  }

  private togglePin(id: string): void {
    if (this.pinnedIds.has(id)) this.pinnedIds.delete(id);
    else this.pinnedIds.add(id);
    saveJson(LS_PINS, [...this.pinnedIds]);
    window.dispatchEvent(
      new CustomEvent("ht-pin-workspace", {
        detail: { workspaceId: id, pinned: this.pinnedIds.has(id) },
      }),
    );
    this.renderWorkspaces();
  }

  private setFilterMode(mode: FilterMode): void {
    this.filterMode = mode;
    saveJson(LS_FILTER, mode);
    for (const btn of this.filterBarEl.querySelectorAll("button")) {
      const m = btn.getAttribute("data-mode") as FilterMode;
      btn.setAttribute("aria-selected", m === mode ? "true" : "false");
    }
    this.renderWorkspaces();
  }

  private reconcileManualOrder(): void {
    const alive = new Set(this.workspaces.map((w) => w.id));
    const next = this.manualOrder.filter((id) => alive.has(id));
    // Append any new ids we haven't seen before to the end.
    for (const w of this.workspaces) {
      if (!next.includes(w.id)) next.push(w.id);
    }
    if (
      next.length !== this.manualOrder.length ||
      next.some((v, i) => v !== this.manualOrder[i])
    ) {
      this.manualOrder = next;
      saveJson(LS_ORDER, next);
    }
  }

  private reconcileUiState(): void {
    const alive = new Set(this.workspaces.map((w) => w.id));
    let dirty = false;
    for (const id of [...this.uiState.keys()]) {
      if (!alive.has(id)) {
        this.uiState.delete(id);
        dirty = true;
      }
    }
    for (const id of [...this.pinnedIds]) {
      if (!alive.has(id)) {
        this.pinnedIds.delete(id);
        dirty = true;
      }
    }
    if (dirty) {
      this.persistUiState();
      saveJson(LS_PINS, [...this.pinnedIds]);
    }
  }

  private ensureUiState(id: string): WorkspaceUiState {
    let s = this.uiState.get(id);
    if (!s) {
      s = { ...DEFAULT_WS_UI };
      this.uiState.set(id, s);
    }
    return s;
  }

  private persistUiState(): void {
    saveJson(LS_UI_STATE, Object.fromEntries(this.uiState));
  }

  // ── Drag-and-drop reorder ──────────────────────────────────────────
  private dragState: { id: string; over: string | null } | null = null;

  private wireDragAndDrop(item: HTMLElement, id: string): void {
    item.addEventListener("dragstart", (e) => {
      this.dragState = { id, over: null };
      item.classList.add("dragging");
      try {
        e.dataTransfer?.setData("text/plain", id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      } catch {
        /* noop */
      }
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      for (const el of this.listEl.querySelectorAll(
        ".drop-before, .drop-after",
      )) {
        el.classList.remove("drop-before", "drop-after");
      }
      this.dragState = null;
    });
    item.addEventListener("dragover", (e) => {
      if (!this.dragState) return;
      if (this.dragState.id === id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const rect = item.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      item.classList.toggle("drop-before", before);
      item.classList.toggle("drop-after", !before);
    });
    item.addEventListener("dragleave", () => {
      item.classList.remove("drop-before", "drop-after");
    });
    item.addEventListener("drop", (e) => {
      if (!this.dragState) return;
      if (this.dragState.id === id) return;
      e.preventDefault();
      const rect = item.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      this.reorder(this.dragState.id, id, before ? "before" : "after");
    });
  }

  private reorder(
    sourceId: string,
    targetId: string,
    pos: "before" | "after",
  ): void {
    const order = this.orderedWorkspaces().map((w) => w.id);
    const from = order.indexOf(sourceId);
    if (from === -1) return;
    order.splice(from, 1);
    let to = order.indexOf(targetId);
    if (to === -1) return;
    if (pos === "after") to++;
    order.splice(to, 0, sourceId);
    this.manualOrder = order;
    saveJson(LS_ORDER, order);
    window.dispatchEvent(
      new CustomEvent("ht-reorder-workspaces", {
        detail: { order: order.slice() },
      }),
    );
    this.renderWorkspaces();
  }

  // ── Collapsible section header ────────────────────────────────────
  private buildCollapsibleSectionHeader(opts: {
    sectionId: keyof SectionOpenState;
    icon: IconName;
    title: string;
    countEl?: (el: HTMLElement) => void;
    trailing?: HTMLElement;
  }): HTMLElement {
    const header = document.createElement("div");
    header.className = "sidebar-section-header";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sidebar-section-toggle";
    toggle.setAttribute(
      "aria-expanded",
      this.sectionOpen[opts.sectionId] ? "true" : "false",
    );

    const caret = document.createElement("span");
    caret.className = "sidebar-section-caret";
    caret.append(
      createIcon(
        this.sectionOpen[opts.sectionId] ? "chevronDown" : "chevronRight",
        "",
        10,
      ),
    );
    toggle.appendChild(caret);

    const titleEl = document.createElement("span");
    titleEl.className = "sidebar-section-title";
    titleEl.append(createIcon(opts.icon, "", 12));
    const titleText = document.createElement("span");
    titleText.textContent = opts.title;
    titleEl.appendChild(titleText);

    const count = document.createElement("span");
    count.className = "sidebar-section-count";
    titleEl.appendChild(count);
    opts.countEl?.(count);

    toggle.appendChild(titleEl);
    toggle.addEventListener("click", () => {
      this.sectionOpen[opts.sectionId] = !this.sectionOpen[opts.sectionId];
      saveJson(LS_SECTIONS, this.sectionOpen);
      this.applySectionOpenClasses();
      if (opts.sectionId === "notifications") this.renderNotifications();
      else if (opts.sectionId === "logs") this.renderLogs();
      caret.innerHTML = "";
      caret.append(
        createIcon(
          this.sectionOpen[opts.sectionId] ? "chevronDown" : "chevronRight",
          "",
          10,
        ),
      );
      toggle.setAttribute(
        "aria-expanded",
        this.sectionOpen[opts.sectionId] ? "true" : "false",
      );
    });

    header.appendChild(toggle);
    if (opts.trailing) header.appendChild(opts.trailing);
    return header;
  }

  private applySectionOpenClasses(): void {
    this.notificationsEl.classList.toggle(
      "closed",
      !this.sectionOpen.notifications,
    );
    this.logsEl.classList.toggle("closed", !this.sectionOpen.logs);
  }

  // ──────────────────────────────────────────────────────────────────
  // Notifications (incremental DOM — preserves glow animation frames)
  // ──────────────────────────────────────────────────────────────────

  private renderNotifications(): void {
    const notifications = this.notifications;
    const unreadCount = notifications.filter(
      (n) => !this.acknowledgedNotifications.has(n.id),
    ).length;

    if (notifications.length === 0) {
      this.notificationsEl.innerHTML = "";
      this.notificationListEl = null;
      this.notificationCountEl = null;
      this.notificationItemEls.clear();
      return;
    }

    if (!this.notificationListEl || !this.notificationCountEl) {
      this.notificationsEl.innerHTML = "";
      const { listEl, countEl } = this.buildNotificationShell();
      this.notificationListEl = listEl;
      this.notificationCountEl = countEl;
    }

    // Tests rely on the legacy "Notifications (N)" text — keep it.
    this.notificationCountEl.textContent = `Notifications (${notifications.length})`;

    const unreadBadge = this.notificationsEl.querySelector(
      ".sidebar-section-badge",
    );
    if (unreadBadge instanceof HTMLElement) {
      if (unreadCount > 0) {
        unreadBadge.textContent = String(unreadCount);
        unreadBadge.classList.add("visible");
      } else {
        unreadBadge.classList.remove("visible");
      }
    }

    // When the section is collapsed, we don't render the list DOM.
    if (!this.sectionOpen.notifications) {
      this.notificationListEl.innerHTML = "";
      this.notificationItemEls.clear();
      return;
    }

    const visible = notifications.slice(-5).reverse();
    const visibleIds = new Set(visible.map((n) => n.id));

    for (const [id, el] of [...this.notificationItemEls]) {
      if (!visibleIds.has(id)) {
        el.remove();
        this.notificationItemEls.delete(id);
      }
    }

    let cursor: ChildNode | null = this.notificationListEl.firstChild;
    for (const n of visible) {
      const existing = this.notificationItemEls.get(n.id);
      if (existing) {
        this.updateNotificationItem(existing, n);
        cursor = existing.nextSibling;
      } else {
        const el = this.buildNotificationItem(n);
        this.notificationItemEls.set(n.id, el);
        this.notificationListEl.insertBefore(el, cursor);
      }
    }
  }

  private buildNotificationShell(): {
    listEl: HTMLElement;
    countEl: HTMLElement;
  } {
    const header = document.createElement("div");
    header.className = "sidebar-section-header";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sidebar-section-toggle";
    toggle.setAttribute(
      "aria-expanded",
      this.sectionOpen.notifications ? "true" : "false",
    );

    const caret = document.createElement("span");
    caret.className = "sidebar-section-caret";
    caret.append(
      createIcon(
        this.sectionOpen.notifications ? "chevronDown" : "chevronRight",
        "",
        10,
      ),
    );
    toggle.appendChild(caret);

    const title = document.createElement("span");
    title.className = "sidebar-section-title";
    title.append(createIcon("bell", "", 12));
    const countEl = document.createElement("span");
    title.append(countEl);
    toggle.appendChild(title);

    const badge = document.createElement("span");
    badge.className = "sidebar-section-badge";
    toggle.appendChild(badge);

    toggle.addEventListener("click", () => {
      this.sectionOpen.notifications = !this.sectionOpen.notifications;
      saveJson(LS_SECTIONS, this.sectionOpen);
      this.applySectionOpenClasses();
      caret.innerHTML = "";
      caret.append(
        createIcon(
          this.sectionOpen.notifications ? "chevronDown" : "chevronRight",
          "",
          10,
        ),
      );
      toggle.setAttribute(
        "aria-expanded",
        this.sectionOpen.notifications ? "true" : "false",
      );
      // Re-render — rebuilds the list DOM if we just opened.
      this.notificationItemEls.clear();
      if (this.notificationListEl) this.notificationListEl.innerHTML = "";
      this.renderNotifications();
    });

    header.appendChild(toggle);

    const clearBtn = document.createElement("button");
    clearBtn.className = "sidebar-section-clear";
    clearBtn.title = "Clear notifications";
    clearBtn.setAttribute("aria-label", "Clear notifications");
    clearBtn.append(createIcon("close", "", 12));
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent("ht-clear-notifications"));
    });
    header.appendChild(clearBtn);
    this.notificationsEl.appendChild(header);

    const listEl = document.createElement("div");
    listEl.className = "sidebar-section-list";
    this.notificationsEl.appendChild(listEl);

    this.applySectionOpenClasses();
    return { listEl, countEl };
  }

  private buildNotificationItem(n: NotificationInfo): HTMLElement {
    const el = document.createElement("div");
    el.className = "notification-item";
    const hasSource = typeof n.surfaceId === "string" && n.surfaceId.length > 0;
    if (hasSource) el.classList.add("has-source");
    if (!this.acknowledgedNotifications.has(n.id)) el.classList.add("glow");
    el.title = hasSource
      ? "Click to focus the pane that emitted this notification"
      : "";

    const body = document.createElement("button");
    body.type = "button";
    body.className = "notification-body-btn";
    body.addEventListener("click", (e) => {
      e.stopPropagation();
      this.acknowledgedNotifications.add(n.id);
      el.classList.remove("glow");
      if (!hasSource) return;
      window.dispatchEvent(
        new CustomEvent("ht-focus-notification-source", {
          detail: { notificationId: n.id, surfaceId: n.surfaceId },
        }),
      );
    });

    const titleEl = document.createElement("div");
    titleEl.className = "notification-title";
    titleEl.textContent = n.title;
    body.appendChild(titleEl);
    if (n.body) {
      const msg = document.createElement("div");
      msg.className = "notification-body";
      msg.textContent = n.body;
      body.appendChild(msg);
    }
    const time = document.createElement("div");
    time.className = "notification-time";
    time.textContent = relativeTime(n.time);
    time.title = new Date(n.time).toLocaleString();
    body.appendChild(time);

    el.appendChild(body);

    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "notification-dismiss";
    dismissBtn.title = "Dismiss notification";
    dismissBtn.setAttribute("aria-label", "Dismiss notification");
    dismissBtn.append(createIcon("close", "", 10));
    dismissBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("ht-dismiss-notification", {
          detail: { id: n.id },
        }),
      );
    });
    el.appendChild(dismissBtn);

    return el;
  }

  private updateNotificationItem(el: HTMLElement, n: NotificationInfo): void {
    const shouldGlow = !this.acknowledgedNotifications.has(n.id);
    el.classList.toggle("glow", shouldGlow);
    const time = el.querySelector(".notification-time");
    if (time) time.textContent = relativeTime(n.time);
  }

  // ──────────────────────────────────────────────────────────────────
  // Logs
  // ──────────────────────────────────────────────────────────────────

  private renderLogs(): void {
    const logs = this.logs;
    this.logsEl.innerHTML = "";
    if (logs.length === 0) return;

    const unread = logs.filter(
      (l) => l.level === "error" || l.level === "warning",
    ).length;
    const trailing = document.createElement("div");
    trailing.style.display = "flex";
    trailing.style.gap = "4px";
    const clearBtn = document.createElement("button");
    clearBtn.className = "sidebar-section-clear";
    clearBtn.title = "Clear logs";
    clearBtn.type = "button";
    clearBtn.setAttribute("aria-label", "Clear logs");
    clearBtn.append(createIcon("close", "", 12));
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent("ht-clear-logs"));
    });
    trailing.appendChild(clearBtn);

    let countRef: HTMLElement | null = null;
    const header = this.buildCollapsibleSectionHeader({
      sectionId: "logs",
      icon: "logs",
      title: "Logs",
      countEl: (el) => {
        countRef = el;
      },
      trailing,
    });
    this.logsEl.appendChild(header);

    if (countRef) {
      (countRef as HTMLElement).textContent =
        unread > 0 ? `${logs.length} · ${unread}!` : String(logs.length);
    }

    if (!this.sectionOpen.logs) return;

    const list = document.createElement("div");
    list.className = "sidebar-section-list";
    this.logsEl.appendChild(list);

    const scroller = this.container;
    const wasNearBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;

    let lastItem: HTMLDivElement | null = null;
    for (const log of logs.slice(-10)) {
      const el = document.createElement("div");
      el.className = `log-item ${log.level}`;
      const prefix = log.source ? `[${log.source}] ` : "";
      el.textContent = `${prefix}${log.message}`;
      list.appendChild(el);
      lastItem = el;
    }
    if (lastItem && wasNearBottom) {
      requestAnimationFrame(() =>
        lastItem?.scrollIntoView({ block: "nearest" }),
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Footer
  // ──────────────────────────────────────────────────────────────────

  private buildFooter(): HTMLElement {
    const row = document.createElement("div");
    row.className = "sidebar-server-row";

    // Telegram (stacked row)
    const tgRow = document.createElement("div");
    tgRow.className = "sidebar-server-pill";

    this.telegramDotEl = document.createElement("div");
    this.telegramDotEl.className = "sidebar-server-dot offline";
    tgRow.appendChild(this.telegramDotEl);

    this.telegramLabelEl = document.createElement("span");
    this.telegramLabelEl.className = "sidebar-server-label";
    this.telegramLabelEl.textContent = "Telegram";
    tgRow.appendChild(this.telegramLabelEl);

    this.telegramValueEl = document.createElement("span");
    this.telegramValueEl.className = "sidebar-server-url";
    this.telegramValueEl.textContent = "Disabled";
    tgRow.appendChild(this.telegramValueEl);
    tgRow.title = "Telegram — disabled";

    // Web mirror (same layout)
    const wmRow = document.createElement("div");
    wmRow.className = "sidebar-server-pill";

    this.serverDotEl = document.createElement("div");
    this.serverDotEl.className = "sidebar-server-dot offline";
    wmRow.appendChild(this.serverDotEl);

    this.serverLabelEl = document.createElement("span");
    this.serverLabelEl.className = "sidebar-server-label";
    this.serverLabelEl.textContent = "Web Mirror";
    wmRow.appendChild(this.serverLabelEl);

    this.serverUrlEl = document.createElement("span");
    this.serverUrlEl.className = "sidebar-server-url";
    this.serverUrlEl.textContent = "Offline";
    wmRow.appendChild(this.serverUrlEl);

    row.appendChild(tgRow);
    row.appendChild(wmRow);
    return row;
  }

  // ──────────────────────────────────────────────────────────────────
  // Keyboard navigation
  // ──────────────────────────────────────────────────────────────────

  private wireKeyboard(): void {
    this.container.addEventListener("keydown", (e) => {
      // `/` focuses search (when not typing in an input already).
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        this.searchInputEl.focus();
        this.searchInputEl.select();
        return;
      }
      // Navigation within workspace list.
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (e.target instanceof HTMLInputElement) return;
        e.preventDefault();
        this.moveHighlight(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter") {
        if (e.target instanceof HTMLInputElement) return;
        const ws = this.highlightedWorkspace();
        if (ws) {
          e.preventDefault();
          this.callbacks.onSelectWorkspace(ws.id);
        }
      } else if (e.key === "F2") {
        const ws = this.highlightedWorkspace();
        if (ws) {
          e.preventDefault();
          this.beginRename(ws);
        }
      } else if (e.key === " " && !(e.target instanceof HTMLInputElement)) {
        const ws = this.highlightedWorkspace();
        if (ws) {
          e.preventDefault();
          this.togglePin(ws.id);
        }
      }
    });
  }

  private moveHighlight(dir: 1 | -1): void {
    const list = this.currentlyVisibleCards();
    if (list.length === 0) return;
    if (this.highlightIndex === -1) {
      this.highlightIndex = dir === 1 ? 0 : list.length - 1;
    } else {
      this.highlightIndex =
        (this.highlightIndex + dir + list.length) % list.length;
    }
    this.applyHighlight();
    list[this.highlightIndex]?.scrollIntoView({ block: "nearest" });
  }

  private applyHighlight(): void {
    const list = this.currentlyVisibleCards();
    list.forEach((el, i) => {
      el.classList.toggle("keyboard-focus", i === this.highlightIndex);
    });
  }

  private currentlyVisibleCards(): HTMLElement[] {
    return [...this.listEl.querySelectorAll<HTMLElement>(".workspace-item")];
  }

  private highlightedWorkspace(): WorkspaceInfo | null {
    const cards = this.currentlyVisibleCards();
    const el = cards[this.highlightIndex];
    if (!el) return null;
    const id = el.dataset["workspaceId"];
    return this.workspaces.find((w) => w.id === id) ?? null;
  }

  // ──────────────────────────────────────────────────────────────────
  // Manifest card adapters (unchanged contract with sidebar-manifest-card)
  // ──────────────────────────────────────────────────────────────────

  private expandedPackages: Set<string> = new Set();

  private renderPackageManifestCard(
    ws: WorkspaceInfo,
    pkg: PackageInfo,
  ): HTMLElement {
    const key = `${ws.id}:npm`;
    const expanded = this.expandedPackages.has(key);
    const scriptKeys = pkg.scripts ? Object.keys(pkg.scripts) : [];
    const actions: ManifestAction[] = scriptKeys.map((name) => ({
      key: `${ws.id}:${name}`,
      label: name,
      command: pkg.scripts![name] ?? name,
      state: actionState(name, ws.runningScripts, ws.erroredScripts),
    }));
    return renderManifestCard({
      kind: "npm",
      workspaceId: ws.id,
      directory: pkg.directory,
      name: pkg.name,
      version: pkg.version,
      subLabel: pkg.type,
      description: pkg.description,
      binaries: pkgBinaryNames(pkg),
      actions,
      expanded,
      onToggle: () => this.toggleExpanded(key),
    });
  }

  private renderCargoManifestCard(
    ws: WorkspaceInfo,
    cargo: CargoInfo,
  ): HTMLElement {
    const key = `${ws.id}:cargo`;
    const expanded = this.expandedPackages.has(key);

    const defaults: Array<[string, string]> = cargo.isWorkspace
      ? [
          ["build", "cargo build --workspace"],
          ["test", "cargo test --workspace"],
          ["check", "cargo check --workspace"],
          ["clippy", "cargo clippy --workspace --all-targets"],
          ["fmt", "cargo fmt --all"],
        ]
      : [
          ["build", "cargo build"],
          ["run", "cargo run"],
          ["test", "cargo test"],
          ["check", "cargo check"],
          ["clippy", "cargo clippy --all-targets"],
          ["fmt", "cargo fmt"],
        ];

    const actions: ManifestAction[] = defaults.map(([sub, command]) => ({
      key: `${ws.id}:cargo:${sub}`,
      label: sub,
      command,
      state: actionState(sub, ws.runningCargoActions, ws.erroredCargoActions),
    }));

    if (!cargo.isWorkspace && cargo.binaries.length > 1) {
      for (const bin of cargo.binaries) {
        actions.push({
          key: `${ws.id}:cargo:run-bin-${bin}`,
          label: `run ${bin}`,
          command: `cargo run --bin ${bin}`,
          state: "idle",
        });
      }
    }

    return renderManifestCard({
      kind: "cargo",
      workspaceId: ws.id,
      directory: cargo.directory,
      name: cargo.name,
      version: cargo.version,
      subLabel: cargo.edition ? `edition ${cargo.edition}` : undefined,
      description: cargo.description,
      binaries: cargo.binaries,
      actions,
      expanded,
      onToggle: () => this.toggleExpanded(key),
    });
  }

  private toggleExpanded(key: string): void {
    if (this.expandedPackages.has(key)) this.expandedPackages.delete(key);
    else this.expandedPackages.add(key);
    this.renderWorkspaces();
  }
}

function actionState(
  name: string,
  running: string[],
  errored: string[],
): ManifestActionState {
  if (running.includes(name)) return "running";
  if (errored.includes(name)) return "error";
  return "idle";
}

function pkgBinaryNames(pkg: PackageInfo): string[] | undefined {
  if (!pkg.bin) return undefined;
  if (typeof pkg.bin === "string") return pkg.name ? [pkg.name] : ["(bin)"];
  const keys = Object.keys(pkg.bin);
  return keys.length > 0 ? keys : undefined;
}

/** Last two path segments (or full path if short). */
function shortCwd(cwd: string): string {
  if (!cwd) return "";
  const parts = cwd.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length <= 2) {
    return cwd.startsWith("/") ? "/" + parts.join("/") : parts.join("/");
  }
  return "\u2026/" + parts.slice(-2).join("/");
}

function humanRss(kb: number): string {
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

function relativeTime(epochMs: number): string {
  const diffS = Math.max(0, (Date.now() - epochMs) / 1000);
  if (diffS < 10) return "just now";
  if (diffS < 60) return `${Math.round(diffS)}s ago`;
  const diffM = diffS / 60;
  if (diffM < 60) return `${Math.round(diffM)}m ago`;
  const diffH = diffM / 60;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  return new Date(epochMs).toLocaleDateString();
}
