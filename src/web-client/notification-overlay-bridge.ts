// Web-mirror notification overlay bridge.
//
// Wires the shared `NotificationOverlay` (moved to
// `src/shared/notification-overlay.ts` in M15) to the web client's
// store + transport + per-surface `terms[id].el` host map.
//
// The shared manager owns the per-surface stack DOM, the auto-dismiss
// timers, and the click semantics. This bridge only:
//   1. Translates store deltas (`state.sidebar.notifications` adds /
//      removes / clears) into `overlay.show()` / `overlay.dismiss()`
//      / `overlay.dismissAll()` calls.
//   2. Pushes settings updates (`overlayEnabled` + `overlayMs`) into
//      `overlay.setOptions(...)` whenever they change on the wire.
//   3. Routes the three overlay hooks (`onCardActivate`,
//      `onCardDismiss`, `onOverflowClick`) into the existing
//      transport (`dismissNotification`, `focusSurface`) and the
//      sidebar visibility action.
//
// `nativeViewport` mode caveat: when the web mirror is rendering at
// a CSS scale (a remote on a 4k showing a 1080p native window), the
// pane container inherits a `transform: scale(...)`. Mounting the
// overlay inside that container makes the card render at the scaled
// size, which we want — the user sees a card that visually matches
// the rest of the pane. No special handling needed for v1.

import { ICONS } from "./icons";
import {
  NotificationOverlay,
  type CreateIconFn,
  type NotificationOverlayPayload,
} from "../shared/notification-overlay";
import type { AppState, Store } from "./store";
import type { NotificationEntry } from "../shared/web-protocol";

export interface NotificationOverlayBridgeDeps {
  store: Store;
  sendMsg: (type: string, payload: Record<string, unknown>) => void;
  /** Per-surface DOM map maintained by main.ts. The bridge looks up
   *  `terms[surfaceId]?.el` lazily at show-time so a notification
   *  arriving before the surface mounts is queued and replayed. */
  getSurfaceContainer: (surfaceId: string) => HTMLElement | null;
}

export interface NotificationOverlayBridge {
  /** Notification arrived for `surfaceId` but its container isn't
   *  mounted yet — call this when the pane is created so the queued
   *  card lands in the right host. */
  flushQueueForSurface(surfaceId: string): void;
  /** Surface gone. Drops the per-surface stack DOM + timers. */
  forgetSurface(surfaceId: string): void;
  /** Page lifecycle teardown — clears every overlay + timer. */
  dispose(): void;
}

const overlayCreateIcon: CreateIconFn = (_name, cls, size) => {
  // Web bundle ships a single inline-SVG `close` glyph in
  // `src/web-client/icons.ts`; reuse it. ICONS.close is a 16×16 SVG
  // string — rebuild via an SVG namespace insertion so the size +
  // optional class prop apply.
  const wrap = document.createElement("span");
  wrap.innerHTML = ICONS.close;
  const svg = wrap.firstChild as SVGSVGElement | null;
  if (svg) {
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    if (cls) svg.setAttribute("class", cls);
    return svg;
  }
  // Fallback (ICONS.close should never be empty, but keep the type
  // safety honest): a plain text "×" so the close button still works.
  const fallback = document.createElement("span");
  fallback.textContent = "×";
  return fallback;
};

