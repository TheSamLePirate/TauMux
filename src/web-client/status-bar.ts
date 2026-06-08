// τ-mux web-mirror bottom status bar.
//
// Three zones (identity / meters / focus) populated by the shared
// status-key registry (`src/shared/status-keys.ts`). The shared
// registry holds 19 data-driven renderers — workspace identity, CPU
// + memory meters, focused-pane fg/cwd/branch/ports, time/uptime
// clocks, and the `ht set-status` bridge keys. Native registers two
// additional DOM-querying renderers (`model`, `kind`) on top; those
// are not exercised here because the web mirror's pane chrome
// doesn't expose the same data attributes.
//
// The view subscribes to the store and re-renders on every state
// change. A 1 Hz `setInterval` covers wall-clock keys (`time`,
// `uptime`) that don't tick on store events.
//
// Mount:
//   const view = createStatusBarView({ store, hostEl });
//   ...later: view.dispose();
//
// CSS lives in `src/web-client/client.css` (`.tau-status-bar*` rules
// copied verbatim from `src/views/terminal/index.css`).

import {
  renderStatusKey,
  type HtStatusEntry,
  type StatusContext,
  type StatusPmSurface,
  type StatusPmWorkspace,
  type StatusWorkspaceInfo,
} from "../shared/status-keys";
import type { Store } from "./store";

/** Hard-coded zone split — mirror of the native `index.ts` placement
 *  for v1. Plan #13 may expose this through `AppSettings` later. */
const IDENTITY_KEYS = ["workspace", "panes", "workspaces"] as const;
const METERS_KEYS = ["cpu", "mem"] as const;
const FOCUS_KEYS = ["fg", "cwd", "branch"] as const;

/** Optional overrides used by tests + a future settings entry. The
 *  defaults are the ones above; pass an array on construction to
 *  remap a zone. */
export interface StatusBarZones {
  identity?: readonly string[];
  meters?: readonly string[];
  focus?: readonly string[];
}

export interface StatusBarOptions {
  store: Store;
  hostEl: HTMLElement;
  /** Optional override for the three zones. */
  zones?: StatusBarZones;
  /** Optional clock injection for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export interface StatusBarView {
  /** Force a render; normally driven by the store subscription. */
  render(): void;
  /** Tear down the subscription + clock interval. */
  dispose(): void;
}

export function createStatusBarView(opts: StatusBarOptions): StatusBarView {
  const { store, hostEl, zones, now = () => Date.now() } = opts;
  const identity = zones?.identity ?? IDENTITY_KEYS;
  const meters = zones?.meters ?? METERS_KEYS;
  const focus = zones?.focus ?? FOCUS_KEYS;

  // Three sibling zone elements. Each zone keeps a per-zone signature
  // (W2-STATUSBAR-WEB): a render builds into an off-DOM scratch, hashes its
  // innerHTML, and only swaps the live zone when the markup actually changed
  // — so an unchanged zone never repaints (and an unchanged chart SVG is
  // never torn down). This brings the web bar to parity with the native
  // bar's sig-skip (index.ts) + the v0.3.185 status-grid reconcile.
  hostEl.classList.add("tau-status-bar");
  const identityEl = document.createElement("div");
  identityEl.className = "tau-status-zone tau-status-zone-identity";
  const metersEl = document.createElement("div");
  metersEl.className = "tau-status-zone tau-status-zone-meters";
  const focusEl = document.createElement("div");
  focusEl.className = "tau-status-zone tau-status-zone-focus";
  hostEl.appendChild(identityEl);
  hostEl.appendChild(metersEl);
  hostEl.appendChild(focusEl);

  function paintZone(
    zoneEl: HTMLElement,
    keys: readonly string[],
    ctx: StatusContext,
  ): void {
    const scratch = document.createElement("div");
    keys.forEach((id, i) => {
      const node = renderStatusKey(id, ctx);
      if (!node) return;
      if (i > 0 && scratch.childElementCount > 0) {
        const sep = document.createElement("span");
        sep.className = "tau-hud-sep";
        sep.textContent = "·";
        scratch.appendChild(sep);
      }
      scratch.appendChild(node);
    });
    const sig = scratch.innerHTML;
    if (zoneEl.dataset["sig"] === sig) return; // unchanged — skip the swap
    zoneEl.dataset["sig"] = sig;
    zoneEl.replaceChildren(...scratch.childNodes);
  }

  function render(): void {
    // Build the context ONCE per render (was 3×, once per zone).
    const ctx = buildContext(store, now());
    paintZone(identityEl, identity, ctx);
    paintZone(metersEl, meters, ctx);
    paintZone(focusEl, focus, ctx);
  }

  // rAF-coalesce the store + clock wakeups. `connection`/`seq` mint a new
  // top-level state object on EVERY inbound WS frame (including terminal
  // output), so a raw subscribe would rebuild the bar at terminal-output
  // rate; the rAF collapse caps that to one render per frame, and the
  // per-zone sig-skip makes a no-movement frame free. The public `render()`
  // stays synchronous so tests (and the initial paint) repaint immediately.
  let scheduled = false;
  let disposed = false;
  let rafId: number | null = null;
  const schedule = (): void => {
    if (scheduled || disposed) return;
    scheduled = true;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      scheduled = false;
      if (!disposed) render();
    });
  };

  const unsubscribe = store.subscribe(schedule);

  // 1 Hz tick keeps the clock + uptime keys honest even during idle periods
  // when no metadata broadcast lands. Routed through the same coalescer.
  const tickHandle = setInterval(schedule, 1000);
  if (typeof (tickHandle as { unref?: () => void }).unref === "function") {
    (tickHandle as { unref?: () => void }).unref!();
  }

  return {
    render,
    dispose() {
      disposed = true;
      unsubscribe();
      clearInterval(tickHandle);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      hostEl.replaceChildren();
      hostEl.classList.remove("tau-status-bar");
    },
  };
}

