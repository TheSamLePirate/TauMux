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

  // Three sibling zone elements; rebuilt on every render. The shared
  // renderers each return a fresh DOM node, so a full rebuild is
  // cheaper than tracking which key produced which element. Render
  // is gated to ~1 Hz from the clock interval and to the dispatch
  // wakeup count from the store, both small.
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

  function paintZone(zoneEl: HTMLElement, keys: readonly string[]): void {
    zoneEl.replaceChildren();
    const ctx = buildContext(store, now());
    keys.forEach((id, i) => {
      const node = renderStatusKey(id, ctx);
      if (!node) return;
      if (i > 0 && zoneEl.childElementCount > 0) {
        const sep = document.createElement("span");
        sep.className = "tau-hud-sep";
        sep.textContent = "·";
        zoneEl.appendChild(sep);
      }
      zoneEl.appendChild(node);
    });
  }

  function render(): void {
    paintZone(identityEl, identity);
    paintZone(metersEl, meters);
    paintZone(focusEl, focus);
  }

  // Wake up on every store change (workspace switch, focus, metadata
  // tick, ht-keys-seen update, settings/apply…). The store dispatches
  // are coalesced upstream (rAF), so this is one call per frame max.
  const unsubscribe = store.subscribe(() => {
    render();
  });

  // 1 Hz tick keeps the clock + uptime keys honest even during idle
  // periods when no metadata broadcast lands. Cheap because the zone
  // paints clear + rebuild a handful of inline spans.
  const tickHandle = setInterval(render, 1000);
  if (typeof (tickHandle as { unref?: () => void }).unref === "function") {
    (tickHandle as { unref?: () => void }).unref!();
  }

  return {
    render,
    dispose() {
      unsubscribe();
      clearInterval(tickHandle);
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
