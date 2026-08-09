/**
 * τ-mux variant: Atlas — the topology instrument.
 *
 * Source: design_guidelines/Design Guidelines tau-mux.md §9.3, rebuilt.
 * Rationale and the full encoding table live in `doc/tracking_atlas_aaa.md`.
 *
 * Atlas replaces the list sidebar with a live graph of everything τ-mux
 * is running — workspaces, panes, the Claude Code sessions inside them,
 * their processes, ports, git state and cost — and gives that graph the
 * actions to clear whatever it surfaces.
 *
 * Three pieces of chrome, all created on `enter()` and removed on
 * `exit()`:
 *
 *   1. the Atlas panel inside `#sidebar` (header · graph · inspector);
 *   2. a 44 px workspace rail that *is* the panel's collapsed state
 *      (⌘\), not a permanent sibling — v1 kept both on screen at once,
 *      which meant 36 px of chrome restating the graph beside it;
 *   3. the τ brand cap on the status bar, so Atlas still reads as Atlas.
 *
 * The existing sidebar content is hidden rather than destroyed, so
 * switching back to Bridge or Cockpit restores it with no state loss.
 */
import type { VariantContext, VariantHandle } from "./types";
import { IconTau } from "../tau-icons";
import { htEvents } from "../../../shared/event-bus";
import { variantContext as variantHandles } from "./variant-context";
import { AtlasPanel } from "../atlas/panel";
import type { AtlasEmitters } from "../atlas/snapshot";
import type { AskUserRequest } from "../../../shared/types";

const PANEL_HOST_ID = "tau-atlas-graph";
const RAIL_ID = "tau-atlas-rail";

let panel: AtlasPanel | null = null;

/** Injected by the host at boot so the graph can flag a pane that has a
 *  question waiting, without `atlas/` importing the ask-user modal. */
let questionSource: {
  pendingQuestions: () => readonly AskUserRequest[];
  onQuestionsChanged: (fn: () => void) => () => void;
} | null = null;

export function setAtlasQuestionSource(source: {
  pendingQuestions: () => readonly AskUserRequest[];
  onQuestionsChanged: (fn: () => void) => () => void;
}): void {
  questionSource = source;
}

/** The action surface the graph offers. Kept here rather than inside
 *  `atlas/` so the graph modules stay free of τ-mux's event contracts
 *  and remain renderable against fixtures. */
const emitters: AtlasEmitters = {
  closeSurface: (surfaceId) => htEvents.emit("ht-close-surface", { surfaceId }),
  approveClaude: (surfaceId) =>
    htEvents.emit("ht-claude-approve", surfaceId ? { surfaceId } : {}),
  interruptClaude: (surfaceId) =>
    htEvents.emit("ht-claude-agent-interrupt", { surfaceId }),
  showSurfaceInfo: (surfaceId) =>
    htEvents.emit("ht-show-surface-info", { surfaceId }),
  openExternal: (url) => htEvents.emit("ht-open-external", { url }),
};

export const AtlasVariant: VariantHandle = {
  id: "atlas",

  enter(ctx) {
    ctx.body.dataset["tauVariant"] = "atlas";
    mountPanel();
    mountRail();
    mountBrandCap(ctx);
  },

  exit(ctx) {
    delete ctx.body.dataset["tauVariant"];
    unmountPanel();
    unmountRail();
    unmountBrandCap(ctx);
  },
};

/** ⌘G — open or close the full-window topology. Exported so the
 *  keyboard binding in `index.ts` does not need a handle on the panel. */
export function toggleAtlasTopology(): boolean {
  if (!panel) return false;
  panel.toggleOverlay();
  return true;
}

// ─────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────

function mountPanel(): void {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  let host = document.getElementById(PANEL_HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = PANEL_HOST_ID;
    host.className = "tau-atlas-graph";
    sidebar.prepend(host);
  }
  // Idempotent: `enter()` runs again on every settings change, and a
  // second mount would orphan the first panel's listeners. A panel whose
  // element has been detached (the host was replaced under us) is stale,
  // not live — tear it down and mount fresh rather than leaving the
  // column empty.
  if (panel) {
    if (panel.element.isConnected) return;
    panel.destroy();
  }
  panel = new AtlasPanel({
    emit: emitters,
    ...(questionSource ? questionSource : {}),
  });
  panel.mount(host);
}