// ─── StatusContext projection ──────────────────────────────────
//
// The shared registry is fed by `StatusContext`, a snapshot of the
// data needed by the renderers. Native builds it from
// `surfaceManager` / `pmData`; the web mirror builds it from
// `AppState`. The shape is the same so the same renderer code runs.

function buildContext(store: Store, now: number): StatusContext {
  const state = store.getState();

  const workspaces: StatusWorkspaceInfo[] = state.workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    color: w.color,
    surfaceIds: w.surfaceIds.slice(),
  }));
  const activeWorkspaceId = state.activeWorkspaceId;
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  // Process-manager projection: each surface carries its own metadata
  // already in the store (broadcast from the host). Bundle them per-
  // workspace so the load + procs renderers can aggregate.
  const pmData: StatusPmWorkspace[] = state.workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    color: w.color,
    active: w.id === activeWorkspaceId,
    surfaces: w.surfaceIds.map<StatusPmSurface>((sid) => {
      const surf = state.surfaces[sid];
      return {
        id: sid,
        title: surf?.title ?? sid,
        metadata: surf?.metadata ?? null,
      };
    }),
  }));
  const pmActive = pmData.find((p) => p.active);

  const focusedSurfaceId = state.focusedSurfaceId;
  const focusedSurface: StatusPmSurface | undefined =
    pmActive && focusedSurfaceId
      ? pmActive.surfaces.find((s) => s.id === focusedSurfaceId)
      : undefined;

  const notifyWorkspaces = new Set<string>();
  for (const n of state.sidebar.notifications) {
    if (!n.surfaceId) continue;
    const ws = state.workspaces.find((w) =>
      w.surfaceIds.includes(n.surfaceId!),
    );
    if (ws) notifyWorkspaces.add(ws.id);
  }

  // `ht set-status` bridge: pull the active-workspace status pills
  // from the sidebar slice and surface them as ordered entries. The
  // shared renderer respects `htStatusKeyOrder` + `htStatusKeyHidden`
  // for ordering; we just project the per-key values here.
  const htStatuses: HtStatusEntry[] = [];
  if (activeWorkspaceId) {
    const bucket = state.sidebar.status[activeWorkspaceId] ?? {};
    for (const key of Object.keys(bucket)) {
      const entry = bucket[key]!;
      htStatuses.push({
        key,
        value: entry.value,
        icon: entry.icon,
        color: entry.color,
      });
    }
  }

  return {
    settings: {
      htStatusKeyOrder: state.settings?.htStatusKeyOrder ?? [],
      htStatusKeyHidden: state.settings?.htStatusKeyHidden ?? [],
      statusBarKeys: state.settings?.statusBarKeys ?? [],
    },
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    pmData,
    pmActive,
    focusedSurfaceId,
    focusedSurface,
    notifyWorkspaces,
    htStatuses,
    now,
  };
}