export function createNotificationOverlayBridge(
  deps: NotificationOverlayBridgeDeps,
): NotificationOverlayBridge {
  const { store, sendMsg, getSurfaceContainer } = deps;

  // Notifications that arrived before their surface mounted. Drained
  // by `flushQueueForSurface(surfaceId)` from main.ts the moment the
  // pane is created.
  const pendingBySurface = new Map<string, NotificationOverlayPayload[]>();

  const overlay = new NotificationOverlay(
    {
      onCardActivate: ({ id, surfaceId }) => {
        // Optimistic local dismiss so the card disappears instantly;
        // server echo via `notificationDismiss` is idempotent.
        overlay.dismiss(surfaceId, id);
        store.dispatch({ kind: "notification/remove", id });
        sendMsg("dismissNotification", { id });
        sendMsg("focusSurface", { surfaceId });
      },
      onCardDismiss: ({ id, surfaceId }) => {
        overlay.dismiss(surfaceId, id);
        store.dispatch({ kind: "notification/remove", id });
        sendMsg("dismissNotification", { id });
      },
      onOverflowClick: () => {
        store.dispatch({ kind: "sidebar/visible", visible: true });
        sendMsg("sidebarToggle", { visible: true });
      },
    },
    { createIcon: overlayCreateIcon },
  );

  // Push the initial settings (defaults match the native overlay
  // settings until a `settingsSnapshot` envelope lands).
  applySettings(store.getState());
  // Queue the hello-time snapshot's existing notifications so that
  // every floating overlay we missed before bridge construction
  // doesn't get silently dropped.
  for (const n of store.getState().sidebar.notifications) showOrQueue(n);

  // Track the prior notification id set + settings ref so we only
  // act on real deltas. The store listener fires on every dispatch;
  // diffing here is cheaper than re-mounting the overlay every tick.
  let prevIds = new Set(
    store.getState().sidebar.notifications.map((n) => n.id),
  );
  let prevSettings = store.getState().settings;

  const unsubscribe = store.subscribe((state) => {
    if (state.settings !== prevSettings) {
      applySettings(state);
      prevSettings = state.settings;
    }
    const nextEntries = state.sidebar.notifications;
    const nextIds = new Set(nextEntries.map((n) => n.id));

    // Removed entries → dismiss + drop from pending queue.
    for (const id of prevIds) {
      if (nextIds.has(id)) continue;
      // We don't know the surface from here; sweep every stack — the
      // shared `dismiss(surfaceId, id)` early-returns on misses.
      for (const n of state.sidebar.notifications) {
        if (n.surfaceId) overlay.dismiss(n.surfaceId, id);
      }
      // Also try every surface key in the pending queue.
      for (const surfaceId of pendingBySurface.keys()) {
        overlay.dismiss(surfaceId, id);
      }
      dropPending(id);
    }
    // Added entries → show on the right surface (or queue if not
    // mounted yet).
    for (const n of nextEntries) {
      if (prevIds.has(n.id)) continue;
      showOrQueue(n);
    }
    prevIds = nextIds;
  });

  function showOrQueue(n: NotificationEntry): void {
    if (!n.surfaceId) return; // overlay only renders surface-bound notifications
    const payload: NotificationOverlayPayload = {
      id: n.id,
      surfaceId: n.surfaceId,
      title: n.title,
      body: n.body,
      time: n.at,
    };
    const host = getSurfaceContainer(n.surfaceId);
    if (host) {
      overlay.show(host, payload);
      return;
    }
    const list = pendingBySurface.get(n.surfaceId) ?? [];
    list.push(payload);
    pendingBySurface.set(n.surfaceId, list);
  }

  function dropPending(id: string): void {
    for (const [sid, list] of pendingBySurface) {
      const idx = list.findIndex((p) => p.id === id);
      if (idx === -1) continue;
      list.splice(idx, 1);
      if (list.length === 0) pendingBySurface.delete(sid);
    }
  }

  function applySettings(state: AppState): void {
    overlay.setOptions({
      enabled: state.settings?.notificationOverlayEnabled ?? true,
      autoDismissMs: state.settings?.notificationOverlayMs ?? 6000,
    });
  }

  return {
    flushQueueForSurface(surfaceId) {
      const queued = pendingBySurface.get(surfaceId);
      if (!queued || queued.length === 0) return;
      const host = getSurfaceContainer(surfaceId);
      if (!host) return;
      // Drain in arrival order so the user sees the oldest queued
      // card first when several piled up.
      pendingBySurface.delete(surfaceId);
      for (const payload of queued) overlay.show(host, payload);
    },
    forgetSurface(surfaceId) {
      overlay.forgetSurface(surfaceId);
      pendingBySurface.delete(surfaceId);
    },
    dispose() {
      unsubscribe();
      overlay.destroy();
      pendingBySurface.clear();
    },
  };
}