function unmountPanel(): void {
  panel?.destroy();
  panel = null;
  document.getElementById(PANEL_HOST_ID)?.remove();
}

// ─────────────────────────────────────────────────────────────
// Collapsed rail — one glyph per workspace, agent + alert dots.
// Only visible while the column is collapsed; the graph is the
// authority whenever it has room to render.
// ─────────────────────────────────────────────────────────────

function mountRail(): void {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  let rail = document.getElementById(RAIL_ID);
  if (!rail) {
    rail = document.createElement("div");
    rail.id = RAIL_ID;
    rail.className = "tau-atlas-rail";
    sidebar.appendChild(rail);
  }
  renderRail(rail);
  if (!railRefresh) {
    railRefresh = () => {
      const el = document.getElementById(RAIL_ID);
      if (el) renderRail(el);
    };
    window.addEventListener("ht-workspaces-changed", railRefresh);
    window.addEventListener("ht-surface-focused", railRefresh);
    window.addEventListener("ht-notify-state-changed", railRefresh);
  }
}

let railRefresh: (() => void) | null = null;

function unmountRail(): void {
  document.getElementById(RAIL_ID)?.remove();
  if (railRefresh) {
    window.removeEventListener("ht-workspaces-changed", railRefresh);
    window.removeEventListener("ht-surface-focused", railRefresh);
    window.removeEventListener("ht-notify-state-changed", railRefresh);
    railRefresh = null;
  }
}

interface RailSurfaceManager {
  getWorkspaceState?: () => {
    workspaces: { id: string; name: string; color?: string }[];
    activeWorkspaceId: string | null | undefined;
  };
  focusWorkspaceByIndex?: (index: number) => void;
}

function renderRail(rail: HTMLElement): void {
  const sm = variantHandles.getSurfaceManager() as RailSurfaceManager | null;
  const state = sm?.getWorkspaceState?.();
  const workspaces = state?.workspaces ?? [];
  const notify = variantHandles.getNotifyWorkspaces();
  rail.replaceChildren(
    ...workspaces.map((ws, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tau-atlas-rail-btn";
      btn.title = ws.name;
      btn.setAttribute("aria-label", ws.name);
      if (ws.id === state?.activeWorkspaceId) btn.classList.add("is-active");
      if (notify.has(ws.id)) btn.classList.add("has-alert");
      if (ws.color) btn.style.setProperty("--node", ws.color);
      const glyph = document.createElement("span");
      glyph.className = "tau-atlas-rail-glyph";
      const first = (ws.name ?? "").trim().match(/[A-Za-z0-9]/);
      glyph.textContent = first ? first[0]!.toUpperCase() : String(index + 1);
      btn.appendChild(glyph);
      btn.addEventListener("click", () => sm?.focusWorkspaceByIndex?.(index));
      return btn;
    }),
  );
}

// ─────────────────────────────────────────────────────────────
// Status-bar brand cap. The bottom bar is otherwise the shared
// status-key strip — an animated ticker there was harder to read
// than useful and was removed in an earlier pass.
// ─────────────────────────────────────────────────────────────

function mountBrandCap(ctx: VariantContext): void {
  ctx.statusBar.classList.add("tau-atlas-ticker");
  ctx.statusBar.replaceChildren();
  const brand = document.createElement("div");
  brand.className = "tau-atlas-ticker-brand";
  brand.appendChild(IconTau({ size: 14 }));
  const right = document.createElement("div");
  right.className = "tau-atlas-ticker-right tau-mono";
  right.id = "tau-atlas-ticker-right";
  ctx.statusBar.append(brand, right);
}

function unmountBrandCap(ctx: VariantContext): void {
  ctx.statusBar.classList.remove("tau-atlas-ticker");
  ctx.statusBar.replaceChildren();
  ctx.statusBar.dispatchEvent(new CustomEvent("tau-status-bar-reset"));
}
