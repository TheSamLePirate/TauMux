import type { ProcessNode, SurfaceMetadata } from "../../shared/types";
import { createIcon } from "./icons";

export interface ProcessManagerSurface {
  id: string;
  title: string;
  metadata: SurfaceMetadata | null;
}

export interface ProcessManagerWorkspace {
  id: string;
  name: string;
  color?: string;
  active: boolean;
  surfaces: ProcessManagerSurface[];
}

export type ProcessManagerDataSource = () => ProcessManagerWorkspace[];

interface ProcessManagerCallbacks {
  /** Fetch the current snapshot. Called on open + on each metadata change. */
  getData: ProcessManagerDataSource;
  /** Dispatched when the user clicks the kill button for a pid. */
  onKill: (pid: number, signal?: string) => void;
}

export class ProcessManagerPanel {
  private overlay: HTMLDivElement;
  private content: HTMLDivElement;
  private visible = false;
  private readonly getData: ProcessManagerDataSource;
  private readonly onKill: ProcessManagerCallbacks["onKill"];
  private collapsed = new Set<string>();

  constructor(callbacks: ProcessManagerCallbacks) {
    this.getData = callbacks.getData;
    this.onKill = callbacks.onKill;

    this.overlay = document.createElement("div");
    this.overlay.className = "process-manager-overlay";
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.hide();
    });

    const panel = document.createElement("div");
    panel.className = "process-manager-panel";

    const header = document.createElement("div");
    header.className = "process-manager-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "process-manager-header-title";
    titleWrap.append(createIcon("terminal", "", 14));
    const title = document.createElement("span");
    title.textContent = "Process Manager";
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);

    const hint = document.createElement("span");
    hint.className = "process-manager-header-hint";
    hint.textContent = "Live • ⌘⌥P to toggle";
    header.appendChild(hint);

    const closeBtn = document.createElement("button");
    closeBtn.className = "process-manager-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.append(createIcon("close", "", 14));
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);

    panel.appendChild(header);

    this.content = document.createElement("div");
    this.content.className = "process-manager-content";
    panel.appendChild(this.content);

    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.render();
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.visible = false;
    this.overlay.classList.remove("visible");
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  /** Re-render if open. Cheap — called from metadata updates. */
  refresh(): void {
    if (this.visible) this.render();
  }

  private render(): void {
    const workspaces = this.getData();
    this.content.replaceChildren();

    if (workspaces.length === 0) {
      const empty = document.createElement("div");
      empty.className = "process-manager-empty";
      empty.textContent = "No workspaces.";
      this.content.appendChild(empty);
      return;
    }

    let totalProcs = 0;
    let totalCpu = 0;
    let totalRss = 0;
    for (const ws of workspaces) {
      for (const s of ws.surfaces) {
        if (!s.metadata) continue;
        for (const n of s.metadata.tree) {
          totalProcs++;
          totalCpu += n.cpu;
          totalRss += n.rssKb;
        }
      }
    }

    const summary = document.createElement("div");
    summary.className = "process-manager-summary";
    summary.textContent = `${totalProcs} process${totalProcs === 1 ? "" : "es"} · ${totalCpu.toFixed(1)}% CPU · ${formatMem(totalRss)} RSS`;
    this.content.appendChild(summary);

    for (const ws of workspaces) {
      this.content.appendChild(this.renderWorkspace(ws));
    }
  }

  private renderWorkspace(ws: ProcessManagerWorkspace): HTMLElement {
    const el = document.createElement("section");
    el.className = `process-manager-workspace${ws.active ? " active" : ""}`;

    const header = document.createElement("div");
    header.className = "process-manager-workspace-header";

    const dot = document.createElement("span");
    dot.className = "process-manager-workspace-dot";
    dot.style.background = ws.color || "#89b4fa";
    header.appendChild(dot);

    const name = document.createElement("span");
    name.className = "process-manager-workspace-name";
    name.textContent = ws.name;
    header.appendChild(name);

    const count = ws.surfaces.reduce(
      (sum, s) => sum + (s.metadata?.tree.length ?? 0),
      0,
    );
    const badge = document.createElement("span");
    badge.className = "process-manager-workspace-count";
    badge.textContent = `${count} process${count === 1 ? "" : "es"}`;
    header.appendChild(badge);

    el.appendChild(header);

    for (const s of ws.surfaces) {
      el.appendChild(this.renderSurface(s));
    }

    return el;
  }

  private renderSurface(s: ProcessManagerSurface): HTMLElement {
    const el = document.createElement("div");
    el.className = "process-manager-surface";

    const header = document.createElement("div");
    header.className = "process-manager-surface-header";
    header.setAttribute("role", "button");
    header.tabIndex = 0;

    const caret = document.createElement("span");
    caret.className = "process-manager-caret";
    const isCollapsed = this.collapsed.has(s.id);
    caret.textContent = isCollapsed ? "▸" : "▾";
    header.appendChild(caret);

    const title = document.createElement("span");
    title.className = "process-manager-surface-title";
    title.textContent = s.title;
    header.appendChild(title);

    if (s.metadata?.cwd) {
      const cwd = document.createElement("span");
      cwd.className = "process-manager-surface-cwd";
      cwd.textContent = s.metadata.cwd;
      cwd.title = s.metadata.cwd;
      header.appendChild(cwd);
    }

    if (s.metadata?.git) {
      const g = s.metadata.git;
      const parts = ["\u2387 " + g.branch];
      if (g.ahead > 0) parts.push(`\u2191${g.ahead}`);
      if (g.behind > 0) parts.push(`\u2193${g.behind}`);
      if (g.conflicts > 0) parts.push(`!${g.conflicts}`);
      if (g.staged > 0) parts.push(`+${g.staged}`);
      if (g.unstaged > 0) parts.push(`*${g.unstaged}`);
      if (g.untracked > 0) parts.push(`?${g.untracked}`);
      const dirty =
        g.staged +
          g.unstaged +
          g.untracked +
          g.conflicts +
          g.insertions +
          g.deletions >
        0;
      const chip = document.createElement("span");
      chip.className = `process-manager-git${dirty ? " dirty" : ""}`;
      chip.textContent = parts.join(" ");
      const tip = [
        `branch: ${g.branch}${g.head ? " @ " + g.head : ""}`,
        g.upstream ? `upstream: ${g.upstream}` : "",
        g.insertions || g.deletions
          ? `diff vs HEAD: +${g.insertions} -${g.deletions}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      chip.title = tip;
      header.appendChild(chip);
    }

    if (s.metadata) {
      const seenPorts = new Set<number>();
      for (const p of s.metadata.listeningPorts) {
        if (seenPorts.has(p.port)) continue;
        seenPorts.add(p.port);
        const chip = document.createElement("span");
        chip.className = "process-manager-port";
        chip.textContent = `:${p.port}`;
        chip.title = `${p.proto} ${p.address}:${p.port} (pid ${p.pid})`;
        header.appendChild(chip);
      }
    }

    const toggle = (): void => {
      if (this.collapsed.has(s.id)) this.collapsed.delete(s.id);
      else this.collapsed.add(s.id);
      this.render();
    };
    header.addEventListener("click", toggle);
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });

    el.appendChild(header);

    if (!isCollapsed) {
      el.appendChild(this.renderTable(s));
    }

    return el;
  }

  private renderTable(s: ProcessManagerSurface): HTMLElement {
    const table = document.createElement("table");
    table.className = "process-manager-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const [label, cls] of [
      ["PID", "num"],
      ["Command", ""],
      ["CPU %", "num"],
      ["Memory", "num"],
      ["", ""],
    ] as const) {
      const th = document.createElement("th");
      th.textContent = label;
      if (cls) th.className = cls;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const tree = s.metadata?.tree ?? [];
    const fg = s.metadata?.foregroundPid ?? -1;

    if (tree.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "process-manager-empty-row";
      cell.textContent = s.metadata
        ? "(no processes in this surface)"
        : "(waiting for metadata…)";
      row.appendChild(cell);
      tbody.appendChild(row);
    } else {
      for (const node of tree) {
        tbody.appendChild(this.renderProcessRow(node, fg));
      }
    }

    table.appendChild(tbody);
    return table;
  }

  private renderProcessRow(
    node: ProcessNode,
    foregroundPid: number,
  ): HTMLTableRowElement {
    const row = document.createElement("tr");
    if (node.pid === foregroundPid) row.classList.add("foreground");

    const pid = document.createElement("td");
    pid.className = "num process-manager-pid";
    pid.textContent = String(node.pid);
    row.appendChild(pid);

    const cmd = document.createElement("td");
    cmd.className = "process-manager-cmd";
    cmd.textContent = node.command;
    cmd.title = node.command;
    row.appendChild(cmd);

    const cpu = document.createElement("td");
    cpu.className = "num process-manager-cpu";
    cpu.textContent = node.cpu.toFixed(1);
    cpu.style.setProperty("--heat", String(heatLevel(node.cpu)));
    row.appendChild(cpu);

    const mem = document.createElement("td");
    mem.className = "num process-manager-mem";
    mem.textContent = formatMem(node.rssKb);
    row.appendChild(mem);

    const action = document.createElement("td");
    action.className = "process-manager-action";
    const killBtn = document.createElement("button");
    killBtn.type = "button";
    killBtn.className = "process-manager-kill-btn";
    killBtn.textContent = "kill";
    killBtn.title = `Send SIGTERM to pid ${node.pid} (shift-click for SIGKILL)`;
    killBtn.addEventListener("click", (e) => {
      const signal = e.shiftKey ? "SIGKILL" : "SIGTERM";
      this.onKill(node.pid, signal);
    });
    action.appendChild(killBtn);
    row.appendChild(action);

    return row;
  }
}

function formatMem(kb: number): string {
  if (kb < 1024) return `${kb} K`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} M`;
  return `${(mb / 1024).toFixed(2)} G`;
}

/** Maps CPU% to 0..1 for visual heat (used by CSS for color). */
function heatLevel(cpu: number): number {
  if (cpu <= 0) return 0;
  return Math.max(0, Math.min(1, Math.log10(1 + cpu) / Math.log10(101)));
}
