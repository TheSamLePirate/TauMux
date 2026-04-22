/**
 * τ-mux variant: Atlas — graph + ticker.
 *
 * Source: design_guidelines/Design Guidelines tau-mux.md §9.3.
 *
 *   "Radical. Replace the list sidebar with a workspace graph and add
 *    a bottom activity ticker."
 *
 * Atlas owns three pieces of chrome:
 *   1. 220 px graph column rendered as SVG inside #sidebar
 *   2. 36 px two-letter tab rail pinned between the graph and panes
 *   3. 32 px activity ticker that replaces the #tau-status-bar content
 *
 * All three are created on enter() and cleanly removed on exit(). The
 * existing sidebar content is hidden (not destroyed) while Atlas is
 * active, so switching back to Bridge or Cockpit restores the full
 * sidebar without re-mounting any state.
 */
import type { VariantContext, VariantHandle } from "./types";
import { IconTau } from "../tau-icons";

const GRAPH_ID = "tau-atlas-graph";
const TAB_RAIL_ID = "tau-atlas-tab-rail";

export const AtlasVariant: VariantHandle = {
  id: "atlas",

  enter(ctx) {
    ctx.body.dataset["tauVariant"] = "atlas";
    mountGraph(ctx);
    mountTabRail();
    mountTicker(ctx);
    attachListeners();
    schedule();
  },

  exit(ctx) {
    delete ctx.body.dataset["tauVariant"];
    detachListeners();
    unmountGraph();
    unmountTabRail();
    unmountTicker(ctx);
    cancelSchedule();
  },
};

// ─────────────────────────────────────────────────────────────
// Workspace graph (220 px column, SVG)
//
// Layout: self-node (τ-mux) pinned top-left, workspace nodes stacked
// vertically with their surface children branching to the right.
// Nodes are drawn as <circle>, edges as <path>.
// ─────────────────────────────────────────────────────────────

const NS_SVG = "http://www.w3.org/2000/svg";
type NodeKind = "self" | "repo" | "agent" | "tool";

interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  running: boolean;
}
interface GraphEdge {
  from: string;
  to: string;
  active: boolean;
}

function mountGraph(_ctx: VariantContext): void {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  let host = document.getElementById(GRAPH_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = GRAPH_ID;
    host.className = "tau-atlas-graph";
    sidebar.prepend(host);
  }
  renderGraph(host);
}

function unmountGraph(): void {
  document.getElementById(GRAPH_ID)?.remove();
}

