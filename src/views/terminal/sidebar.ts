import type {
  PackageInfo,
  WorkspaceContextMenuRequest,
} from "../../shared/types";
import { ICON_TEMPLATES, createIcon, type IconName } from "./icons";

export interface WorkspaceInfo {
  id: string;
  name: string;
  color?: string;
  active: boolean;
  paneCount: number;
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
  private serverDotEl: HTMLElement;
  private serverLabelEl: HTMLElement;
  private serverUrlEl: HTMLElement;
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

    // Server status footer — always at bottom
    this.footerEl = document.createElement("div");
    this.footerEl.className = "sidebar-footer";

    const serverRow = document.createElement("div");
    serverRow.className = "sidebar-server-row";

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

      const indexBadge = document.createElement("span");
      indexBadge.className = "workspace-index";
      indexBadge.textContent = String(index + 1).padStart(2, "0");
      header.appendChild(indexBadge);

      const headerRight = document.createElement("div");
      headerRight.className = "workspace-header-right";

      if (ws.paneCount > 1) {
        const paneBadge = document.createElement("span");
        paneBadge.className = "workspace-pane-count";
        paneBadge.textContent = String(ws.paneCount);
        headerRight.appendChild(paneBadge);
      }

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

        // Inline surface chips (only if >1 pane)
        if (ws.surfaceTitles.length > 1) {
          for (const title of ws.surfaceTitles.slice(0, 3)) {
            const chip = document.createElement("span");
            chip.className = "workspace-surface-chip";
            chip.textContent = title;
            meta.appendChild(chip);
          }
          if (ws.surfaceTitles.length > 3) {
            const more = document.createElement("span");
            more.className = "workspace-surface-chip workspace-chip-more";
            more.textContent = `+${ws.surfaceTitles.length - 3}`;
            meta.appendChild(more);
          }
        }

        if (meta.childElementCount > 0) item.appendChild(meta);
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

      // ── Row 2c: package.json card + script runners ──
      if (ws.packageJson) {
        item.appendChild(renderPackageCard(ws.id, ws.packageJson, ws));
      }

      // ── Row 3: status pills (compact) ──
      if (ws.statusPills.length > 0) {
        const statusContainer = document.createElement("div");
        statusContainer.className = "workspace-status";
        for (const pill of ws.statusPills) {
          const pillEl = document.createElement("span");
          pillEl.className = "status-pill";
          if (pill.icon && pill.icon in ICON_TEMPLATES) {
            pillEl.append(createIcon(pill.icon as IconName, "", 10));
          }
          const text = document.createElement("span");
          text.textContent = `${pill.key}: ${pill.value}`;
          pillEl.appendChild(text);
          if (pill.color) pillEl.style.color = pill.color;
          statusContainer.appendChild(pillEl);
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

/** Last two path segments (or full path if short); used by the cwd chip. */
function shortCwd(cwd: string): string {
  if (!cwd) return "";
  const parts = cwd.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length <= 2) {
    return cwd.startsWith("/") ? "/" + parts.join("/") : parts.join("/");
  }
  return "\u2026/" + parts.slice(-2).join("/");
}

/**
 * Render the package.json card for a workspace: name + version + description
 * header, then a list of scripts with status dots and run buttons.
 *
 * The status dot on each script reflects derivation from the process tree
 * (green = running) and a short-lived error flag (red = last exit non-zero
 * within the last ~10 s). Grey otherwise.
 */
function renderPackageCard(
  workspaceId: string,
  pkg: PackageInfo,
  ws: WorkspaceInfo,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "workspace-package";

  const header = document.createElement("div");
  header.className = "workspace-package-header";

  const icon = document.createElement("span");
  icon.className = "workspace-package-icon";
  icon.append(createIcon("package", "", 10));
  header.appendChild(icon);

  const nameEl = document.createElement("span");
  nameEl.className = "workspace-package-name";
  nameEl.textContent = pkg.name || "package.json";
  header.appendChild(nameEl);

  if (pkg.version) {
    const versionEl = document.createElement("span");
    versionEl.className = "workspace-package-version";
    versionEl.textContent = "v" + pkg.version;
    header.appendChild(versionEl);
  }

  if (pkg.type) {
    const typeEl = document.createElement("span");
    typeEl.className = "workspace-package-type";
    typeEl.textContent = pkg.type;
    header.appendChild(typeEl);
  }

  card.appendChild(header);

  if (pkg.description) {
    const descEl = document.createElement("div");
    descEl.className = "workspace-package-desc";
    descEl.textContent = pkg.description;
    descEl.title = pkg.description;
    card.appendChild(descEl);
  }

  if (pkg.bin) {
    const binEl = document.createElement("div");
    binEl.className = "workspace-package-bin";
    const label = document.createElement("span");
    label.className = "workspace-package-bin-label";
    label.textContent = "bin";
    binEl.appendChild(label);
    const names =
      typeof pkg.bin === "string"
        ? [pkg.name ?? "(bin)"]
        : Object.keys(pkg.bin);
    for (const name of names) {
      const chip = document.createElement("span");
      chip.className = "workspace-package-bin-chip";
      chip.textContent = name;
      binEl.appendChild(chip);
    }
    card.appendChild(binEl);
  }

  const scriptKeys = pkg.scripts ? Object.keys(pkg.scripts) : [];
  if (scriptKeys.length > 0) {
    const scripts = document.createElement("div");
    scripts.className = "workspace-package-scripts";

    for (const key of scriptKeys) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "workspace-script-btn";
      row.title = pkg.scripts![key] + "\n\nClick to run";

      let state: "running" | "error" | "idle" = "idle";
      if (ws.runningScripts.includes(key)) state = "running";
      else if (ws.erroredScripts.includes(key)) state = "error";
      row.dataset["state"] = state;

      const dot = document.createElement("span");
      dot.className = `workspace-script-dot ${state}`;
      row.appendChild(dot);

      const nameEl = document.createElement("span");
      nameEl.className = "workspace-script-name";
      nameEl.textContent = key;
      row.appendChild(nameEl);

      const cmdEl = document.createElement("span");
      cmdEl.className = "workspace-script-cmd";
      cmdEl.textContent = pkg.scripts![key];
      row.appendChild(cmdEl);

      const run = document.createElement("span");
      run.className = "workspace-script-run";
      run.textContent = state === "running" ? "running" : "run \u25B6";
      row.appendChild(run);

      row.addEventListener("click", (e) => {
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("ht-run-script", {
            detail: { workspaceId, cwd: pkg.directory, scriptKey: key },
          }),
        );
      });

      scripts.appendChild(row);
    }

    card.appendChild(scripts);
  }

  return card;
}
