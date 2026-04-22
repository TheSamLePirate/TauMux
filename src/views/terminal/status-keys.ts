/**
 * τ-mux status-bar key registry.
 *
 * Each status key is a pluggable indicator rendered by the bottom
 * status bar. Keys are pure functions: they receive a `StatusContext`
 * snapshot (workspaces, active surface, process-manager data, settings,
 * clock tick) and return either a DOM node, a plain text value, or
 * `null` to opt out of rendering when the data is unavailable.
 *
 * The user picks which keys appear (and in what order) via
 * `AppSettings.statusBarKeys`. This module owns the registry + two
 * public functions:
 *   - `renderStatusKey(id, ctx)` — render a single key
 *   - `STATUS_KEY_META` — metadata for Settings UI (label + group)
 *
 * Keys should be cheap to compute — the bottom bar refreshes on every
 * metadata poll (≈1 Hz) and every workspace/focus event.
 */
import type { AppSettings } from "../../shared/settings";
import type { SurfaceMetadata } from "../../shared/types";
import { Meter } from "./tau-primitives";

export interface StatusWorkspaceInfo {
  id: string;
  name: string;
  color?: string;
  surfaceIds: string[];
}
export interface StatusPmSurface {
  id: string;
  title: string;
  metadata: SurfaceMetadata | null;
}
export interface StatusPmWorkspace {
  id: string;
  name: string;
  color?: string;
  active: boolean;
  surfaces: StatusPmSurface[];
}

export interface StatusContext {
  settings: AppSettings;
  workspaces: StatusWorkspaceInfo[];
  activeWorkspaceId: string | null | undefined;
  activeWorkspace: StatusWorkspaceInfo | undefined;
  pmData: StatusPmWorkspace[];
  pmActive: StatusPmWorkspace | undefined;
  focusedSurfaceId: string | null | undefined;
  focusedSurface: StatusPmSurface | undefined;
  notifyWorkspaces: Set<string>;
  now: number;
}

export interface StatusKeyRenderer {
  id: string;
  label: string;
  /** Short description shown in the settings picker. */
  description: string;
  /** Group in the settings picker so related keys cluster together. */
  group: "identity" | "load" | "focus" | "system";
  render: (ctx: StatusContext) => HTMLElement | null;
}

// ── small helpers ─────────────────────────────────────────────

function kv(label: string, value: string, title?: string): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv";
  if (title) wrap.title = title;
  const l = document.createElement("span");
  l.className = "tau-status-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "tau-status-value";
  v.textContent = value;
  wrap.append(l, v);
  return wrap;
}

function dotLabel(label: string, colour: string): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-status-kv";
  const dot = document.createElement("span");
  dot.className = "tau-status-dot";
  dot.style.background = colour;
  const v = document.createElement("span");
  v.className = "tau-status-value";
  v.textContent = label;
  wrap.append(dot, v);
  return wrap;
}

function shortenCwd(cwd: string): string {
  if (!cwd) return "—";
  const m = cwd.match(/^(\/Users\/[^/]+)(.*)$/);
  let short = m ? "~" + m[2] : cwd;
  if (short.length > 38) {
    const parts = short.split("/");
    if (parts.length > 3) {
      short = `${parts[0]}/…/${parts.slice(-2).join("/")}`;
    }
  }
  return short;
}

function aggregateCpuMem(pmWs: StatusPmWorkspace | undefined): {
  cpu: number;
  rssKb: number;
  procCount: number;
} {
  let cpu = 0,
    rssKb = 0,
    procCount = 0;
  if (!pmWs) return { cpu, rssKb, procCount };
  for (const surf of pmWs.surfaces) {
    if (!surf.metadata) continue;
    for (const proc of surf.metadata.tree) {
      cpu += proc.cpu ?? 0;
      rssKb += proc.rssKb ?? 0;
      procCount++;
    }
  }
  return { cpu, rssKb, procCount };
}

