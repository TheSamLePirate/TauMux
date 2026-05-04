import type {
  CargoInfo,
  PackageInfo,
  TelegramStatusWire,
  WorkspaceContextMenuRequest,
} from "../../shared/types";
import { parseStatusKey } from "../../shared/status-key";
import { ICON_TEMPLATES, createIcon, type IconName } from "./icons";
import {
  renderManifestCard,
  type ManifestAction,
  type ManifestActionState,
} from "./sidebar-manifest-card";
import { renderStatusEntry } from "./status-renderers";

/** Per-card slot cache used by Phase 3 of the perf pass. Each slot
 *  is a section of the workspace card; the matching `sigs` entry is
 *  the per-section signature computed from the slice of
 *  `WorkspaceInfo` that drives that section. A miss rebuilds the
 *  slot; a hit reuses the cached element across renders. */
type CardSlotKey =
  | "stripe"
  | "header"
  | "meta"
  | "stats"
  | "cwds"
  | "panes"
  | "manifests"
  | "status"
  | "progress";
interface CardSlotCache {
  slots: Partial<Record<CardSlotKey, HTMLElement>>;
  sigs: Partial<Record<CardSlotKey, string>>;
}

/** Stable JSON signature of a `WorkspaceInfo[]`. Used by
 *  `Sidebar.setWorkspaces` to skip the render when the incoming
 *  payload is byte-identical to the last one. The replacer flattens
 *  Set fields (e.g. workspace.surfaceIds isn't a Set on `WorkspaceInfo`
 *  but defensive against future additions) and the Map values that
 *  occasionally surface in `statusPills`. Plain JSON for everything
 *  else — an O(string-length) string compare is cheaper than the
 *  full sidebar render. */
