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
  /** Nearest Cargo.toml for this workspace's surfaces (or null). Shown
   *  as a second manifest card; projects with both (wasm-pack, Tauri)
   *  render both cards independently. */
  cargoToml: CargoInfo | null;
  /** Cargo subcommands currently running in the process tree
   *  ("build", "test", "clippy"). */
  runningCargoActions: string[];
  /** Cargo subcommands whose most recent run exited non-zero. */
  erroredCargoActions: string[];
  /** Distinct cwds across all surfaces in this workspace, in stable order. */
  cwds: string[];
  /** The cwd currently driving the package.json card — user-selectable when
   *  `cwds.length > 1`, defaults to the focused surface's cwd. */
  selectedCwd: string | null;
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

export class Sidebar {
  private container: HTMLElement;
  private listEl: HTMLElement;
  private notificationsEl: HTMLElement;
  private logsEl: HTMLElement;
  private footerEl: HTMLElement;
  private telegramDotEl: HTMLElement;
  private telegramLabelEl: HTMLElement;
  private serverDotEl: HTMLElement;
  private serverLabelEl: HTMLElement;
  private serverUrlEl: HTMLElement;
  private callbacks: SidebarCallbacks;
  private visible = true;
  /** Manifest cards whose body is currently expanded. Keys are
   *  `"<workspaceId>:<kind>"` so the npm and cargo cards of the same
   *  workspace can expand / collapse independently. */
  private expandedPackages: Set<string> = new Set();
  /** Most recent workspace list; kept so client-only UI toggles
   *  (e.g. package-card expand) can rerender without a fresh feed. */
  private workspaces: WorkspaceInfo[] = [];
  /** Most recent notification list; kept so `acknowledgeBySurface` can
   *  reason about which notifications share the focused surface. */
  private notifications: NotificationInfo[] = [];
  /** Notification ids the user has acted on — click, dismiss, or the
   *  source surface gained focus. Glow suppresses while acknowledged. */
  private acknowledgedNotifications: Set<string> = new Set();
  /** Diffable handles for the notification section — kept across renders
   *  so that rows already in the DOM are reused instead of rebuilt.
   *  Tearing them down and re-creating would restart the CSS glow
   *  animation on every rerender; that made unrelated state changes
   *  (e.g. a second notification arriving) visibly flicker the first
   *  one's pulse back to frame zero. */
  private notificationListEl: HTMLElement | null = null;
  private notificationCountEl: HTMLElement | null = null;
  private notificationItemEls: Map<string, HTMLElement> = new Map();
  /** Drag handle pinned to the sidebar's right edge. Owned here so the
   *  SurfaceManager can attach the resize behavior after construction
   *  (it needs to thread live/commit callbacks into the relayout + RPC
   *  pipelines). */
  private resizeHandleEl: HTMLElement;

