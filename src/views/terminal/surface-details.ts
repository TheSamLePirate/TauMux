import type { GitInfo, SurfaceMetadata } from "../../shared/types";
import { createIcon } from "./icons";

export interface SurfaceDetailsRef {
  id: string;
  title: string;
  workspaceName: string;
  workspaceColor?: string;
  metadata: SurfaceMetadata | null;
}

interface SurfaceDetailsCallbacks {
  /** Return the current data for the surface currently shown, or null if gone. */
  getRef: (surfaceId: string) => SurfaceDetailsRef | null;
  /** Send SIGTERM by default; Shift-click sends SIGKILL. */
  onKillPid: (pid: number, signal?: string) => void;
  /** Open a URL in the system browser. */
  onOpenUrl: (url: string) => void;
}

/**
 * Per-surface inspector. Opened from the surface bar's info button, the
 * command palette ("Show Pane Info"), or Cmd+I. Layout is a centered
 * overlay — 720 px wide, scroll within. Refreshes live as metadata streams.
 */
export class SurfaceDetailsPanel {
  private overlay: HTMLDivElement;
  private body: HTMLDivElement;
  private titleEl: HTMLSpanElement;
  private subtitleEl: HTMLSpanElement;
  private visible = false;
  private currentSurfaceId: string | null = null;
  private readonly callbacks: SurfaceDetailsCallbacks;

