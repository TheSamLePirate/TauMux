/**
 * τ-mux variant: Cockpit — icon rail + HUD.
 *
 * Source: design_guidelines/Design Guidelines tau-mux.md §9.2.
 *
 *   "Denser. Sidebar becomes a 52 px icon rail. Every pane gets a 22 px
 *    HUD strip between header and body showing
 *    KIND · model · state · tok/s · $ · Δ.
 *    Up to 4 panes (2×2 or 2+2)."
 *
 * Cockpit owns two pieces of chrome beyond the variant CSS:
 *   1. a 52 px icon rail rendered into #tau-cockpit-rail inside #sidebar
 *   2. per-pane HUD strips injected after .surface-bar in every
 *      .surface-container (live + future)
 *
 * Both are created on enter() and cleanly removed on exit(), leaving
 * no residue when the user switches back to Bridge / Atlas. A
 * MutationObserver on #terminal-container keeps new panes in sync
 * without touching surface-manager.
 */
import type { VariantContext, VariantHandle } from "./types";
import { IconTau } from "../tau-icons";

const RAIL_ID = "tau-cockpit-rail";
const HUD_CLASS = "tau-hud";

export const CockpitVariant: VariantHandle = {
  id: "cockpit",

  enter(ctx) {
    ctx.body.dataset["tauVariant"] = "cockpit";
    mountRail(ctx);
    injectAllHuds();
    startPaneObserver();
  },

  exit(ctx) {
    delete ctx.body.dataset["tauVariant"];
    unmountRail();
    removeAllHuds();
    stopPaneObserver();
  },
};

// ─────────────────────────────────────────────────────────────
// 52 px icon rail — replaces sidebar content while Cockpit is active.
// ─────────────────────────────────────────────────────────────

function mountRail(ctx: VariantContext): void {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  let rail = document.getElementById(RAIL_ID);
  if (!rail) {
    rail = document.createElement("div");
    rail.id = RAIL_ID;
    rail.className = "tau-cockpit-rail";
    sidebar.prepend(rail);
  }
  renderRail(rail, ctx);

  // Keep the rail in sync with workspace changes. ht-surface-focused
  // fires on workspace/pane transitions, and its cost is low (a
  // handful of buttons max).
  if (!railRefreshHandler) {
    railRefreshHandler = () => {
      const r = document.getElementById(RAIL_ID);
      if (r) renderRail(r, ctx);
    };
    window.addEventListener("ht-surface-focused", railRefreshHandler);
    window.addEventListener("ht-workspaces-changed", railRefreshHandler);
  }
}

function unmountRail(): void {
  const rail = document.getElementById(RAIL_ID);
  if (rail) rail.remove();
  if (railRefreshHandler) {
    window.removeEventListener("ht-surface-focused", railRefreshHandler);
    window.removeEventListener("ht-workspaces-changed", railRefreshHandler);
    railRefreshHandler = null;
  }
}

let railRefreshHandler: (() => void) | null = null;

function renderRail(rail: HTMLElement, _ctx: VariantContext): void {
  rail.replaceChildren();
  // Top τ mark (22 px) + hairline divider. §9.2.
  const mark = document.createElement("div");
  mark.className = "tau-cockpit-rail-mark";
  mark.appendChild(IconTau({ size: 22 }));
  rail.appendChild(mark);

  const divider = document.createElement("div");
  divider.className = "tau-cockpit-rail-divider";
  rail.appendChild(divider);

  // Workspace buttons. Pull the list from surfaceManager via the
  // existing public API — accessed through window to avoid a circular
  // import (controller owns no surface-manager ref).
  const sm = (window as unknown as { __tauSurfaceManager?: SurfaceManagerLike })
    .__tauSurfaceManager;
  const workspaces = sm?.getWorkspaceState?.()?.workspaces ?? [];
  const activeId = sm?.getWorkspaceState?.()?.activeWorkspaceId;
  const hasRunningAgent = (ws: { surfaceIds: string[] }) =>
    ws.surfaceIds.some((sid) => {
      const el = document.querySelector<HTMLElement>(
        `.surface-container[data-surface-id="${sid}"]`,
      );
      return !!el && el.classList.contains("tau-pane-agent");
    });

  workspaces.forEach((ws, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "tau-cockpit-rail-btn" + (ws.id === activeId ? " is-active" : "");
    btn.title = ws.name;
    btn.textContent = String(i + 1).padStart(2, "0");
    btn.addEventListener("click", () => sm?.focusWorkspaceByIndex?.(i));
    if (hasRunningAgent(ws)) {
      const dot = document.createElement("span");
      dot.className = "tau-cockpit-rail-agent-dot";
      btn.appendChild(dot);
    }
    rail.appendChild(btn);
  });
}