  constructor(container: HTMLElement, callbacks: SidebarCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    const header = document.createElement("div");
    header.className = "sidebar-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "sidebar-header-copy";

    const title = document.createElement("span");
    title.className = "sidebar-title";
    title.append(createIcon("workspace", "sidebar-title-icon", 12));
    title.append("Workspaces");
    titleWrap.appendChild(title);

    const subtitle = document.createElement("span");
    subtitle.className = "sidebar-subtitle";
    subtitle.textContent = "Navigation, context and live activity";
    titleWrap.appendChild(subtitle);

    header.appendChild(titleWrap);

    const newBtn = document.createElement("button");
    newBtn.className = "sidebar-new-btn";
    newBtn.title = "New workspace";
    newBtn.setAttribute("aria-label", "New workspace");
    newBtn.append(createIcon("plus"));
    newBtn.addEventListener("click", () => callbacks.onNewWorkspace());
    header.appendChild(newBtn);

    container.appendChild(header);

    // Notifications render above the workspace list so urgent signals are
    // immediately visible without scrolling.
    this.notificationsEl = document.createElement("div");
    this.notificationsEl.className = "sidebar-notifications";
    container.appendChild(this.notificationsEl);

    this.listEl = document.createElement("div");
    this.listEl.className = "sidebar-workspaces";
    container.appendChild(this.listEl);

    this.logsEl = document.createElement("div");
    this.logsEl.className = "sidebar-logs";
    container.appendChild(this.logsEl);

    // Server status footer — always at bottom
    this.footerEl = document.createElement("div");
    this.footerEl.className = "sidebar-footer";

    const serverRow = document.createElement("div");
    serverRow.className = "sidebar-server-row";

    // Telegram status pill — sits left of the Web Mirror indicator.
    // Populated by setTelegramStatus() whenever a `telegramState`
    // message arrives from bun. Shows a colored dot + "Telegram"
    // label and surfaces detailed status (state, bot username,
    // error) via the `title` tooltip.
    const telegramPill = document.createElement("div");
    telegramPill.className = "sidebar-server-pill";

    this.telegramDotEl = document.createElement("div");
    this.telegramDotEl.className = "sidebar-server-dot offline";

    this.telegramLabelEl = document.createElement("span");
    this.telegramLabelEl.className = "sidebar-server-label";
    this.telegramLabelEl.textContent = "Telegram";

    telegramPill.appendChild(this.telegramDotEl);
    telegramPill.appendChild(this.telegramLabelEl);
    telegramPill.title = "Telegram — disabled";
    serverRow.appendChild(telegramPill);

    this.serverDotEl = document.createElement("div");
    this.serverDotEl.className = "sidebar-server-dot offline";

    this.serverLabelEl = document.createElement("span");
    this.serverLabelEl.className = "sidebar-server-label";
    this.serverLabelEl.textContent = "Web Mirror";

    this.serverUrlEl = document.createElement("span");
    this.serverUrlEl.className = "sidebar-server-url";
    this.serverUrlEl.textContent = "Offline";

    serverRow.appendChild(this.serverDotEl);
    serverRow.appendChild(this.serverLabelEl);
    serverRow.appendChild(this.serverUrlEl);
    this.footerEl.appendChild(serverRow);
    container.appendChild(this.footerEl);

    // Drag-to-resize handle. Pinned to the right edge of the sidebar,
    // outside the scroll region so it stays hittable regardless of how
    // far the workspace list is scrolled. `tabIndex=0` exposes it to
    // keyboard users; the shared behavior module wires ArrowLeft /
    // ArrowRight / Home / End for fine adjustment.
    this.resizeHandleEl = document.createElement("div");
    this.resizeHandleEl.className = "sidebar-resize-handle";
    this.resizeHandleEl.setAttribute("role", "separator");
    this.resizeHandleEl.setAttribute("aria-orientation", "vertical");
    this.resizeHandleEl.setAttribute("aria-label", "Resize sidebar");
    this.resizeHandleEl.tabIndex = 0;
    this.resizeHandleEl.title = "Drag to resize · double-click to reset";
    container.appendChild(this.resizeHandleEl);
  }

  /** Exposed so the owning SurfaceManager can attach the shared
   *  `attachSidebarResize` behavior — it's the layer that knows how to
   *  relayout xterms and persist the final width via RPC. */
  getResizeHandle(): HTMLElement {
    return this.resizeHandleEl;
  }

  setWorkspaces(workspaces: WorkspaceInfo[]): void {
    this.workspaces = workspaces;
    this.renderWorkspaces();
  }