  constructor(callbacks: SurfaceDetailsCallbacks) {
    this.callbacks = callbacks;

    this.overlay = document.createElement("div");
    this.overlay.className = "surface-details-overlay";
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.hide();
    });

    const panel = document.createElement("div");
    panel.className = "surface-details-panel";

    const header = document.createElement("div");
    header.className = "surface-details-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "surface-details-header-title";
    titleWrap.append(createIcon("info", "", 14));
    this.titleEl = document.createElement("span");
    this.titleEl.textContent = "Pane Info";
    titleWrap.appendChild(this.titleEl);
    header.appendChild(titleWrap);

    this.subtitleEl = document.createElement("span");
    this.subtitleEl.className = "surface-details-header-subtitle";
    header.appendChild(this.subtitleEl);

    const closeBtn = document.createElement("button");
    closeBtn.className = "surface-details-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.append(createIcon("close", "", 14));
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    this.body = document.createElement("div");
    this.body.className = "surface-details-body";
    panel.appendChild(this.body);

    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);
  }

  isVisible(): boolean {
    return this.visible;
  }

  currentSurface(): string | null {
    return this.currentSurfaceId;
  }

  showFor(surfaceId: string): void {
    this.currentSurfaceId = surfaceId;
    this.visible = true;
    this.render();
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.visible = false;
    this.currentSurfaceId = null;
    this.overlay.classList.remove("visible");
  }

  toggleFor(surfaceId: string): void {
    if (this.visible && this.currentSurfaceId === surfaceId) this.hide();
    else this.showFor(surfaceId);
  }

  /** Cheap — call from the bun metadata handler. No-op when not visible. */
  refresh(): void {
    if (this.visible) this.render();
  }

  private render(): void {
    if (!this.currentSurfaceId) return;
    const ref = this.callbacks.getRef(this.currentSurfaceId);
    this.body.replaceChildren();

    if (!ref) {
      this.titleEl.textContent = "Pane Info";
      this.subtitleEl.textContent = "(surface closed)";
      const empty = document.createElement("div");
      empty.className = "surface-details-empty";
      empty.textContent = "This pane no longer exists.";
      this.body.appendChild(empty);
      return;
    }

    this.titleEl.textContent = ref.title;
    const dot = ref.workspaceColor
      ? `● ${ref.workspaceName}`
      : ref.workspaceName;
    this.subtitleEl.textContent = dot;
    if (ref.workspaceColor) {
      this.subtitleEl.style.setProperty("--dot-color", ref.workspaceColor);
      this.subtitleEl.classList.add("with-dot");
    }

    const meta = ref.metadata;
    if (!meta) {
      const empty = document.createElement("div");
      empty.className = "surface-details-empty";
      empty.textContent = "Metadata not available yet — try again in a moment.";
      this.body.appendChild(empty);
      return;
    }

    this.body.appendChild(this.buildIdentity(meta));
    if (meta.git) this.body.appendChild(this.buildGit(meta.git));
    this.body.appendChild(this.buildPorts(meta));
    this.body.appendChild(this.buildTree(meta));
  }

  // ── Sections ──────────────────────────────────────────────────────────

  private buildIdentity(meta: SurfaceMetadata): HTMLElement {
    const fg = meta.tree.find((n) => n.pid === meta.foregroundPid);
    return buildSection("Identity", (rows) => {
      rows("Shell PID", String(meta.pid));
      rows("Foreground PID", String(meta.foregroundPid));
      rows("Foreground", fg?.command ?? "(shell)");
      rows("CWD", meta.cwd || "(unknown)", { mono: true, copy: !!meta.cwd });
      rows("Surface ID", this.currentSurfaceId ?? "", { mono: true });
      rows("Polled", `${formatAge(meta.updatedAt)} (epoch ${meta.updatedAt})`, {
        subtle: true,
      });
    });
  }

  private buildGit(g: GitInfo): HTMLElement {
    return buildSection("Git", (rows) => {
      rows("Branch", g.branch + (g.detached ? " (detached)" : ""), {
        emphasize: true,
      });
      if (g.head) rows("HEAD", g.head, { mono: true });
      rows(
        "Upstream",
        g.upstream
          ? `${g.upstream}${g.ahead || g.behind ? `  ↑${g.ahead} ↓${g.behind}` : ""}`
          : "(none)",
        { mono: !!g.upstream, subtle: !g.upstream },
      );
      rows(
        "Files",
        `${g.staged} staged · ${g.unstaged} unstaged · ${g.untracked} untracked${g.conflicts ? ` · ${g.conflicts} conflicts` : ""}`,
      );
      rows("Diff vs HEAD", `+${g.insertions}  −${g.deletions}`, { mono: true });
    });
  }

  private buildPorts(meta: SurfaceMetadata): HTMLElement {
    const section = document.createElement("section");
    section.className = "surface-details-section";
    const title = document.createElement("h3");
    title.textContent = `Listening ports (${meta.listeningPorts.length})`;
    section.appendChild(title);

    if (meta.listeningPorts.length === 0) {
      const empty = document.createElement("div");
      empty.className = "surface-details-empty-row";
      empty.textContent = "(no TCP listeners in this surface's process tree)";
      section.appendChild(empty);
      return section;
    }

    const byPid = new Map<number, string>();
    for (const n of meta.tree) byPid.set(n.pid, n.command);

    const table = document.createElement("table");
    table.className = "surface-details-table";
    table.innerHTML =
      '<thead><tr><th class="num">Port</th><th>Proto</th><th>Address</th><th class="num">PID</th><th>Command</th><th></th></tr></thead>';
    const tbody = document.createElement("tbody");

    for (const p of meta.listeningPorts) {
      const row = document.createElement("tr");
      row.appendChild(td(String(p.port), "num surface-details-port"));
      row.appendChild(td(p.proto, "subtle"));
      row.appendChild(td(p.address, "mono subtle"));
      row.appendChild(td(String(p.pid), "num"));
      row.appendChild(td(truncate(byPid.get(p.pid) ?? "", 48), "mono"));

      const actionCell = document.createElement("td");
      actionCell.className = "surface-details-row-actions";

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "surface-details-btn";
      openBtn.textContent = "open";
      openBtn.title = `Open http://localhost:${p.port}`;
      openBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.callbacks.onOpenUrl(`http://localhost:${p.port}`);
      });
      actionCell.appendChild(openBtn);

      const killBtn = document.createElement("button");
      killBtn.type = "button";
      killBtn.className = "surface-details-btn danger";
      killBtn.textContent = "kill";
      killBtn.title = `Send SIGTERM to pid ${p.pid} (Shift-click: SIGKILL)`;
      killBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.callbacks.onKillPid(p.pid, e.shiftKey ? "SIGKILL" : "SIGTERM");
      });
      actionCell.appendChild(killBtn);

      row.appendChild(actionCell);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    section.appendChild(table);
    return section;
  }

  private buildTree(meta: SurfaceMetadata): HTMLElement {
    const section = document.createElement("section");
    section.className = "surface-details-section";
    const title = document.createElement("h3");
    const totalCpu = meta.tree.reduce((sum, n) => sum + n.cpu, 0);
    const totalMem = meta.tree.reduce((sum, n) => sum + n.rssKb, 0);
    title.textContent = `Process tree (${meta.tree.length}) · ${totalCpu.toFixed(1)}% CPU · ${formatMem(totalMem)} RSS`;
    section.appendChild(title);

    if (meta.tree.length === 0) {
      const empty = document.createElement("div");
      empty.className = "surface-details-empty-row";
      empty.textContent = "(no processes — surface may still be booting)";
      section.appendChild(empty);
      return section;
    }

    const table = document.createElement("table");
    table.className = "surface-details-table surface-details-tree";
    table.innerHTML =
      '<thead><tr><th class="num">PID</th><th class="num">PPID</th><th>Command</th><th class="num">CPU%</th><th class="num">Memory</th><th></th></tr></thead>';
    const tbody = document.createElement("tbody");

    for (const n of meta.tree) {
      const row = document.createElement("tr");
      if (n.pid === meta.foregroundPid) row.classList.add("foreground");

      const pidCell = td(String(n.pid), "num surface-details-pid");
      row.appendChild(pidCell);
      row.appendChild(td(String(n.ppid), "num subtle"));
      const cmdCell = td(n.command, "mono surface-details-cmd");
      cmdCell.title = n.command;
      row.appendChild(cmdCell);
      const cpuCell = td(n.cpu.toFixed(1), "num surface-details-cpu");
      cpuCell.style.setProperty("--heat", String(heatLevel(n.cpu)));
      row.appendChild(cpuCell);
      row.appendChild(td(formatMem(n.rssKb), "num subtle"));

      const actionCell = document.createElement("td");
      actionCell.className = "surface-details-row-actions";
      const killBtn = document.createElement("button");
      killBtn.type = "button";
      killBtn.className = "surface-details-btn danger";
      killBtn.textContent = "kill";
      killBtn.title = `Send SIGTERM to pid ${n.pid} (Shift-click: SIGKILL)`;
      killBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.callbacks.onKillPid(n.pid, e.shiftKey ? "SIGKILL" : "SIGTERM");
      });
      actionCell.appendChild(killBtn);
      row.appendChild(actionCell);

      tbody.appendChild(row);
    }

    table.appendChild(tbody);
    section.appendChild(table);
    return section;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