function renderGraph(host: HTMLElement): void {
  host.replaceChildren();
  const width = 220;
  const height = host.clientHeight || 500;

  // ── data ──
  const sm = (
    window as unknown as { __tauSurfaceManager?: AtlasSurfaceManagerLike }
  ).__tauSurfaceManager;
  const state = sm?.getWorkspaceState?.();
  const workspaces = state?.workspaces ?? [];
  const activeId = state?.activeWorkspaceId;

  // Self node top (14 px from top); workspaces stacked below at 48 px pitch.
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const selfX = 42,
    selfY = 28;
  nodes.push({
    id: "__self__",
    label: "τ-mux",
    kind: "self",
    x: selfX,
    y: selfY,
    running: true,
  });

  workspaces.forEach((ws, i) => {
    const y = selfY + 48 + i * 42;
    nodes.push({
      id: ws.id,
      label: ws.name,
      kind: "repo",
      x: selfX,
      y,
      running: ws.id === activeId,
    });
    edges.push({ from: "__self__", to: ws.id, active: ws.id === activeId });

    // Surfaces belonging to the active workspace are branched to the
    // right as children. Keeps the density readable — only one column
    // of children at a time.
    if (ws.id === activeId) {
      ws.surfaceIds.forEach((sid, j) => {
        const el = document.querySelector<HTMLElement>(
          `.surface-container[data-surface-id="${sid}"]`,
        );
        const isAgent = !!el && el.classList.contains("tau-pane-agent");
        nodes.push({
          id: sid,
          label:
            el?.querySelector<HTMLElement>(".surface-bar-title")?.textContent ??
            sid,
          kind: isAgent ? "agent" : "tool",
          x: selfX + 72,
          y: y + 10 + j * 18,
          running: isAgent,
        });
        edges.push({ from: ws.id, to: sid, active: true });
      });
    }
  });

  // ── svg ──
  const svg = document.createElementNS(NS_SVG, "svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.display = "block";

  // 20 px faint grid pattern per §9.3.
  const defs = document.createElementNS(NS_SVG, "defs");
  const pat = document.createElementNS(NS_SVG, "pattern");
  pat.setAttribute("id", "tau-atlas-grid");
  pat.setAttribute("width", "20");
  pat.setAttribute("height", "20");
  pat.setAttribute("patternUnits", "userSpaceOnUse");
  const pl = document.createElementNS(NS_SVG, "path");
  pl.setAttribute("d", "M 20 0 L 0 0 0 20");
  pl.setAttribute("fill", "none");
  pl.setAttribute("stroke", "rgba(26, 35, 40, 0.5)");
  pl.setAttribute("stroke-width", "0.5");
  pat.appendChild(pl);
  defs.appendChild(pat);
  svg.appendChild(defs);

  const bg = document.createElementNS(NS_SVG, "rect");
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(height));
  bg.setAttribute("fill", "url(#tau-atlas-grid)");
  svg.appendChild(bg);

  // Edges first so nodes render on top.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const p = document.createElementNS(NS_SVG, "path");
    p.setAttribute("d", `M ${a.x} ${a.y} L ${b.x} ${b.y}`);
    if (e.active) {
      p.setAttribute("stroke", "var(--tau-cyan)");
      p.setAttribute("stroke-width", "1");
      p.setAttribute("stroke-dasharray", "3 3");
      p.setAttribute("stroke-opacity", "0.55");
      p.setAttribute("class", "tau-atlas-edge-active");
    } else {
      p.setAttribute("stroke", "var(--tau-edge)");
      p.setAttribute("stroke-width", "0.6");
    }
    p.setAttribute("fill", "none");
    svg.appendChild(p);
  }

  // Nodes.
  for (const n of nodes) {
    const colour =
      n.kind === "self"
        ? "var(--tau-cyan)"
        : n.kind === "agent"
          ? "var(--tau-agent)"
          : n.kind === "tool"
            ? "var(--tau-text-dim)"
            : "var(--tau-text)";
    if (n.running) {
      const halo = document.createElementNS(NS_SVG, "circle");
      halo.setAttribute("cx", String(n.x));
      halo.setAttribute("cy", String(n.y));
      halo.setAttribute("r", "12");
      halo.setAttribute("fill", colour);
      halo.setAttribute("opacity", "0.16");
      halo.setAttribute("class", "tau-atlas-halo");
      svg.appendChild(halo);
    }
    const circle = document.createElementNS(NS_SVG, "circle");
    circle.setAttribute("cx", String(n.x));
    circle.setAttribute("cy", String(n.y));
    circle.setAttribute("r", n.running ? "6" : "4.5");
    circle.setAttribute("fill", n.running ? colour : "transparent");
    circle.setAttribute("stroke", colour);
    circle.setAttribute("stroke-width", "0.8");
    if (n.id !== "__self__") {
      circle.style.cursor = "pointer";
      circle.addEventListener("click", () => {
        if (n.kind === "repo") {
          // workspace id — focus its first surface via index
          const sm2 = (
            window as unknown as {
              __tauSurfaceManager?: AtlasSurfaceManagerLike;
            }
          ).__tauSurfaceManager;
          const ws = sm2?.getWorkspaceState?.();
          const idx = ws?.workspaces.findIndex((w) => w.id === n.id) ?? -1;
          if (idx >= 0) sm2?.focusWorkspaceByIndex?.(idx);
        } else {
          // surface id — dispatch focus via synthetic click on its container
          const el = document.querySelector<HTMLElement>(
            `.surface-container[data-surface-id="${n.id}"]`,
          );
          el?.click();
        }
      });
    }
    svg.appendChild(circle);

    const label = document.createElementNS(NS_SVG, "text");
    label.setAttribute("x", String(n.x + 10));
    label.setAttribute("y", String(n.y + 3));
    label.setAttribute("fill", "var(--tau-text)");
    label.setAttribute("font-family", "var(--tau-font-mono)");
    label.setAttribute("font-size", "10");
    label.textContent = n.label;
    svg.appendChild(label);
  }

  host.appendChild(svg);

  // Info card pinned bottom-left per §9.3.
  const focusedId = (window as unknown as { __tauFocusedSurfaceId?: string })
    .__tauFocusedSurfaceId;
  const focusedNode = nodes.find((n) => n.id === focusedId);
  const card = document.createElement("div");
  card.className = "tau-atlas-info-card tau-mono";
  if (focusedNode) {
    card.innerHTML =
      `<div class="tau-atlas-info-name">${escapeHtml(focusedNode.label)}</div>` +
      `<div class="tau-atlas-info-meta">${focusedNode.kind}</div>`;
  } else {
    card.innerHTML = `<div class="tau-atlas-info-name">τ-mux</div><div class="tau-atlas-info-meta">idle</div>`;
  }
  host.appendChild(card);
}