function formatMem(rssKb: number): string {
  const mb = rssKb / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}G`;
  return `${Math.round(mb)}M`;
}

// ── renderers ─────────────────────────────────────────────────

const workspaceKey: StatusKeyRenderer = {
  id: "workspace",
  label: "Workspace",
  description: "Active workspace name with its colour dot.",
  group: "identity",
  render: ({ activeWorkspace }) => {
    if (!activeWorkspace) {
      const wrap = document.createElement("span");
      wrap.className = "tau-status-kv";
      const l = document.createElement("span");
      l.className = "tau-status-label";
      l.textContent = "no workspace";
      wrap.append(l);
      return wrap;
    }
    return dotLabel(
      activeWorkspace.name,
      activeWorkspace.color || "var(--tau-cyan)",
    );
  },
};

const panesKey: StatusKeyRenderer = {
  id: "panes",
  label: "Pane count",
  description: "Number of panes in the active workspace.",
  group: "identity",
  render: ({ activeWorkspace }) =>
    kv("panes", String(activeWorkspace?.surfaceIds.length ?? 0)),
};

const workspacesKey: StatusKeyRenderer = {
  id: "workspaces",
  label: "Workspace count",
  description: "Total workspaces.",
  group: "identity",
  render: ({ workspaces }) => kv("ws", String(workspaces.length)),
};

const cpuKey: StatusKeyRenderer = {
  id: "cpu",
  label: "CPU",
  description: "Aggregated CPU% across the active workspace's processes.",
  group: "load",
  render: ({ pmActive }) => {
    const { cpu } = aggregateCpuMem(pmActive);
    const pct = Math.min(100, Math.round(cpu));
    return Meter({
      label: "cpu",
      value: pct,
      max: 100,
      semantic: pct > 80 ? "err" : pct > 50 ? "warn" : "ok",
      width: 60,
      valueText: `${pct}%`,
    });
  },
};

const memKey: StatusKeyRenderer = {
  id: "mem",
  label: "Memory",
  description: "Aggregated RSS across the active workspace.",
  group: "load",
  render: ({ pmActive }) => {
    const { rssKb } = aggregateCpuMem(pmActive);
    const mb = Math.round(rssKb / 1024);
    return Meter({
      label: "mem",
      value: mb,
      max: 8192,
      semantic: mb > 4096 ? "warn" : "ok",
      width: 60,
      valueText: formatMem(rssKb),
    });
  },
};

const procsKey: StatusKeyRenderer = {
  id: "procs",
  label: "Process count",
  description: "Total processes across the active workspace's panes.",
  group: "load",
  render: ({ pmActive }) =>
    kv("procs", String(aggregateCpuMem(pmActive).procCount)),
};

const fgKey: StatusKeyRenderer = {
  id: "fg",
  label: "Foreground cmd",
  description: "Foreground process of the focused pane.",
  group: "focus",
  render: ({ focusedSurface }) => {
    if (!focusedSurface?.metadata) return kv("fg", "—");
    const meta = focusedSurface.metadata;
    const fgNode = meta.tree.find((n) => n.pid === meta.foregroundPid);
    const fg = (fgNode?.command ?? "").split("/").pop() || "shell";
    return kv("fg", fg, fgNode?.command);
  },
};

const cwdKey: StatusKeyRenderer = {
  id: "cwd",
  label: "CWD",
  description: "Working directory of the focused pane (shortened).",
  group: "focus",
  render: ({ focusedSurface }) => {
    const cwd = focusedSurface?.metadata?.cwd;
    if (!cwd) return kv("cwd", "—");
    return kv("cwd", shortenCwd(cwd), cwd);
  },
};

const branchKey: StatusKeyRenderer = {
  id: "branch",
  label: "Git branch",
  description: "Branch name of the focused pane's repo.",
  group: "focus",
  render: ({ focusedSurface }) => {
    const g = focusedSurface?.metadata?.git;
    if (!g) return null;
    return kv("branch", g.branch);
  },
};

const gitStatusKey: StatusKeyRenderer = {
  id: "git",
  label: "Git status",
  description: "Dirty / clean status of the focused pane's repo.",
  group: "focus",
  render: ({ focusedSurface }) => {
    const g = focusedSurface?.metadata?.git;
    if (!g) return null;
    const dirtyCount =
      (g.staged ?? 0) +
      (g.unstaged ?? 0) +
      (g.untracked ?? 0) +
      (g.conflicts ?? 0);
    const dirty = (g.ahead ?? 0) + (g.behind ?? 0) + dirtyCount > 0;
    const label = dirty
      ? `↑${g.ahead ?? 0}·↓${g.behind ?? 0}·${dirtyCount}`
      : "clean";
    const wrap = kv("git", label);
    if (dirty) wrap.classList.add("tau-status-warn");
    return wrap;
  },
};

const pidKey: StatusKeyRenderer = {
  id: "pid",
  label: "PID",
  description: "Shell pid of the focused pane.",
  group: "focus",
  render: ({ focusedSurface }) => {
    const pid = focusedSurface?.metadata?.pid;
    return kv("pid", pid ? String(pid) : "—");
  },
};

const portsKey: StatusKeyRenderer = {
  id: "ports",
  label: "Listening ports",
  description: "TCP ports listening in the active workspace.",
  group: "system",
  render: ({ pmActive }) => {
    if (!pmActive) return kv("ports", "0");
    let count = 0;
    for (const s of pmActive.surfaces) {
      count += s.metadata?.listeningPorts.length ?? 0;
    }
    return kv("ports", String(count));
  },
};

const notificationsKey: StatusKeyRenderer = {
  id: "notifications",
  label: "Notifications",
  description: "Workspaces with pending notifications.",
  group: "system",
  render: ({ notifyWorkspaces }) => {
    const wrap = kv("alerts", String(notifyWorkspaces.size));
    if (notifyWorkspaces.size > 0) wrap.classList.add("tau-status-warn");
    return wrap;
  },
};

const modelKey: StatusKeyRenderer = {
  id: "model",
  label: "Agent model",
  description: "Model name reported by the focused agent pane.",
  group: "focus",
  render: ({ focusedSurface }) => {
    // Derived from DOM because the agent panel owns its own state that
    // isn't threaded through SurfaceMetadata.
    if (!focusedSurface) return null;
    const el = document.querySelector<HTMLElement>(
      `.surface-container[data-surface-id="${focusedSurface.id}"]`,
    );
    if (!el?.classList.contains("tau-pane-agent")) return null;
    const modelText =
      el.querySelector<HTMLElement>(".agent-tb-model")?.textContent?.trim() ??
      "";
    return kv("model", modelText || "—");
  },
};

const timeKey: StatusKeyRenderer = {
  id: "time",
  label: "Clock",
  description: "Current time (HH:MM).",
  group: "system",
  render: ({ now }) => {
    const d = new Date(now);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return kv("time", `${hh}:${mm}`);
  },
};

const uptimeKey: StatusKeyRenderer = {
  id: "uptime",
  label: "Uptime",
  description: "Time since τ-mux launched.",
  group: "system",
  render: ({ now }) => {
    const sec = Math.floor((now - bootTime) / 1000);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const fmt =
      h > 0
        ? `${h}h${String(m).padStart(2, "0")}m`
        : `${m}m${String(s).padStart(2, "0")}s`;
    return kv("up", fmt);
  },
};
const bootTime = typeof performance !== "undefined" ? Date.now() : 0;

const surfaceKindKey: StatusKeyRenderer = {
  id: "kind",
  label: "Pane kind",
  description: "HUMAN or AGENT identity of the focused pane.",
  group: "focus",
  render: ({ focusedSurface }) => {
    if (!focusedSurface) return null;
    const el = document.querySelector<HTMLElement>(
      `.surface-container[data-surface-id="${focusedSurface.id}"]`,
    );
    const isAgent = !!el?.classList.contains("tau-pane-agent");
    const wrap = kv("kind", isAgent ? "AGENT" : "HUMAN");
    const v = wrap.querySelector<HTMLElement>(".tau-status-value");
    if (v) {
      v.style.color = isAgent ? "var(--tau-agent)" : "var(--tau-cyan)";
      v.style.fontWeight = "700";
      v.style.letterSpacing = "0.08em";
    }
    return wrap;
  },
};

// ── registry ─────────────────────────────────────────────────

const REGISTRY: Record<string, StatusKeyRenderer> = {
  workspace: workspaceKey,
  panes: panesKey,
  workspaces: workspacesKey,
  cpu: cpuKey,
  mem: memKey,
  procs: procsKey,
  fg: fgKey,
  cwd: cwdKey,
  branch: branchKey,
  git: gitStatusKey,
  pid: pidKey,
  ports: portsKey,
  notifications: notificationsKey,
  model: modelKey,
  kind: surfaceKindKey,
  time: timeKey,
  uptime: uptimeKey,
};

export const STATUS_KEY_IDS = Object.keys(REGISTRY);

export function renderStatusKey(
  id: string,
  ctx: StatusContext,
): HTMLElement | null {
  return REGISTRY[id]?.render(ctx) ?? null;
}

export interface StatusKeyMeta {
  id: string;
  label: string;
  description: string;
  group: StatusKeyRenderer["group"];
}
export const STATUS_KEY_META: StatusKeyMeta[] = Object.values(REGISTRY).map(
  ({ id, label, description, group }) => ({ id, label, description, group }),
);

/** Ordered list of the groups for settings-UI bucketing. */
export const STATUS_KEY_GROUPS: StatusKeyRenderer["group"][] = [
  "identity",
  "load",
  "focus",
  "system",
];
