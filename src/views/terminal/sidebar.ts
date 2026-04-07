import type { WorkspaceContextMenuRequest } from "../../shared/types";
import { ICON_TEMPLATES, createIcon, type IconName } from "./icons";

export interface WorkspaceInfo {
  id: string;
  name: string;
  color?: string;
  active: boolean;
  paneCount: number;
  surfaceTitles: string[];
  focusedSurfaceTitle?: string | null;
  statusPills: { key: string; value: string; color?: string; icon?: string }[];
  progress: { value: number; label?: string } | null;
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
  private callbacks: SidebarCallbacks;
  private visible = true;

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

    this.listEl = document.createElement("div");
    this.listEl.className = "sidebar-workspaces";
    container.appendChild(this.listEl);

    this.notificationsEl = document.createElement("div");
    this.notificationsEl.className = "sidebar-notifications";
    container.appendChild(this.notificationsEl);

    this.logsEl = document.createElement("div");
    this.logsEl.className = "sidebar-logs";
    container.appendChild(this.logsEl);
  }

  setWorkspaces(workspaces: WorkspaceInfo[]): void {
    this.listEl.innerHTML = "";

    if (workspaces.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sidebar-empty";
      empty.textContent = "No workspaces yet";
      this.listEl.appendChild(empty);
      return;
    }

    for (const [index, ws] of workspaces.entries()) {
      const item = document.createElement("div");
      item.className = `workspace-item${ws.active ? " active" : ""}`;
      item.dataset["workspaceId"] = ws.id;
      item.style.setProperty("--workspace-accent", ws.color || "#89b4fa");

      const header = document.createElement("div");
      header.className = "workspace-card-header";

      const railIcon = document.createElement("div");
      railIcon.className = "workspace-rail-icon";
      railIcon.append(createIcon(ws.active ? "terminal" : "pane", "", 14));
      header.appendChild(railIcon);

      const identity = document.createElement("div");
      identity.className = "workspace-identity";

      const dot = document.createElement("div");
      dot.className = "workspace-dot";
      dot.style.background = ws.color || "#89b4fa";
      identity.appendChild(dot);

      const indexBadge = document.createElement("span");
      indexBadge.className = "workspace-index";
      indexBadge.textContent = String(index + 1).padStart(2, "0");
      identity.appendChild(indexBadge);

      const titleWrap = document.createElement("div");
      titleWrap.className = "workspace-title-wrap";

      const name = document.createElement("span");
      name.className = "workspace-name";
      name.textContent = ws.name;
      titleWrap.appendChild(name);

      const meta = document.createElement("div");
      meta.className = "workspace-meta";
      meta.textContent =
        ws.focusedSurfaceTitle && ws.focusedSurfaceTitle !== ws.name
          ? `Focused on ${ws.focusedSurfaceTitle}`
          : `${ws.paneCount} pane${ws.paneCount > 1 ? "s" : ""}`;
      titleWrap.appendChild(meta);

      identity.appendChild(titleWrap);
      header.appendChild(identity);

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
      header.appendChild(closeBtn);
      item.appendChild(header);

      const badges = document.createElement("div");
      badges.className = "workspace-badges";

      const stateBadge = document.createElement("span");
      stateBadge.className = `workspace-badge ${ws.active ? "active" : "idle"}`;
      stateBadge.append(createIcon(ws.active ? "sparkles" : "moon", "", 12));
      stateBadge.append(ws.active ? "Active" : "Standby");
      badges.appendChild(stateBadge);

      const paneBadge = document.createElement("span");
      paneBadge.className = "workspace-badge";
      paneBadge.append(createIcon("pane", "", 12));
      paneBadge.append(`${ws.paneCount} pane${ws.paneCount > 1 ? "s" : ""}`);
      badges.appendChild(paneBadge);

      item.appendChild(badges);

      if (ws.surfaceTitles.length > 0) {
        const surfaces = document.createElement("div");
        surfaces.className = "workspace-surfaces";
        for (const title of ws.surfaceTitles.slice(0, 4)) {
          const chip = document.createElement("span");
          chip.className = "workspace-surface-chip";
          chip.textContent = title;
          surfaces.appendChild(chip);
        }
        item.appendChild(surfaces);
      }

      if (ws.statusPills.length > 0) {
        const statusContainer = document.createElement("div");
        statusContainer.className = "workspace-status";
        for (const pill of ws.statusPills) {
          const pillEl = document.createElement("span");
          pillEl.className = "status-pill";
          if (pill.icon && pill.icon in ICON_TEMPLATES) {
            pillEl.append(createIcon(pill.icon as IconName, "", 11));
          }
          const text = document.createElement("span");
          text.textContent = `${pill.key}: ${pill.value}`;
          pillEl.appendChild(text);
          if (pill.color) pillEl.style.color = pill.color;
          statusContainer.appendChild(pillEl);
        }
        item.appendChild(statusContainer);
      }

      if (ws.progress) {
        const progressMeta = document.createElement("div");
        progressMeta.className = "workspace-progress-meta";

        const label = document.createElement("span");
        label.className = "progress-label";
        label.textContent = ws.progress.label || "Progress";
        progressMeta.appendChild(label);

        const value = document.createElement("span");
        value.className = "progress-value";
        value.textContent = `${Math.round(ws.progress.value * 100)}%`;
        progressMeta.appendChild(value);

        item.appendChild(progressMeta);

        const progressWrap = document.createElement("div");
        progressWrap.className = "workspace-progress";
        const fill = document.createElement("div");
        fill.className = "progress-fill";
        fill.style.width = `${Math.round(ws.progress.value * 100)}%`;
        progressWrap.appendChild(fill);
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
    this.notificationsEl.innerHTML = "";
    if (notifications.length === 0) return;

    const header = document.createElement("div");
    header.className = "sidebar-section-header";
    const title = document.createElement("span");
    title.className = "sidebar-section-title";
    title.append(createIcon("bell", "", 12));
    title.append(`Notifications (${notifications.length})`);
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

    const list = document.createElement("div");
    list.className = "sidebar-section-list";
    this.notificationsEl.appendChild(list);

    for (const n of notifications.slice(-5).reverse()) {
      const el = document.createElement("div");
      el.className = "notification-item";
      const titleEl = document.createElement("div");
      titleEl.className = "notification-title";
      titleEl.textContent = n.title;
      el.appendChild(titleEl);
      if (n.body) {
        const body = document.createElement("div");
        body.className = "notification-body";
        body.textContent = n.body;
        el.appendChild(body);
      }
      const time = document.createElement("div");
      time.className = "notification-time";
      time.textContent = new Date(n.time).toLocaleTimeString();
      el.appendChild(time);
      list.appendChild(el);
    }
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

    for (const log of logs.slice(-10)) {
      const el = document.createElement("div");
      el.className = `log-item ${log.level}`;
      const prefix = log.source ? `[${log.source}] ` : "";
      el.textContent = `${prefix}${log.message}`;
      list.appendChild(el);
    }
  }
}