interface RowOptions {
  mono?: boolean;
  subtle?: boolean;
  emphasize?: boolean;
  copy?: boolean;
}

function buildSection(
  title: string,
  fill: (
    addRow: (label: string, value: string, opts?: RowOptions) => void,
  ) => void,
): HTMLElement {
  const el = document.createElement("section");
  el.className = "surface-details-section";
  const titleEl = document.createElement("h3");
  titleEl.textContent = title;
  el.appendChild(titleEl);

  const dl = document.createElement("dl");
  dl.className = "surface-details-dl";

  const addRow = (
    label: string,
    value: string,
    opts: RowOptions = {},
  ): void => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    const classes: string[] = [];
    if (opts.mono) classes.push("mono");
    if (opts.subtle) classes.push("subtle");
    if (opts.emphasize) classes.push("emphasize");
    if (classes.length > 0) dd.className = classes.join(" ");
    dd.textContent = value;
    if (opts.copy) {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "surface-details-btn surface-details-copy";
      copyBtn.textContent = "copy";
      copyBtn.title = `Copy ${value}`;
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(value).catch(() => {});
        copyBtn.textContent = "copied";
        setTimeout(() => {
          copyBtn.textContent = "copy";
        }, 1200);
      });
      dd.appendChild(copyBtn);
    }
    dl.appendChild(dt);
    dl.appendChild(dd);
  };

  fill(addRow);
  el.appendChild(dl);
  return el;
}

function td(text: string, cls?: string): HTMLTableCellElement {
  const el = document.createElement("td");
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

function formatMem(kb: number): string {
  if (kb < 1024) return `${kb} K`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} M`;
  return `${(mb / 1024).toFixed(2)} G`;
}

function heatLevel(cpu: number): number {
  if (cpu <= 0) return 0;
  return Math.max(0, Math.min(1, Math.log10(1 + cpu) / Math.log10(101)));
}

function formatAge(epochMs: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  return `${m}m ${seconds - m * 60}s ago`;
}