function stableWorkspacesSignature(list: unknown): string {
  return JSON.stringify(list, (_key, value) => {
    if (value instanceof Set) return [...value];
    if (value instanceof Map) return [...value.entries()];
    return value;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Sidebar (V2 — hyper-dense, color-forward, zero border-radius)
//
// Layout philosophy
//  • Every row uses a 3 px left color stripe drawn from the workspace's
//    accent. That stripe is the identity marker — not a dot chip — and
//    it flexes: brighter + wider on active, dim + narrow on inactive.
//  • Every workspace shows a CPU bar, port chips and fg command inline,
//    not just the active one. The user asked for dense info, so all
//    workspaces surface their load/network at a glance.
//  • Sharp corners everywhere (no border-radius). 1 px hairline rules
//    divide sections. Xcode/Ableton/Panic Nova aesthetic.
//  • Active workspace fans out below its header with pinned-cwd chips,
//    pane list, npm/cargo manifest, status grid, progress bar.
//
// Public API (unchanged — SurfaceManager + tests rely on it):
//    new Sidebar(container, callbacks)
//    getResizeHandle()         setNotifications(list)
//    setWorkspaces(list)       acknowledgeBySurface(surfaceId)
//    toggle() / isVisible()    setWebServerStatus(running, port, url?)
//    setLogs(list)             setTelegramStatus(status)
//
// DOM contracts tested elsewhere:
//   .notification-item / .glow / .notification-title /
//   .notification-body-btn / .notification-dismiss /
//   .sidebar-section-header with text "Notifications (N)"
// ─────────────────────────────────────────────────────────────────────

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
  logs: boolean;
}

interface WorkspaceUiState {
  pinned: boolean;
  manifestsOpen: boolean;
  panesOpen: boolean;
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
  logs: true,
};

const DEFAULT_WS_UI: WorkspaceUiState = {
  pinned: false,
  manifestsOpen: true,
  panesOpen: false,
  statusOpen: true,
};

const DEFAULT_ACCENT = "#89b4fa";

/** Subfield visibility + density configuration for the workspace
 *  cards. Pushed in by surface-manager from `AppSettings`. */
export interface WorkspaceCardOptions {
  density: "compact" | "comfortable" | "spacious";
  show: {
    meta: boolean;
    stats: boolean;
    panes: boolean;
    manifests: boolean;
    statusPills: boolean;
    progress: boolean;
  };
}

export const DEFAULT_WORKSPACE_CARD_OPTIONS: WorkspaceCardOptions = {
  density: "comfortable",
  show: {
    meta: true,
    stats: true,
    panes: true,
    manifests: true,
    statusPills: true,
    progress: true,
  },
};

export class Sidebar {
  private container: HTMLElement;
  private headerEl: HTMLElement;
  private searchInputEl!: HTMLInputElement;
  private filterBarEl!: HTMLElement;
  private globalStatsEl!: HTMLElement;
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
  private expandedPackages: Set<string> = new Set();

  /** Plan #06: per-section visibility + density for the workspace
   *  card. Surface-manager pushes the user's choices via
   *  `setWorkspaceCardOptions`; defaults match the pre-Plan-#06
   *  behaviour so tests + e2e fixtures keep rendering everything. */
  private cardOptions: WorkspaceCardOptions = DEFAULT_WORKSPACE_CARD_OPTIONS;

  /** Plan #10 commit C: pending ask-user count by workspace id.
   *  Pushed in by `setAskUserPending`; read in `buildCardHeader` to
   *  render the "N ?" pill next to the pane-count badge. Empty
   *  default means no badge, matching the pre-Plan-#10 layout. */
  private askUserPendingByWorkspace = new Map<string, number>();

  /** Perf pass (Phase 2B): hash of the last `WorkspaceInfo[]` we
   *  rendered. `setWorkspaces` short-circuits when the new payload
   *  hashes to the same value — the 1 Hz metadata tick mostly ships
   *  identical data, and rebuilding 80–200 DOM nodes for "no change"
   *  is the dominant idle-CPU draw. Stored as a stable JSON string
   *  with a Set replacer; comparison is O(string-length). */
  private lastWorkspacesSig: string | null = null;

  /** Perf pass (Phase 3): per-card section caches. Each entry stores
   *  the most-recently-built section nodes plus a per-section
   *  signature; `populateWorkspaceCard` rebuilds only the sections
   *  whose signature changed since the previous render. The 1 Hz
   *  tick that drives stat-row updates no longer rebuilds header /
   *  meta / cwds / panes / manifests / status / progress when only
   *  cpuPercent moved. Cached by workspace id; cleared on workspace
   *  removal via `reconcileUiState`. */
  private cardSlots = new Map<string, CardSlotCache>();

  /** Plan #06 §A — keyed reconciliation cache. The previous
   *  implementation did `listEl.innerHTML = ""` on every refresh,
   *  which tore down every workspace card and rebuilt it from
   *  scratch — visible flicker on the 1 Hz metadata poll. Now we
   *  keep the outer card element per workspace id and update its
   *  contents in place; reordering uses `appendChild` (which
   *  re-parents in place rather than cloning), so node identity
   *  survives every refresh. */
  private workspaceItems = new Map<string, HTMLElement>();
  /** Cached group-rule rows ("PINNED" / "ALL"). Same identity
   *  story as the cards — reused across refreshes so background /
   *  border / box-shadow don't strobe. */
  private groupRulePinned: HTMLElement | null = null;
  private groupRuleAll: HTMLElement | null = null;
  /** Empty-state placeholder element. Reused so swapping in/out of
   *  empty state keeps the parent's layout stable. */
  private emptyEl: HTMLElement | null = null;

  constructor(container: HTMLElement, callbacks: SidebarCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.container.classList.add("sidebar-v2");

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

    // ── Header (rail): app glyph · title · count · new btn ─────────
    this.headerEl = this.buildHeader();
    container.appendChild(this.headerEl);

    // ── Search + segmented filter + aggregate stats ────────────────
    container.appendChild(this.buildSearchBar());

    // ── Notifications (inline, dense) ──────────────────────────────
    this.notificationsEl = document.createElement("div");
    this.notificationsEl.className = "sidebar-notifications";
    container.appendChild(this.notificationsEl);

    // ── Workspaces list ────────────────────────────────────────────
    this.listSectionEl = document.createElement("div");
    this.listSectionEl.className = "sidebar-list-section";

    this.listEl = document.createElement("div");
    this.listEl.className = "sidebar-workspaces";
    this.listSectionEl.appendChild(this.listEl);
    container.appendChild(this.listSectionEl);

    // ── Logs (collapsible) ─────────────────────────────────────────
    this.logsEl = document.createElement("div");
    this.logsEl.className = "sidebar-logs";
    container.appendChild(this.logsEl);

    // ── Footer (Telegram + Web Mirror, full-width flush strip) ─────
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

    this.wireKeyboard();
    this.applySectionOpenClasses();

    // Re-render notification relative times every 30 s — Sidebar lives
    // for the lifetime of the app so we never clear the interval.
    setInterval(() => this.refreshNotificationTimes(), 30_000);
  }

  // ──────────────────────────────────────────────────────────────────
  // Public API (stable contract)
  // ──────────────────────────────────────────────────────────────────

  getResizeHandle(): HTMLElement {
    return this.resizeHandleEl;
  }

  setWorkspaces(workspaces: WorkspaceInfo[]): void {
    // Phase 2B perf pass: skip the render entirely when the incoming
    // payload is byte-identical to the last one. JSON.stringify with
    // a Set→Array replacer gives a stable signature; floats like
    // cpuPercent / memRssKb travel through unchanged so any actual
    // movement still triggers a render. Both `reconcileManualOrder`
    // and `reconcileUiState` are pure functions of `this.workspaces`,
    // so we still call them even on the skip path so any internal
    // dirty bookkeeping stays consistent.
    this.workspaces = workspaces;
    this.reconcileManualOrder();
    this.reconcileUiState();
    const sig = stableWorkspacesSignature(workspaces);
    if (sig === this.lastWorkspacesSig) return;
    this.lastWorkspacesSig = sig;
    this.renderWorkspaces();
    this.renderGlobalStats();
  }

  /** Push the workspace-card display preferences in. Surface-manager
   *  calls this from `applySettings` so any change in
   *  `workspaceCardDensity` / `workspaceCardShow*` settings repaints
   *  the affected cards on the next render pass. The density attr
   *  lands on the sidebar root immediately so CSS density rules
   *  apply even before the next data update. */
  setWorkspaceCardOptions(options: WorkspaceCardOptions): void {
    this.cardOptions = options;
    this.container.setAttribute("data-ws-card-density", options.density);
    if (this.workspaces.length > 0) this.renderWorkspaces();
  }

  /** Plan #10 commit C: pending ask-user count keyed by workspace id.
   *  Index.ts's ask-user-state subscriber aggregates pending counts
   *  per workspace and pushes the map; the workspace card renders the
   *  cyan "?" pill next to the pane-count badge. Empty / zero entries
   *  hide the pill.
   *
   *  Perf pass (Phase 1D): does NOT call `renderWorkspaces()` anymore.
   *  A badge update used to repaint every workspace card; now we walk
   *  the cached card nodes and surgically add / update / remove just
   *  the `.workspace-ask-badge` element on each. Cuts a 1 Hz full
   *  sidebar render to a constant-cost field-mutation. */
  setAskUserPending(map: Map<string, number>): void {
    this.askUserPendingByWorkspace = map;
    if (this.workspaces.length === 0) return;
    for (const [wsId, item] of this.workspaceItems) {
      const header = item.querySelector(
        ".workspace-card-header",
      ) as HTMLElement | null;
      if (!header) continue;
      const existing = header.querySelector(
        ".workspace-ask-badge",
      ) as HTMLElement | null;
      const count = map.get(wsId) ?? 0;
      if (count <= 0) {
        if (existing) existing.remove();
        continue;
      }
      const text = `${count} ?`;
      const tooltip = `${count} pending agent question${count === 1 ? "" : "s"}`;
      if (existing) {
        if (existing.textContent !== text) existing.textContent = text;
        if (existing.title !== tooltip) existing.title = tooltip;
        continue;
      }
      const pill = document.createElement("span");
      pill.className = "workspace-ask-badge";
      pill.title = tooltip;
      pill.textContent = text;
      // Insert next to the pane-count badge if present; otherwise
      // append at the end of the header. Matches buildCardHeader's
      // ordering on first paint.
      const paneBadge = header.querySelector(".workspace-pane-badge");
      if (paneBadge && paneBadge.nextSibling) {
        header.insertBefore(pill, paneBadge.nextSibling);
      } else if (paneBadge) {
        header.appendChild(pill);
      } else {
        header.appendChild(pill);
      }
    }
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
  // Header / search / filters
  // ──────────────────────────────────────────────────────────────────

  private buildHeader(): HTMLElement {
    const header = document.createElement("div");
    header.className = "sidebar-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "sidebar-header-copy";

    const title = document.createElement("span");
    title.className = "sidebar-title";
    title.append(createIcon("sidebar", "sidebar-title-icon", 13));
    const titleText = document.createElement("span");
    titleText.textContent = "Workspaces";
    title.appendChild(titleText);

    this.listCountEl = document.createElement("span");
    this.listCountEl.className = "sidebar-title-count";
    title.appendChild(this.listCountEl);
    titleWrap.appendChild(title);

    const subtitle = document.createElement("span");
    subtitle.className = "sidebar-subtitle";
    subtitle.textContent = "Navigate · monitor · run";
    titleWrap.appendChild(subtitle);

    header.appendChild(titleWrap);

    const headerActions = document.createElement("div");
    headerActions.className = "sidebar-header-actions";

    const collapseAllBtn = document.createElement("button");
    collapseAllBtn.className = "sidebar-icon-btn";
    collapseAllBtn.type = "button";
    collapseAllBtn.title = "Collapse all sections";
    collapseAllBtn.setAttribute("aria-label", "Collapse all sections");
    collapseAllBtn.append(createIcon("chevronUp", "", 12));
    collapseAllBtn.addEventListener("click", () =>
      this.toggleAllSections(false),
    );
    headerActions.appendChild(collapseAllBtn);

    const newBtn = document.createElement("button");
    newBtn.className = "sidebar-new-btn";
    newBtn.title = "New workspace (⌘T)";
    newBtn.setAttribute("aria-label", "New workspace");
    newBtn.type = "button";
    newBtn.append(createIcon("plus", "", 14));
    newBtn.addEventListener("click", () => this.callbacks.onNewWorkspace());
    headerActions.appendChild(newBtn);

    header.appendChild(headerActions);
    return header;
  }

  private buildSearchBar(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "sidebar-search-bar";

    const searchWrap = document.createElement("label");
    searchWrap.className = "sidebar-search";
    searchWrap.append(createIcon("search", "sidebar-search-icon", 12));

    this.searchInputEl = document.createElement("input");
    this.searchInputEl.type = "search";
    this.searchInputEl.className = "sidebar-search-input";
    this.searchInputEl.placeholder = "Filter · /";
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
      } else if (e.key === "ArrowDown") {
        // Arrow-down from search jumps into the workspace list so the
        // user can /foo → arrow down → Enter without touching the mouse.
        e.preventDefault();
        this.searchInputEl.blur();
        this.moveHighlight(1);
      }
    });
    searchWrap.appendChild(this.searchInputEl);
    bar.appendChild(searchWrap);

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
    bar.appendChild(this.filterBarEl);

    this.globalStatsEl = document.createElement("div");
    this.globalStatsEl.className = "sidebar-global-stats";
    bar.appendChild(this.globalStatsEl);

    return bar;
  }

  private renderGlobalStats(): void {
    const totalCpu = this.workspaces.reduce((s, w) => s + w.cpuPercent, 0);
    const totalMem = this.workspaces.reduce((s, w) => s + w.memRssKb, 0);
    const totalProc = this.workspaces.reduce((s, w) => s + w.processCount, 0);
    const totalPorts = new Set<number>();
    for (const w of this.workspaces)
      for (const p of w.listeningPorts) totalPorts.add(p);

    this.globalStatsEl.innerHTML = "";
    const cpu = document.createElement("span");
    cpu.className = "sidebar-global-stat stat-cpu";
    cpu.title = `Total CPU across ${totalProc} process${totalProc === 1 ? "" : "es"}`;
    cpu.append(createIcon("cpu", "", 10));
    const cpuVal = document.createElement("span");
    cpuVal.textContent = `${Math.round(totalCpu)}%`;
    cpu.appendChild(cpuVal);

    const mem = document.createElement("span");
    mem.className = "sidebar-global-stat stat-mem";
    mem.title = `Total resident memory`;
    mem.append(createIcon("memory", "", 10));
    const memVal = document.createElement("span");
    memVal.textContent = humanRss(totalMem);
    mem.appendChild(memVal);

    const proc = document.createElement("span");
    proc.className = "sidebar-global-stat stat-proc";
    proc.title = `Total processes under τ-mux`;
    proc.append(createIcon("activity", "", 10));
    const procVal = document.createElement("span");
    procVal.textContent = String(totalProc);
    proc.appendChild(procVal);

    if (totalPorts.size > 0) {
      const portEl = document.createElement("span");
      portEl.className = "sidebar-global-stat stat-port";
      portEl.title = `Listening ports across all workspaces`;
      portEl.append(createIcon("network", "", 10));
      const v = document.createElement("span");
      v.textContent = String(totalPorts.size);
      portEl.appendChild(v);
      this.globalStatsEl.appendChild(portEl);
    }

    this.globalStatsEl.appendChild(cpu);
    this.globalStatsEl.appendChild(mem);
    this.globalStatsEl.appendChild(proc);
  }

  // ──────────────────────────────────────────────────────────────────
  // Workspaces list
  // ──────────────────────────────────────────────────────────────────

  private renderWorkspaces(): void {
    const ordered = this.orderedWorkspaces();
    const filtered = this.applyFilter(ordered);

    if (this.listCountEl) {
      this.listCountEl.textContent = `${filtered.length}${filtered.length !== ordered.length ? ` / ${ordered.length}` : ""}`;
    }

    if (filtered.length === 0) {
      // Empty state — drop every cached card from the DOM but keep
      // the cache (workspaces may flicker out and back in via
      // filter changes; reusing the next time saves the rebuild).
      // We do detach them from the parent so the empty placeholder
      // becomes the only visible row.
      for (const item of this.workspaceItems.values()) {
        if (item.parentElement) item.parentElement.removeChild(item);
      }
      this.detachGroupRules();
      const empty = this.ensureEmpty();
      empty.textContent =
        ordered.length === 0
          ? "No workspaces yet — ⌘T to create one"
          : this.searchTerm.length > 0
            ? `No match for "${this.searchTerm}"`
            : this.filterMode === "pinned"
              ? "No pinned workspaces"
              : "No matching workspaces";
      // Remove any other children, then mount the cached empty.
      while (this.listEl.firstChild && this.listEl.firstChild !== empty) {
        this.listEl.removeChild(this.listEl.firstChild);
      }
      if (empty.parentElement !== this.listEl) {
        this.listEl.appendChild(empty);
      }
      return;
    }

    // Empty state was previously visible — drop it.
    if (this.emptyEl?.parentElement === this.listEl) {
      this.listEl.removeChild(this.emptyEl);
    }

    // Pinned first, with a flat "PINNED" rule between groups.
    const pinned = filtered.filter((w) => this.pinnedIds.has(w.id));
    const rest = filtered.filter((w) => !this.pinnedIds.has(w.id));

    // Build the desired ordered list of `(rule | card)` nodes —
    // identity-stable: reuses cached elements where possible.
    const desired: HTMLElement[] = [];
    if (pinned.length > 0) {
      desired.push(this.ensureGroupRulePinned(pinned.length));
      for (const ws of pinned) desired.push(this.upsertWorkspaceCard(ws));
    }
    if (rest.length > 0) {
      if (pinned.length > 0) {
        desired.push(this.ensureGroupRuleAll(rest.length));
      }
      for (const ws of rest) desired.push(this.upsertWorkspaceCard(ws));
    }

    // Reconcile with the current children. `appendChild` re-parents
    // an already-attached node (preserving identity); we walk the
    // desired list and either append-as-new or move-into-position.
    // After this loop, anything still left in `current` past
    // `desired.length` is leftover and gets removed.
    const liveCards = new Set(desired);
    let i = 0;
    let cur = this.listEl.firstChild as HTMLElement | null;
    while (i < desired.length) {
      const want = desired[i]!;
      if (cur === want) {
        cur = want.nextSibling as HTMLElement | null;
        i++;
        continue;
      }
      // `insertBefore(want, cur)` is the move primitive — if `want`
      // is already mounted elsewhere it's removed first; if not it's
      // inserted; either way order is corrected without re-creating
      // the node.
      this.listEl.insertBefore(want, cur);
      i++;
    }
    // Drop any trailing children that aren't in the desired list.
    while (cur) {
      const next = cur.nextSibling as HTMLElement | null;
      if (!liveCards.has(cur)) this.listEl.removeChild(cur);
      cur = next;
    }
    // Garbage-collect cards for workspaces no longer present.
    const liveIds = new Set(filtered.map((w) => w.id));
    for (const [id, el] of [...this.workspaceItems.entries()]) {
      if (!liveIds.has(id)) {
        if (el.parentElement) el.parentElement.removeChild(el);
        this.workspaceItems.delete(id);
      }
    }

    this.applyHighlight();
  }

  private detachGroupRules(): void {
    if (this.groupRulePinned?.parentElement === this.listEl) {
      this.listEl.removeChild(this.groupRulePinned);
    }
    if (this.groupRuleAll?.parentElement === this.listEl) {
      this.listEl.removeChild(this.groupRuleAll);
    }
  }

  private ensureEmpty(): HTMLElement {
    if (!this.emptyEl) {
      this.emptyEl = document.createElement("div");
      this.emptyEl.className = "sidebar-empty";
    }
    return this.emptyEl;
  }

  private ensureGroupRulePinned(count: number): HTMLElement {
    if (!this.groupRulePinned) {
      this.groupRulePinned = this.buildGroupRule("PINNED", count);
    } else {
      this.updateGroupRuleCount(this.groupRulePinned, count);
    }
    return this.groupRulePinned;
  }

  private ensureGroupRuleAll(count: number): HTMLElement {
    if (!this.groupRuleAll) {
      this.groupRuleAll = this.buildGroupRule("ALL", count);
    } else {
      this.updateGroupRuleCount(this.groupRuleAll, count);
    }
    return this.groupRuleAll;
  }

  private updateGroupRuleCount(rule: HTMLElement, count: number): void {
    const el = rule.querySelector<HTMLElement>(".sidebar-group-rule-count");
    if (el) el.textContent = String(count);
  }

  private buildGroupRule(label: string, count: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "sidebar-group-rule";
    const tag = document.createElement("span");
    tag.className = "sidebar-group-rule-label";
    tag.textContent = label;
    row.appendChild(tag);
    const rule = document.createElement("span");
    rule.className = "sidebar-group-rule-line";
    row.appendChild(rule);
    const c = document.createElement("span");
    c.className = "sidebar-group-rule-count";
    c.textContent = String(count);
    row.appendChild(c);
    return row;
  }

  /** Cache-aware card constructor. First call for a workspace builds
   *  the outer shell + attaches stable listeners; subsequent calls
   *  reuse the same element and only refresh inner contents +
   *  variable attributes (class flags, accent var, aria-current).
   *  Node identity survives every refresh, so the browser doesn't
   *  flash background/border on each metadata poll. */
  private upsertWorkspaceCard(ws: WorkspaceInfo): HTMLElement {
    let item = this.workspaceItems.get(ws.id);
    if (!item) {
      item = this.createWorkspaceCardShell(ws.id);
      this.workspaceItems.set(ws.id, item);
    }
    this.populateWorkspaceCard(item, ws);
    return item;
  }

  /** Build the outer shell once. Listeners attach here so they
   *  survive every render; they read the current `ws` snapshot
   *  from `this.workspaces` via id rather than capturing a stale
   *  reference. */
  private createWorkspaceCardShell(id: string): HTMLElement {
    const item = document.createElement("div");
    item.className = "workspace-item";
    item.dataset["workspaceId"] = id;
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "-1");
    item.draggable = true;

    item.addEventListener("click", () => {
      this.callbacks.onSelectWorkspace(id);
    });
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const ws = this.workspaces.find((w) => w.id === id);
      if (!ws) return;
      const detail: WorkspaceContextMenuRequest = {
        kind: "workspace",
        workspaceId: ws.id,
        name: ws.name,
        color: ws.color,
      };
      window.dispatchEvent(new CustomEvent("ht-open-context-menu", { detail }));
    });

    this.wireDragAndDrop(item, id);
    return item;
  }

  /** Update an outer card's variable attributes + inner contents
   *  in place. The outer element identity is preserved (Plan #06
   *  Tier 1); inner sections are now individually cached + diffed
   *  by per-section signature (Phase 3 perf pass — Tier 2). The
   *  most common metadata-tick case (only cpuPercent / cpuHistory
   *  moved) now rebuilds only the stat row; header / meta / cwds /
   *  panes / manifests / status / progress reuse their cached
   *  nodes. */
  private populateWorkspaceCard(item: HTMLElement, ws: WorkspaceInfo): void {
    this.ensureUiState(ws.id);
    const accent = ws.color || DEFAULT_ACCENT;

    item.className = `workspace-item${ws.active ? " active" : ""}${
      this.pinnedIds.has(ws.id) ? " pinned" : ""
    }`;
    item.style.setProperty("--workspace-accent", accent);
    item.setAttribute("aria-current", ws.active ? "true" : "false");

    let cache = this.cardSlots.get(ws.id);
    if (!cache) {
      cache = { slots: {}, sigs: {} };
      this.cardSlots.set(ws.id, cache);
    }

    const ordered: HTMLElement[] = [];
    const show = this.cardOptions.show;
    const ui = this.uiState.get(ws.id);
    const renamingHere = this.renamingId === ws.id;
    const askPending = this.askUserPendingByWorkspace.get(ws.id) ?? 0;

    // ── stripe ───────────────────────────────────────────────────
    {
      const sig = `s:${accent}`;
      if (cache.sigs.stripe !== sig || !cache.slots.stripe) {
        const stripe = document.createElement("span");
        stripe.className = "workspace-stripe";
        stripe.setAttribute("aria-hidden", "true");
        cache.slots.stripe = stripe;
        cache.sigs.stripe = sig;
      }
      ordered.push(cache.slots.stripe);
    }

    // ── header ───────────────────────────────────────────────────
    {
      const sig = [
        "h",
        ws.name,
        ws.color ?? "",
        ws.active ? "1" : "0",
        this.pinnedIds.has(ws.id) ? "p" : "",
        ws.surfaceTitles.length,
        renamingHere ? "r" : "",
        askPending,
      ].join("|");
      if (cache.sigs.header !== sig || !cache.slots.header) {
        cache.slots.header = this.buildCardHeader(ws);
        cache.sigs.header = sig;
      }
      ordered.push(cache.slots.header);
    }

    // ── meta row ────────────────────────────────────────────────
    if (show.meta) {
      const sig = [
        "m",
        ws.focusedSurfaceCommand ?? "",
        ws.focusedSurfaceTitle ?? "",
        ws.listeningPorts.join(","),
        ws.runningScripts.join(","),
        ws.erroredScripts.join(","),
        ws.runningCargoActions.join(","),
        ws.erroredCargoActions.join(","),
      ].join("|");
      if (cache.sigs.meta !== sig) {
        const fresh = this.buildCardMetaRow(ws);
        if (fresh) {
          cache.slots.meta = fresh;
        } else {
          delete cache.slots.meta;
        }
        cache.sigs.meta = sig;
      }
      if (cache.slots.meta) ordered.push(cache.slots.meta);
    } else {
      delete cache.slots.meta;
      delete cache.sigs.meta;
    }

    // ── stat row (the hot one — moves on every metadata tick) ───
    if (show.stats) {
      const sig = [
        "st",
        ws.cpuPercent.toFixed(1),
        ws.memRssKb,
        ws.processCount,
        ws.cpuHistory.join(","),
        ws.active ? "1" : "0",
        accent,
      ].join("|");
      if (cache.sigs.stats !== sig || !cache.slots.stats) {
        cache.slots.stats = this.buildCardStatRow(ws, accent);
        cache.sigs.stats = sig;
      }
      ordered.push(cache.slots.stats);
    } else {
      delete cache.slots.stats;
      delete cache.sigs.stats;
    }

    // ── active-only sections ────────────────────────────────────
    if (ws.active) {
      // cwds row
      if (ws.cwds.length > 1) {
        const sig = ["c", ws.cwds.join("|"), ws.selectedCwd ?? ""].join("|");
        if (cache.sigs.cwds !== sig || !cache.slots.cwds) {
          cache.slots.cwds = this.buildCwdRow(ws);
          cache.sigs.cwds = sig;
        }
        ordered.push(cache.slots.cwds);
      } else {
        delete cache.slots.cwds;
        delete cache.sigs.cwds;
      }

      // panes
      if (show.panes && ws.surfaceTitles.length > 1) {
        const open = ui?.panesOpen ?? false;
        const sig = ["p", ws.surfaceTitles.join("|"), open ? "1" : "0"].join(
          "|",
        );
        if (cache.sigs.panes !== sig || !cache.slots.panes) {
          cache.slots.panes = this.buildCollapseSection({
            wsId: ws.id,
            key: "panesOpen",
            title: "Panes",
            count: ws.surfaceTitles.length,
            build: () => this.buildPanesList(ws),
          });
          cache.sigs.panes = sig;
        }
        ordered.push(cache.slots.panes);
      } else {
        delete cache.slots.panes;
        delete cache.sigs.panes;
      }

      // manifests
      if (show.manifests && (ws.packageJson || ws.cargoToml)) {
        const open = ui?.manifestsOpen ?? false;
        const count = (ws.packageJson ? 1 : 0) + (ws.cargoToml ? 1 : 0);
        // Per-card expansion lives in `this.expandedPackages` and is
        // mutated by `toggleExpanded`, which calls `renderWorkspaces`
        // directly. Bake it into the sig or a click on the card header
        // hits a stale cache slot — the user sees no expansion until
        // they click the outer panel header (which flips `open` and
        // forces a rebuild). Same goes for script run/error state: it
        // drives the action-row dot colour, so without it in the sig a
        // running script's orange dot doesn't appear until the panel
        // is closed and reopened.
        const npmExpanded =
          ws.packageJson && this.expandedPackages.has(`${ws.id}:npm`)
            ? "1"
            : "0";
        const cargoExpanded =
          ws.cargoToml && this.expandedPackages.has(`${ws.id}:cargo`)
            ? "1"
            : "0";
        const sig = [
          "mf",
          stableWorkspacesSignature(ws.packageJson ?? null),
          stableWorkspacesSignature(ws.cargoToml ?? null),
          open ? "1" : "0",
          count,
          npmExpanded,
          cargoExpanded,
          ws.runningScripts.join(","),
          ws.erroredScripts.join(","),
          ws.runningCargoActions.join(","),
          ws.erroredCargoActions.join(","),
        ].join("|");
        if (cache.sigs.manifests !== sig || !cache.slots.manifests) {
          cache.slots.manifests = this.buildCollapseSection({
            wsId: ws.id,
            key: "manifestsOpen",
            title: "Manifests",
            count,
            build: () => this.buildManifestsBlock(ws),
          });
          cache.sigs.manifests = sig;
        }
        ordered.push(cache.slots.manifests);
      } else {
        delete cache.slots.manifests;
        delete cache.sigs.manifests;
      }

      // status pills
      if (show.statusPills && ws.statusPills.length > 0) {
        const open = ui?.statusOpen ?? false;
        const sig = [
          "sp",
          ws.statusPills
            .map((p) => `${p.key}=${p.value}|${p.color ?? ""}|${p.icon ?? ""}`)
            .join("/"),
          open ? "1" : "0",
        ].join("|");
        if (cache.sigs.status !== sig || !cache.slots.status) {
          cache.slots.status = this.buildCollapseSection({
            wsId: ws.id,
            key: "statusOpen",
            title: "Status",
            count: ws.statusPills.length,
            build: () => this.buildStatusGrid(ws),
          });
          cache.sigs.status = sig;
        }
        ordered.push(cache.slots.status);
      } else {
        delete cache.slots.status;
        delete cache.sigs.status;
      }

      // progress
      if (show.progress && ws.progress) {
        const sig = `pr|${ws.progress.value}|${ws.progress.label ?? ""}`;
        if (cache.sigs.progress !== sig || !cache.slots.progress) {
          cache.slots.progress = this.buildProgressBar(ws);
          cache.sigs.progress = sig;
        }
        ordered.push(cache.slots.progress);
      } else {
        delete cache.slots.progress;
        delete cache.sigs.progress;
      }
    } else {
      // Inactive cards drop their active-only sections from cache so
      // a re-activation rebuilds with fresh data (e.g. progress that
      // arrived while the card was inactive).
      delete cache.slots.cwds;
      delete cache.slots.panes;
      delete cache.slots.manifests;
      delete cache.slots.status;
      delete cache.slots.progress;
      delete cache.sigs.cwds;
      delete cache.sigs.panes;
      delete cache.sigs.manifests;
      delete cache.sigs.status;
      delete cache.sigs.progress;
    }

    // Replace children with the ordered slot list. When the slots
    // are the same nodes in the same order as the current children
    // (the common case post-Phase-3), the browser reuses them in
    // place — no destruction or re-layout. When sections were
    // rebuilt, only those nodes are new.
    item.replaceChildren(...ordered);
  }

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

  // ── Workspace card ─────────────────────────────────────────────────
  //
  // Plan #06 §A — keyed reconciliation. The outer card builder /
  // populator is split into `createWorkspaceCardShell(id)` (called
  // once, attaches stable listeners) and `populateWorkspaceCard(item, ws)`
  // (called on every render, refreshes inner contents in place). The
  // top-level `upsertWorkspaceCard(ws)` consults the
  // `workspaceItems` cache and dispatches accordingly. The previous
  // `buildWorkspaceCard(ws)` builder is gone — its body lives in the
  // two helpers above.

  private buildCardHeader(ws: WorkspaceInfo): HTMLElement {
    const header = document.createElement("div");
    header.className = "workspace-card-header";

    const grip = document.createElement("span");
    grip.className = "workspace-grip";
    grip.title = "Drag to reorder";
    grip.setAttribute("aria-hidden", "true");
    grip.append(createIcon("grip", "", 10));
    header.appendChild(grip);

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

    // Pane count badge (only when > 1, keeps 1-pane rows quieter).
    if (ws.surfaceTitles.length > 1) {
      const badge = document.createElement("span");
      badge.className = "workspace-pane-badge";
      badge.title = `${ws.surfaceTitles.length} panes`;
      badge.append(createIcon("pane", "", 10));
      const n = document.createElement("span");
      n.textContent = String(ws.surfaceTitles.length);
      badge.appendChild(n);
      header.appendChild(badge);
    }

    // Plan #10 commit C — pending ask-user pill. Cyan, sits next to
    // the pane-count badge. Tells the user "this workspace has N
    // open agent → user questions" so they know to switch to it.
    const askPending = this.askUserPendingByWorkspace.get(ws.id) ?? 0;
    if (askPending > 0) {
      const pill = document.createElement("span");
      pill.className = "workspace-ask-badge";
      pill.title = `${askPending} pending agent question${askPending === 1 ? "" : "s"}`;
      pill.textContent = `${askPending} ?`;
      header.appendChild(pill);
    }

    // Actions: pin + close (hover-reveal for idle rows; sticky for active/pinned)
    const actions = document.createElement("div");
    actions.className = "workspace-actions";

    const pinBtn = document.createElement("button");
    pinBtn.className = `workspace-pin${this.pinnedIds.has(ws.id) ? " active" : ""}`;
    pinBtn.type = "button";
    pinBtn.title = this.pinnedIds.has(ws.id) ? "Unpin" : "Pin";
    pinBtn.setAttribute(
      "aria-pressed",
      this.pinnedIds.has(ws.id) ? "true" : "false",
    );
    pinBtn.append(createIcon("pin", "", 11));
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.togglePin(ws.id);
    });
    actions.appendChild(pinBtn);

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
    actions.appendChild(closeBtn);

    header.appendChild(actions);
    return header;
  }

  private buildCardMetaRow(ws: WorkspaceInfo): HTMLElement | null {
    const hasCmd = Boolean(ws.focusedSurfaceCommand);
    const hasFallbackTitle =
      !hasCmd && ws.focusedSurfaceTitle && ws.focusedSurfaceTitle !== ws.name;
    const hasPorts = ws.listeningPorts.length > 0;
    if (!hasCmd && !hasFallbackTitle && !hasPorts) return null;

    const row = document.createElement("div");
    row.className = "workspace-meta-row";

    if (hasCmd) {
      const fg = document.createElement("span");
      fg.className = "workspace-meta workspace-meta-fg";
      fg.textContent = ws.focusedSurfaceCommand!;
      fg.title = ws.focusedSurfaceCommand!;
      row.appendChild(fg);
    } else if (hasFallbackTitle) {
      const focused = document.createElement("span");
      focused.className = "workspace-meta";
      focused.textContent = ws.focusedSurfaceTitle!;
      row.appendChild(focused);
    }

    if (hasPorts) {
      const ports = document.createElement("div");
      ports.className = "workspace-ports";
      // Show up to 4 port chips inline; remaining get a "+N" counter.
      const shown = ws.listeningPorts.slice(0, 4);
      for (const port of shown) {
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
        ports.appendChild(chip);
      }
      if (ws.listeningPorts.length > shown.length) {
        const more = document.createElement("span");
        more.className = "workspace-port-more";
        more.textContent = `+${ws.listeningPorts.length - shown.length}`;
        more.title = `${ws.listeningPorts.length - shown.length} more port${
          ws.listeningPorts.length - shown.length === 1 ? "" : "s"
        }: ${ws.listeningPorts.slice(shown.length).join(", ")}`;
        ports.appendChild(more);
      }
      row.appendChild(ports);
    }

    return row;
  }

  private buildCardStatRow(ws: WorkspaceInfo, accent: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "workspace-stat-row";

    // CPU bar — always rendered, tinted with the workspace accent.
    const barWrap = document.createElement("button");
    barWrap.type = "button";
    barWrap.className = "workspace-cpu-bar";
    barWrap.title =
      ws.processCount > 0
        ? `CPU ${ws.cpuPercent.toFixed(1)}% · click for process manager`
        : "No processes";
    barWrap.addEventListener("click", (e) => {
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("ht-open-process-manager", {
          detail: { workspaceId: ws.id },
        }),
      );
    });
    // Fill width = cpu% clamped to 400% (4 cores)
    const capped = Math.min(ws.cpuPercent, 400);
    const pct = Math.min(100, (capped / 100) * 25 + (capped > 100 ? 0 : 0)); // simple mapping
    // Actually: map 0..400 → 0..100% width, but emphasize low values.
    const widthPct = Math.min(100, Math.max(0, (capped / 400) * 100));
    const fill = document.createElement("span");
    fill.className = "workspace-cpu-bar-fill";
    // Phase 4 perf pass: set transform: scaleX(...) instead of width%
    // so the 1 Hz cpu-bar update is GPU-composited rather than
    // layout-triggering. Matches the new CSS rule's transform anim.
    fill.style.transform = `scaleX(${(widthPct / 100).toFixed(3)})`;
    fill.style.background = accent;
    barWrap.appendChild(fill);

    // Sparkline overlay on active card, using accent color.
    if (ws.active && ws.cpuHistory.length > 1) {
      barWrap.appendChild(this.buildSparkline(ws));
      barWrap.classList.add("with-sparkline");
    }

    // Hidden % text that shows on hover.
    const pctText = document.createElement("span");
    pctText.className = "workspace-cpu-bar-label";
    pctText.textContent = `${Math.round(ws.cpuPercent)}%`;
    pctText.setAttribute("aria-hidden", "true");
    barWrap.appendChild(pctText);
    void pct;
    row.appendChild(barWrap);

    // Numeric chips: CPU%, MEM, procs.
    const metrics = document.createElement("div");
    metrics.className = "workspace-metrics";

    const cpu = document.createElement("span");
    cpu.className = "workspace-metric workspace-metric-cpu";
    cpu.textContent = `${Math.round(ws.cpuPercent)}%`;
    cpu.title = `CPU ${ws.cpuPercent.toFixed(1)}%`;
    metrics.appendChild(cpu);

    const sep1 = document.createElement("span");
    sep1.className = "workspace-metric-sep";
    sep1.textContent = "·";
    metrics.appendChild(sep1);

    const mem = document.createElement("span");
    mem.className = "workspace-metric workspace-metric-mem";
    mem.textContent = humanRss(ws.memRssKb);
    mem.title = `Resident ${humanRss(ws.memRssKb)}`;
    metrics.appendChild(mem);

    const sep2 = document.createElement("span");
    sep2.className = "workspace-metric-sep";
    sep2.textContent = "·";
    metrics.appendChild(sep2);

    const procs = document.createElement("span");
    procs.className = "workspace-metric workspace-metric-proc";
    procs.textContent = `${ws.processCount}p`;
    procs.title = `${ws.processCount} process${ws.processCount === 1 ? "" : "es"}`;
    metrics.appendChild(procs);

    row.appendChild(metrics);
    return row;
  }

  private buildSparkline(ws: WorkspaceInfo): SVGSVGElement {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.classList.add("workspace-sparkline");
    svg.setAttribute("viewBox", "0 0 60 10");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("preserveAspectRatio", "none");

    const hist = ws.cpuHistory.length > 0 ? ws.cpuHistory : [0];
    const max = Math.max(100, ...hist);
    const w = 60;
    const h = 10;
    const stride = hist.length > 1 ? w / (hist.length - 1) : w;
    const pts = hist
      .map((v, i) => {
        const x = (i * stride).toFixed(2);
        const y = (h - (Math.min(v, max) / max) * h).toFixed(2);
        return `${x},${y}`;
      })
      .join(" ");

    const fill = document.createElementNS(NS, "polygon");
    fill.setAttribute("points", `0,${h} ${pts} ${w},${h}`);
    fill.setAttribute("fill", "currentColor");
    fill.setAttribute("opacity", "0.28");
    svg.appendChild(fill);

    const poly = document.createElementNS(NS, "polyline");
    poly.setAttribute("points", pts);
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", "currentColor");
    poly.setAttribute("stroke-width", "1");
    poly.setAttribute("stroke-linejoin", "round");
    poly.setAttribute("stroke-linecap", "round");
    svg.appendChild(poly);

    svg.setAttribute(
      "aria-label",
      `CPU ${Math.round(ws.cpuPercent)}% across ${ws.processCount} process${ws.processCount === 1 ? "" : "es"}`,
    );
    return svg;
  }

  private buildCwdRow(ws: WorkspaceInfo): HTMLElement {
    const row = document.createElement("div");
    row.className = "workspace-cwds";
    const label = document.createElement("span");
    label.className = "workspace-cwds-label";
    label.textContent = "CWD";
    row.appendChild(label);
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
      row.appendChild(chip);
    }
    return row;
  }

  private buildPanesList(ws: WorkspaceInfo): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "workspace-surfaces";
    const MAX = 10;
    for (const t of ws.surfaceTitles.slice(0, MAX)) {
      const line = document.createElement("span");
      line.className = "workspace-surface-line";
      line.textContent = t;
      line.title = t;
      wrap.appendChild(line);
    }
    if (ws.surfaceTitles.length > MAX) {
      const more = document.createElement("span");
      more.className = "workspace-surface-line workspace-surface-more";
      more.textContent = `+${ws.surfaceTitles.length - MAX} more`;
      wrap.appendChild(more);
    }
    return wrap;
  }

  private buildManifestsBlock(ws: WorkspaceInfo): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "workspace-manifests";
    if (ws.packageJson) {
      wrap.appendChild(this.renderPackageManifestCard(ws, ws.packageJson));
    }
    if (ws.cargoToml) {
      wrap.appendChild(this.renderCargoManifestCard(ws, ws.cargoToml));
    }
    return wrap;
  }

  private buildStatusGrid(ws: WorkspaceInfo): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "workspace-status";
    for (const pill of ws.statusPills) {
      const parsed = parseStatusKey(pill.key);
      // Hidden flag (leading `_`) opts the entry out of the sidebar
      // workspace card while keeping it available to the bottom
      // status bar. Lets scripts publish private metrics without
      // crowding the card.
      if (parsed.hidden) continue;

      const entry = document.createElement("div");
      entry.className = `status-entry status-entry-${parsed.layout}`;

      // Block-layout renderers (lineGraph, array, longtext) handle
      // their own label + body, so we render them whole. Inline
      // renderers slot inside the existing two-row chrome
      // (label row + value row) to match the established density.
      if (parsed.layout === "block") {
        entry.appendChild(
          renderStatusEntry({
            parsed,
            value: pill.value,
            color: pill.color,
            icon: pill.icon,
            context: "card",
          }),
        );
      } else {
        const keyLine = document.createElement("div");
        keyLine.className = "status-entry-key";
        if (pill.icon && pill.icon in ICON_TEMPLATES) {
          keyLine.append(createIcon(pill.icon as IconName, "", 10));
        }
        const keyText = document.createElement("span");
        keyText.textContent = parsed.displayName;
        keyLine.appendChild(keyText);
        entry.appendChild(keyLine);

        const valueLine = document.createElement("div");
        valueLine.className = "status-entry-value";
        valueLine.title = `${pill.key}: ${pill.value}`;
        valueLine.appendChild(
          renderStatusEntry({
            parsed,
            value: pill.value,
            color: pill.color,
            icon: pill.icon,
            context: "card",
          }),
        );
        entry.appendChild(valueLine);
      }

      wrap.appendChild(entry);
    }
    return wrap;
  }

  private buildProgressBar(ws: WorkspaceInfo): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "workspace-progress";
    const fill = document.createElement("div");
    fill.className = "progress-fill";
    // Phase 4 perf pass: transform: scaleX(0..1) instead of width%
    // for GPU-composited progress animation (was width-anim before).
    const progressV = Math.max(0, Math.min(1, ws.progress?.value ?? 0));
    fill.style.transform = `scaleX(${progressV.toFixed(3)})`;
    wrap.appendChild(fill);

    const label = document.createElement("span");
    label.className = "progress-inline-label";
    const labelText = ws.progress?.label || "Progress";
    label.textContent = `${labelText} ${Math.round((ws.progress?.value ?? 0) * 100)}%`;
    wrap.appendChild(label);

    return wrap;
  }

  // ── Collapsible sub-section ────────────────────────────────────────

  private buildCollapseSection(opts: {
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

  // ── Rename ─────────────────────────────────────────────────────────

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
    const ws = this.workspaces.find((w) => w.id === id);
    if (ws) ws.name = trimmed;
    this.renderWorkspaces();
  }

  private cancelRename(): void {
    this.renamingId = null;
    this.renderWorkspaces();
  }

  // ── Pin / filter / reorder ─────────────────────────────────────────

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
    // Phase 3 perf pass: drop section caches for workspaces that
    // disappeared so we don't keep references to detached DOM
    // elements forever.
    for (const id of [...this.cardSlots.keys()]) {
      if (!alive.has(id)) this.cardSlots.delete(id);
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

  // ── Section open/close ─────────────────────────────────────────────

  private toggleAllSections(open: boolean): void {
    for (const st of this.uiState.values()) {
      st.manifestsOpen = open;
      st.panesOpen = open;
      st.statusOpen = open;
    }
    this.sectionOpen.notifications = open;
    this.sectionOpen.logs = open;
    saveJson(LS_SECTIONS, this.sectionOpen);
    this.persistUiState();
    this.applySectionOpenClasses();
    this.renderWorkspaces();
    this.renderNotifications();
    this.renderLogs();
  }

  private applySectionOpenClasses(): void {
    this.notificationsEl.classList.toggle(
      "closed",
      !this.sectionOpen.notifications,
    );
    this.logsEl.classList.toggle("closed", !this.sectionOpen.logs);
  }

  // ──────────────────────────────────────────────────────────────────
  // Notifications (incremental DOM preserved — tests depend on it)
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

    // Contract: tests match the regex /Notifications \(N\)/.
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

    if (!this.sectionOpen.notifications) {
      this.notificationListEl.innerHTML = "";
      this.notificationItemEls.clear();
      return;
    }

    const visible = notifications.slice(-6).reverse();
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
    title.append(createIcon("bell", "", 11));
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
      this.notificationItemEls.clear();
      if (this.notificationListEl) this.notificationListEl.innerHTML = "";
      this.renderNotifications();
    });

    header.appendChild(toggle);

    const clearBtn = document.createElement("button");
    clearBtn.className = "sidebar-section-clear";
    clearBtn.title = "Clear notifications";
    clearBtn.setAttribute("aria-label", "Clear notifications");
    clearBtn.append(createIcon("close", "", 11));
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

  private refreshNotificationTimes(): void {
    for (const [, el] of this.notificationItemEls) {
      const t = el.querySelector(".notification-time");
      if (!t) continue;
      // We stamped title with the absolute time; relative is derived from the
      // DOM we built earlier so re-read from notifications array.
      // The expected cost is minor; just re-run relativeTime on each.
      const titleAttr = (t as HTMLElement).title;
      const d = titleAttr ? new Date(titleAttr) : null;
      if (d && !isNaN(d.getTime())) {
        t.textContent = relativeTime(d.getTime());
      }
    }
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

    const header = document.createElement("div");
    header.className = "sidebar-section-header";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sidebar-section-toggle";
    toggle.setAttribute(
      "aria-expanded",
      this.sectionOpen.logs ? "true" : "false",
    );

    const caret = document.createElement("span");
    caret.className = "sidebar-section-caret";
    caret.append(
      createIcon(
        this.sectionOpen.logs ? "chevronDown" : "chevronRight",
        "",
        10,
      ),
    );
    toggle.appendChild(caret);

    const title = document.createElement("span");
    title.className = "sidebar-section-title";
    title.append(createIcon("logs", "", 11));
    const countEl = document.createElement("span");
    countEl.textContent = `Logs (${logs.length}${unread ? ` · ${unread}!` : ""})`;
    title.append(countEl);
    toggle.appendChild(title);
    header.appendChild(toggle);

    const clearBtn = document.createElement("button");
    clearBtn.className = "sidebar-section-clear";
    clearBtn.title = "Clear logs";
    clearBtn.type = "button";
    clearBtn.setAttribute("aria-label", "Clear logs");
    clearBtn.append(createIcon("close", "", 11));
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent("ht-clear-logs"));
    });
    header.appendChild(clearBtn);

    toggle.addEventListener("click", () => {
      this.sectionOpen.logs = !this.sectionOpen.logs;
      saveJson(LS_SECTIONS, this.sectionOpen);
      this.applySectionOpenClasses();
      this.renderLogs();
    });

    this.logsEl.appendChild(header);

    if (!this.sectionOpen.logs) return;

    const list = document.createElement("div");
    list.className = "sidebar-section-list";
    this.logsEl.appendChild(list);

    const scroller = this.container;
    const wasNearBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;

    let lastItem: HTMLDivElement | null = null;
    for (const log of logs.slice(-12)) {
      const el = document.createElement("div");
      el.className = `log-item ${log.level}`;
      const levelTag = document.createElement("span");
      levelTag.className = "log-level";
      levelTag.textContent = log.level.toUpperCase().slice(0, 4);
      el.appendChild(levelTag);
      if (log.source) {
        const srcTag = document.createElement("span");
        srcTag.className = "log-source";
        srcTag.textContent = log.source;
        el.appendChild(srcTag);
      }
      const msg = document.createElement("span");
      msg.className = "log-message";
      msg.textContent = log.message;
      el.appendChild(msg);
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

    const tgRow = document.createElement("div");
    tgRow.className = "sidebar-server-pill";
    this.telegramDotEl = document.createElement("div");
    this.telegramDotEl.className = "sidebar-server-dot offline";
    tgRow.appendChild(this.telegramDotEl);
    tgRow.append(createIcon("messageCircle", "sidebar-server-icon", 11));
    this.telegramLabelEl = document.createElement("span");
    this.telegramLabelEl.className = "sidebar-server-label";
    this.telegramLabelEl.textContent = "Telegram";
    tgRow.appendChild(this.telegramLabelEl);
    this.telegramValueEl = document.createElement("span");
    this.telegramValueEl.className = "sidebar-server-url";
    this.telegramValueEl.textContent = "Disabled";
    tgRow.appendChild(this.telegramValueEl);
    tgRow.title = "Telegram — disabled";

    const wmRow = document.createElement("div");
    wmRow.className = "sidebar-server-pill";
    this.serverDotEl = document.createElement("div");
    this.serverDotEl.className = "sidebar-server-dot offline";
    wmRow.appendChild(this.serverDotEl);
    wmRow.append(createIcon("globe", "sidebar-server-icon", 11));
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
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (
          e.target instanceof HTMLInputElement &&
          e.target !== this.searchInputEl
        )
          return;
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
  // Manifest card adapters
  // ──────────────────────────────────────────────────────────────────

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
  if (kb < 1024) return `${Math.round(kb)}K`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}M`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)}G`;
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