interface SurfaceManagerLike {
  getWorkspaceState?: () => {
    workspaces: { id: string; name: string; surfaceIds: string[] }[];
    activeWorkspaceId: string | undefined;
  };
  focusWorkspaceByIndex?: (i: number) => void;
}

// ─────────────────────────────────────────────────────────────
// Per-pane 22 px HUD strip injected after .surface-bar.
// Content: KIND · model · ● state · tok/s · $ · Δ.
// ─────────────────────────────────────────────────────────────

const HUD_OBSERVER: { obs: MutationObserver | null } = { obs: null };

function startPaneObserver(): void {
  if (HUD_OBSERVER.obs) return;
  const root = document.getElementById("terminal-container");
  if (!root) return;
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of Array.from(r.addedNodes)) {
        if (
          n instanceof HTMLElement &&
          n.classList.contains("surface-container")
        ) {
          ensureHud(n);
        }
      }
    }
  });
  obs.observe(root, { childList: true });
  HUD_OBSERVER.obs = obs;
}

function stopPaneObserver(): void {
  HUD_OBSERVER.obs?.disconnect();
  HUD_OBSERVER.obs = null;
}

function injectAllHuds(): void {
  const roots = document.querySelectorAll<HTMLElement>(".surface-container");
  for (const r of roots) ensureHud(r);
}

function removeAllHuds(): void {
  const huds = document.querySelectorAll(`.${HUD_CLASS}`);
  huds.forEach((h) => h.remove());
}

function ensureHud(container: HTMLElement): void {
  if (container.querySelector(`:scope > .${HUD_CLASS}`)) return;
  const bar = container.querySelector(":scope > .surface-bar");
  const hud = buildHud(container);
  if (bar && bar.nextSibling) {
    container.insertBefore(hud, bar.nextSibling);
  } else if (bar) {
    container.appendChild(hud);
  } else {
    container.prepend(hud);
  }
}

function buildHud(container: HTMLElement): HTMLDivElement {
  const hud = document.createElement("div");
  hud.className = `${HUD_CLASS} tau-mono`;
  // Kind (identity) — derived from the tau-pane-{human|agent|mixed}
  // class that applyTauPaneClasses sets in Phase 4.
  const isAgent = container.classList.contains("tau-pane-agent");
  const kind = document.createElement("span");
  kind.className = `tau-hud-kind tau-hud-kind-${isAgent ? "agent" : "human"}`;
  kind.textContent = isAgent ? "AGENT" : "HUMAN";
  hud.replaceChildren(
    kind,
    separator(),
    labeled("model", "—"),
    separator(),
    stateDot(isAgent ? "running" : "idle"),
    labeled("", isAgent ? "running" : "idle"),
    spacer(),
    labeled("tok/s", "—"),
    separator(),
    labeled("$", "0.00"),
    separator(),
    deltaEl(),
  );
  return hud;
}

function labeled(label: string, value: string): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-hud-kv";
  if (label) {
    const l = document.createElement("span");
    l.className = "tau-hud-label";
    l.textContent = label;
    wrap.appendChild(l);
  }
  const v = document.createElement("span");
  v.className = "tau-hud-value";
  v.textContent = value;
  wrap.appendChild(v);
  return wrap;
}

function separator(): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = "tau-hud-sep";
  s.textContent = "·";
  return s;
}

function spacer(): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = "tau-hud-spacer";
  return s;
}

function stateDot(
  state: "running" | "waiting" | "idle" | "streaming",
): HTMLSpanElement {
  const d = document.createElement("span");
  d.className = `tau-hud-state tau-hud-state-${state}`;
  return d;
}

function deltaEl(): HTMLSpanElement {
  const wrap = document.createElement("span");
  wrap.className = "tau-hud-kv tau-hud-delta";
  const l = document.createElement("span");
  l.className = "tau-hud-label";
  l.textContent = "Δ";
  const add = document.createElement("span");
  add.className = "tau-hud-delta-add";
  add.textContent = "+0";
  const sub = document.createElement("span");
  sub.className = "tau-hud-delta-sub";
  sub.textContent = "−0";
  wrap.append(l, add, sub);
  return wrap;
}