interface AtlasSurfaceManagerLike {
  getWorkspaceState?: () => {
    workspaces: { id: string; name: string; surfaceIds: string[] }[];
    activeWorkspaceId: string | undefined;
  };
  focusWorkspaceByIndex?: (i: number) => void;
}

// ─────────────────────────────────────────────────────────────
// 36 px tab rail between graph and panes.
// Two-letter mnemonics; active chip glows in identity colour;
// running dot top-right.
// ─────────────────────────────────────────────────────────────

function mountTabRail(): void {
  const container = document.getElementById("terminal-container");
  if (!container) return;
  let rail = document.getElementById(TAB_RAIL_ID);
  if (!rail) {
    rail = document.createElement("div");
    rail.id = TAB_RAIL_ID;
    rail.className = "tau-atlas-tab-rail";
    container.parentElement?.insertBefore(rail, container);
  }
  renderTabRail(rail);
}

function unmountTabRail(): void {
  document.getElementById(TAB_RAIL_ID)?.remove();
}

function renderTabRail(rail: HTMLElement): void {
  rail.replaceChildren();
  const sm = (
    window as unknown as { __tauSurfaceManager?: AtlasSurfaceManagerLike }
  ).__tauSurfaceManager;
  const state = sm?.getWorkspaceState?.();
  const active = state?.workspaces.find(
    (w) => w.id === state.activeWorkspaceId,
  );
  if (!active) return;
  const focusedId = (window as unknown as { __tauFocusedSurfaceId?: string })
    .__tauFocusedSurfaceId;
  for (const sid of active.surfaceIds) {
    const el = document.querySelector<HTMLElement>(
      `.surface-container[data-surface-id="${sid}"]`,
    );
    const title =
      el?.querySelector<HTMLElement>(".surface-bar-title")?.textContent ?? sid;
    const mnemonic = makeMnemonic(title);
    const isAgent = !!el && el.classList.contains("tau-pane-agent");
    const isFocused = sid === focusedId;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className =
      `tau-atlas-chip tau-atlas-chip-${isAgent ? "agent" : "human"}` +
      (isFocused ? " is-focused" : "");
    chip.textContent = mnemonic;
    chip.title = title;
    chip.addEventListener("click", () => el?.click());
    if (isAgent || isFocused) {
      const dot = document.createElement("span");
      dot.className = "tau-atlas-chip-dot";
      chip.appendChild(dot);
    }
    rail.appendChild(chip);
  }
}