  private renderWorkspaces(): void {
    const workspaces = this.workspaces;
    this.listEl.innerHTML = "";

    if (workspaces.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sidebar-empty";
      empty.textContent = "No workspaces yet";
      this.listEl.appendChild(empty);
      return;
    }

    for (const ws of workspaces) {
      const item = document.createElement("div");
      item.className = `workspace-item${ws.active ? " active" : ""}`;
      item.dataset["workspaceId"] = ws.id;
      item.style.setProperty("--workspace-accent", ws.color || "#89b4fa");

      // ── Row 1: header ──
      const header = document.createElement("div");
      header.className = "workspace-card-header";

      const dot = document.createElement("div");
      dot.className = "workspace-dot";
      dot.style.background = ws.color || "#89b4fa";
      header.appendChild(dot);

      const name = document.createElement("span");
      name.className = "workspace-name";
      name.textContent = ws.name;
      header.appendChild(name);

      const headerRight = document.createElement("div");
      headerRight.className = "workspace-header-right";

      const closeBtn = document.createElement("button");
      closeBtn.className = "workspace-close";
      closeBtn.type = "button";
      closeBtn.title = "Close workspace";
      closeBtn.setAttribute("aria-label", "Close workspace");
      closeBtn.append(createIcon("close"));
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.callbacks.onCloseWorkspace(ws.id);
      });
      headerRight.appendChild(closeBtn);
      header.appendChild(headerRight);
      item.appendChild(header);

      // ── Row 2: meta (only if active or has useful info) ──
      const hasExtra =
        ws.surfaceTitles.length > 1 ||
        ws.statusPills.length > 0 ||
        ws.progress !== null;

      if (ws.active || hasExtra) {
        const meta = document.createElement("div");
        meta.className = "workspace-meta-row";

        if (ws.focusedSurfaceCommand) {
          const fg = document.createElement("span");
          fg.className = "workspace-meta workspace-meta-fg";
          fg.textContent = ws.focusedSurfaceCommand;
          fg.title = ws.focusedSurfaceCommand;
          meta.appendChild(fg);
        } else if (
          ws.focusedSurfaceTitle &&
          ws.focusedSurfaceTitle !== ws.name
        ) {
          const focused = document.createElement("span");
          focused.className = "workspace-meta";
          focused.textContent = ws.focusedSurfaceTitle;
          meta.appendChild(focused);
        }

        if (meta.childElementCount > 0) item.appendChild(meta);
      }

      // Surface titles as flat one-line labels (no bubble).
      if (ws.surfaceTitles.length > 1) {
        const surfaces = document.createElement("div");
        surfaces.className = "workspace-surfaces";
        for (const title of ws.surfaceTitles.slice(0, 4)) {
          const line = document.createElement("span");
          line.className = "workspace-surface-line";
          line.textContent = title;
          line.title = title;
          surfaces.appendChild(line);
        }
        if (ws.surfaceTitles.length > 4) {
          const more = document.createElement("span");
          more.className = "workspace-surface-line workspace-surface-more";
          more.textContent = `+${ws.surfaceTitles.length - 4} more`;
          surfaces.appendChild(more);
        }
        item.appendChild(surfaces);
      }

      // ── Row 2b: listening ports (compact, clickable) ──
      if (ws.listeningPorts.length > 0) {
        const portsContainer = document.createElement("div");
        portsContainer.className = "workspace-ports";
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
          portsContainer.appendChild(chip);
        }
        item.appendChild(portsContainer);
      }

      // ── Row 2b2: multi-cwd selector (only when >1 distinct cwd) ──
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

      // ── Row 2c: manifest cards + action runners (collapsible) ──
      // A workspace can surface both a package.json and a Cargo.toml
      // (wasm-pack, Tauri, napi-rs); we render them independently so
      // the user can collapse either while keeping the other open.
      if (ws.packageJson) {
        item.appendChild(this.renderPackageManifestCard(ws, ws.packageJson));
      }
      if (ws.cargoToml) {
        item.appendChild(this.renderCargoManifestCard(ws, ws.cargoToml));
      }

      // ── Row 3: status entries (icon+key on top line, value on line below) ──
      if (ws.statusPills.length > 0) {
        const statusContainer = document.createElement("div");
        statusContainer.className = "workspace-status";
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

          statusContainer.appendChild(entry);
        }
        item.appendChild(statusContainer);
      }

      // ── Row 4: progress bar (minimal) ──
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
        window.dispatchEvent(
          new CustomEvent("ht-open-context-menu", {
            detail,
          }),
        );
      });

      this.listEl.appendChild(item);
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
    // Prune the acknowledged set of ids that are no longer present —
    // otherwise reusing an id later would silently suppress its glow.
    const alive = new Set(notifications.map((n) => n.id));
    for (const id of [...this.acknowledgedNotifications]) {
      if (!alive.has(id)) this.acknowledgedNotifications.delete(id);
    }
    this.renderNotifications();
  }

  /** Mark every notification emitted by `surfaceId` as acknowledged —
   *  called when that surface gains focus, which is the user's implicit
   *  "I've seen it" signal. Stops the glow without removing the items. */
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

  private renderNotifications(): void {
    const notifications = this.notifications;

    // Empty → tear the whole section down and drop our caches so the
    // next render rebuilds a fresh shell.
    if (notifications.length === 0) {
      this.notificationsEl.innerHTML = "";
      this.notificationListEl = null;
      this.notificationCountEl = null;
      this.notificationItemEls.clear();
      return;
    }

    // Build the persistent shell (header + list container) on first
    // use. Subsequent renders reuse these nodes — the header count gets
    // updated in place, and each row is inserted/updated/removed
    // individually so CSS animations on unchanged rows keep running.
    if (!this.notificationListEl || !this.notificationCountEl) {
      this.notificationsEl.innerHTML = "";
      const { listEl, countEl } = this.buildNotificationShell();
      this.notificationListEl = listEl;
      this.notificationCountEl = countEl;
    }

    this.notificationCountEl.textContent = `Notifications (${notifications.length})`;

    // Visible subset: newest 5, reversed so the top of the list is the
    // most recent. Ids never change once assigned, so a simple
    // map lookup is enough to reuse an existing row.
    const visible = notifications.slice(-5).reverse();
    const visibleIds = new Set(visible.map((n) => n.id));

    // Drop rows that fell out of the visible window.
    for (const [id, el] of [...this.notificationItemEls]) {
      if (!visibleIds.has(id)) {
        el.remove();
        this.notificationItemEls.delete(id);
      }
    }

    // Walk the desired order. `cursor` tracks the DOM node that the
    // next still-existing item should sit before. New rows are
    // prepended (inserted before `cursor`) so the most recent appears
    // at the top; the cursor does not advance past them. Existing rows
    // stay put — we only advance past them. Since the display order is
    // strictly chronological (newer before older) and ids never change,
    // this never produces reorderings.
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
    const title = document.createElement("span");
    title.className = "sidebar-section-title";
    title.append(createIcon("bell", "", 12));
    const countEl = document.createElement("span");
    title.append(countEl);
    header.appendChild(title);

    const clearBtn = document.createElement("button");
    clearBtn.className = "sidebar-section-clear";
    clearBtn.title = "Clear notifications";
    clearBtn.setAttribute("aria-label", "Clear notifications");
    clearBtn.append(createIcon("close", "", 12));
    clearBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("ht-clear-notifications"));
    });
    header.appendChild(clearBtn);
    this.notificationsEl.appendChild(header);

    const listEl = document.createElement("div");
    listEl.className = "sidebar-section-list";
    this.notificationsEl.appendChild(listEl);

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
    time.textContent = new Date(n.time).toLocaleTimeString();
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
    // Glow state is the only thing that can change for an existing row
    // (notifications themselves are immutable once created — the id
    // namespace is unique per create). Toggling the class instead of
    // rebuilding the node keeps the CSS animation running smoothly.
    const shouldGlow = !this.acknowledgedNotifications.has(n.id);
    el.classList.toggle("glow", shouldGlow);
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

  /** Paint the Telegram status pill in the sidebar footer. `polling`
   *  reuses the shared `.online` green so the eye groups it with the
   *  web-mirror dot; `starting` / `error` get dedicated tints so the
   *  user can tell at a glance whether the bot is warming up or
   *  something went wrong. The `title` tooltip carries the full detail
   *  (state + `@botname` when available + any error message). */
  setTelegramStatus(status: TelegramStatusWire): void {
    const dot = this.telegramDotEl;
    dot.classList.remove("online", "offline", "starting", "error", "conflict");
    switch (status.state) {
      case "polling":
        dot.classList.add("online");
        break;
      case "starting":
        dot.classList.add("starting");
        break;
      case "conflict":
        dot.classList.add("conflict");
        break;
      case "error":
        dot.classList.add("error");
        break;
      case "disabled":
      default:
        dot.classList.add("offline");
        break;
    }
    const parts = [`Telegram — ${status.state}`];
    if (status.botUsername) parts.push(`@${status.botUsername}`);
    if (status.error) parts.push(status.error);
    const title = parts.join(" · ");
    dot.title = title;
    this.telegramLabelEl.title = title;
    const pill = dot.parentElement;
    if (pill) pill.title = title;
  }

  setLogs(logs: LogEntry[]): void {
    this.logsEl.innerHTML = "";
    if (logs.length === 0) return;

    const header = document.createElement("div");
    header.className = "sidebar-section-header";
    const title = document.createElement("span");
    title.className = "sidebar-section-title";
    title.append(createIcon("activity", "", 12));
    title.append("Logs");
    header.appendChild(title);
    const clearBtn = document.createElement("button");
    clearBtn.className = "sidebar-section-clear";
    clearBtn.title = "Clear logs";
    clearBtn.setAttribute("aria-label", "Clear logs");
    clearBtn.append(createIcon("close", "", 12));
    clearBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("ht-clear-logs"));
    });
    header.appendChild(clearBtn);
    this.logsEl.appendChild(header);

    const list = document.createElement("div");
    list.className = "sidebar-section-list";
    this.logsEl.appendChild(list);

    // Only auto-scroll if the user was already at (or very near) the
    // bottom before this render. If they've scrolled up to read older
    // entries, respect that — auto-scrolling mid-read would yank them
    // back and make older logs unreadable during a flood.
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

  /** Adapt a WorkspaceInfo + PackageInfo into ManifestCardProps and
   *  render via the shared card. Toggle-state key is namespaced so
   *  the npm and cargo cards of the same workspace don't collide. */
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

  /** Adapt a WorkspaceInfo + CargoInfo into ManifestCardProps. Cargo
   *  has no declared scripts, so we surface a fixed set of common
   *  subcommands. Per-binary `run` variants are added when the
   *  manifest declares `[[bin]]` targets or an implicit default.
   *  Each action's `scriptKey` is prefixed `cargo:` to match the
   *  errored-actions bookkeeping in sidebar-state.ts. */
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

    // Extra per-binary run actions for multi-bin crates. Skipped on a
    // virtual workspace manifest (no [[bin]]).
    if (!cargo.isWorkspace && cargo.binaries.length > 1) {
      for (const bin of cargo.binaries) {
        actions.push({
          key: `${ws.id}:cargo:run-bin-${bin}`,
          label: `run ${bin}`,
          command: `cargo run --bin ${bin}`,
          // Running-detection for per-bin variants is too noisy to
          // match (process tree just shows `cargo run --bin X`, which
          // our extractor collapses to `run`); leave as idle and let
          // the generic "run" row flash green.
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

/** Last two path segments (or full path if short); used by the cwd chip. */
function shortCwd(cwd: string): string {
  if (!cwd) return "";
  const parts = cwd.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length <= 2) {
    return cwd.startsWith("/") ? "/" + parts.join("/") : parts.join("/");
  }
  return "\u2026/" + parts.slice(-2).join("/");
}


// renderPackageCard removed — both npm and cargo cards now render via
// `renderManifestCard` in ./sidebar-manifest-card.ts.