function makeMnemonic(title: string): string {
  // CC / OC / LZ / CX / ZS style — first letter of each word, upper.
  const parts = title
    .replace(/[^A-Za-z0-9 \-]+/g, " ")
    .split(/[\s\-]+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  const w = parts[0] ?? title;
  return (w[0] + (w[1] ?? w[0] ?? "?")).toUpperCase();
}

// ─────────────────────────────────────────────────────────────
// Activity ticker — replaces the status bar when Atlas is active.
// ─────────────────────────────────────────────────────────────

function mountTicker(ctx: VariantContext): void {
  ctx.statusBar.classList.add("tau-atlas-ticker");
  ctx.statusBar.replaceChildren();
  const left = document.createElement("div");
  left.className = "tau-atlas-ticker-brand";
  left.appendChild(IconTau({ size: 10 }));
  const brandLabel = document.createElement("span");
  brandLabel.className = "tau-mono";
  brandLabel.textContent = "TICKER";
  left.appendChild(brandLabel);
  ctx.statusBar.appendChild(left);

  const stream = document.createElement("div");
  stream.className = "tau-atlas-ticker-stream tau-mono";
  stream.id = "tau-atlas-ticker-stream";
  ctx.statusBar.appendChild(stream);
  renderTickerStream(stream);

  const right = document.createElement("div");
  right.className = "tau-atlas-ticker-right tau-mono";
  right.innerHTML =
    '<span class="tau-status-label">codex</span><span class="tau-status-value">—</span>' +
    '<span class="tau-hud-sep">·</span>' +
    '<span class="tau-status-label">week</span><span class="tau-status-value">—</span>' +
    '<span class="tau-hud-sep">·</span>' +
    '<span class="tau-status-label">$</span><span class="tau-status-value">0.00</span>';
  ctx.statusBar.appendChild(right);
}

function unmountTicker(ctx: VariantContext): void {
  ctx.statusBar.classList.remove("tau-atlas-ticker");
  // Let index.ts/mountStatusBar rebuild the standard StatusBar on the
  // next applySettings pass — it's invoked from the controller's
  // refresh() path. To avoid stale children in the meantime, reset
  // inline styles and content here.
  ctx.statusBar.replaceChildren();
  ctx.statusBar.dispatchEvent(new CustomEvent("tau-status-bar-reset"));
}

function renderTickerStream(stream: HTMLElement): void {
  const sm = (
    window as unknown as { __tauSurfaceManager?: AtlasSurfaceManagerLike }
  ).__tauSurfaceManager;
  const state = sm?.getWorkspaceState?.();
  const events: { kind: "human" | "agent" | "ok"; text: string }[] = [];
  const active = state?.workspaces.find(
    (w) => w.id === state.activeWorkspaceId,
  );
  if (active) {
    for (const sid of active.surfaceIds) {
      const el = document.querySelector<HTMLElement>(
        `.surface-container[data-surface-id="${sid}"]`,
      );
      if (!el) continue;
      const title =
        el.querySelector<HTMLElement>(".surface-bar-title")?.textContent ?? sid;
      const isAgent = el.classList.contains("tau-pane-agent");
      events.push({
        kind: isAgent ? "agent" : "human",
        text: `${title} active`,
      });
    }
  }
  if (events.length === 0) {
    events.push({ kind: "ok", text: "τ-mux ready" });
  }
  stream.replaceChildren();
  // Two copies so the -50% translate animation loops seamlessly.
  for (let i = 0; i < 2; i++) {
    for (const e of events) {
      const dot = document.createElement("span");
      dot.className = `tau-atlas-event-dot tau-atlas-event-${e.kind}`;
      const t = document.createElement("span");
      t.className = "tau-atlas-event-text";
      t.textContent = e.text;
      const sep = document.createElement("span");
      sep.className = "tau-hud-sep";
      sep.textContent = "│";
      stream.append(dot, t, sep);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );
}

// ─────────────────────────────────────────────────────────────
// Subscriptions — keep all three Atlas pieces in sync.
// ─────────────────────────────────────────────────────────────

let refreshHandler: (() => void) | null = null;
let focusHandler: ((e: Event) => void) | null = null;

function attachListeners(): void {
  refreshHandler = () => schedule();
  focusHandler = (e: Event) => {
    const detail = (e as CustomEvent<{ surfaceId: string }>).detail;
    if (detail?.surfaceId) {
      (
        window as unknown as { __tauFocusedSurfaceId?: string }
      ).__tauFocusedSurfaceId = detail.surfaceId;
    }
    schedule();
  };
  window.addEventListener("ht-workspaces-changed", refreshHandler);
  window.addEventListener("ht-surface-focused", focusHandler);
}

function detachListeners(): void {
  if (refreshHandler) {
    window.removeEventListener("ht-workspaces-changed", refreshHandler);
    refreshHandler = null;
  }
  if (focusHandler) {
    window.removeEventListener("ht-surface-focused", focusHandler);
    focusHandler = null;
  }
}

let pending: number | null = null;
function schedule(): void {
  if (pending !== null) return;
  pending = window.requestAnimationFrame(() => {
    pending = null;
    const graph = document.getElementById(GRAPH_ID);
    if (graph) renderGraph(graph);
    const rail = document.getElementById(TAB_RAIL_ID);
    if (rail) renderTabRail(rail);
    const stream = document.getElementById("tau-atlas-ticker-stream");
    if (stream) renderTickerStream(stream);
  });
}
function cancelSchedule(): void {
  if (pending !== null) {
    cancelAnimationFrame(pending);
    pending = null;
  }
}
