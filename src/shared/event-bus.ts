/**
 * P7 S8 — Typed EventBus<EventMap> seam (A6).
 *
 * τ-mux has ~51 ad-hoc `window.dispatchEvent(new CustomEvent("ht-…", …))`
 * channels spread across native + web-mirror. Each producer types its
 * payload locally, each consumer down-casts via `(e as CustomEvent).detail`,
 * and rename / refactor across the boundary is a manual audit.
 *
 * This module introduces a typed wrapper without breaking back-compat:
 *
 *   - `EventBus<EventMap>` carries the channel-name → payload mapping
 *     in a single type parameter.
 *   - `bus.emit(name, payload)` dispatches the `CustomEvent` on a
 *     target (defaults to `window`) so existing `window.addEventListener`
 *     consumers keep working unchanged.
 *   - `bus.on(name, handler)` subscribes and returns an unsubscribe
 *     thunk. The handler receives the typed payload directly — no
 *     `(e as CustomEvent<X>).detail` boilerplate.
 *
 * Migration strategy is gradual: producers and consumers can switch
 * to the bus independently. A channel where the producer uses
 * `bus.emit` but the consumer still uses `window.addEventListener`
 * keeps working because `emit` still dispatches a real DOM CustomEvent.
 *
 * The default singleton `htEvents` carries the `HtEventMap` for the
 * core τ-mux channels — start migrations there, add new entries to
 * the map as further channels move over.
 */

export interface EventBusTarget {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: EventListenerOptions | boolean,
  ): void;
  dispatchEvent(event: Event): boolean;
}

/** A typed channel name → payload mapping. Producers and consumers
 *  on the same bus share this type so rename is a compile error. */
export class EventBus<EventMap extends Record<string, unknown>> {
  constructor(private readonly target: EventBusTarget) {}

  /** Dispatch `payload` on channel `name`. Returns the underlying
   *  `dispatchEvent` boolean (true unless a listener cancelled). */
  emit<K extends keyof EventMap & string>(
    name: K,
    payload: EventMap[K],
  ): boolean {
    return this.target.dispatchEvent(
      new CustomEvent(name, { detail: payload }),
    );
  }

  /** Subscribe to `name`. Returns an unsubscribe thunk. The handler
   *  is invoked with the typed payload — `e.detail` is unwrapped
   *  for you. */
  on<K extends keyof EventMap & string>(
    name: K,
    handler: (payload: EventMap[K]) => void,
  ): () => void {
    const wrapped = (e: Event) => {
      // CustomEvent.detail is loosely typed in lib.dom; we trust the
      // EventMap contract here. Producers using `emit` always wrap in
      // a CustomEvent; producers still on raw `dispatchEvent` are
      // expected to do the same (the existing convention).
      handler((e as CustomEvent<EventMap[K]>).detail);
    };
    this.target.addEventListener(name, wrapped as EventListener);
    return () =>
      this.target.removeEventListener(name, wrapped as EventListener);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Default τ-mux event map. Add channels here as call sites migrate.
// ─────────────────────────────────────────────────────────────────────

/** Workspaces reorder dispatch — fired by both sidebar mouse drag and
 *  keyboard Alt+Up/Down. Payload is the new id order, newest-first. */
export interface ReorderWorkspacesPayload {
  order: string[];
}

/** Surface focus broadcast. Fires on every focusSurface() transition
 *  with the new focused id (or null if no surface). */
export interface SurfaceFocusedPayload {
  surfaceId: string | null;
}

/** Workspace metadata changed — fired when name / color / ordering
 *  changes need to round-trip through the host. Currently dispatched
 *  with no detail (consumers re-derive from getState); kept void so
 *  call sites stay terse. */
export type WorkspaceChangedPayload = void;

/** Workspaces list changed — fired when the workspace set itself
 *  changes (add/remove/reorder). Consumers re-render summary UI. */
export type WorkspacesChangedPayload = void;

/** Open a file in the editor pane — fired by sidebar file-explorer
 *  double-click and by the editor.open CLI/RPC entry. The sidebar
 *  callers also include a workspaceId hint so the host can target
 *  the right pane group; the editor-side consumer reads only `path`
 *  and `create` today but the field is part of the contract. */
export interface OpenFileInEditorPayload {
  path: string;
  cwd?: string;
  create?: boolean;
  workspaceId?: string;
}

/** Surface close request — sent from sidebar workspace-card close and
 *  pane-bar close button. The receiver wires this to `rpc.send("closeSurface", …)`. */
export interface CloseSurfacePayload {
  surfaceId: string;
}

/** Pane split request — fired by surface-manager and pane-bar split
 *  buttons. `surfaceId` is the existing pane being split; `direction`
 *  picks the new pane's orientation relative to it. */
export interface SplitPayload {
  surfaceId: string;
  direction: "horizontal" | "vertical";
}

/** Show the surface info HUD for `surfaceId` — fired by sidebar
 *  card click + browser pane info button. */
export interface ShowSurfaceInfoPayload {
  surfaceId: string;
}

/** Open a URL externally (system browser / Electron shell). Fired by
 *  port chips, manifest cards, sidebar links. */
export interface OpenExternalPayload {
  url: string;
}

/** Status keys changed for a workspace — fired by ht set-status RPC.
 *  Consumers redraw the workspace card status row. */
export interface StatusesChangedPayload {
  workspaceId: string;
}

/** Sidebar toggle — fired by the sidebar header button after the
 *  internal `visible` flag has flipped. `visible` reports the new
 *  state so listeners can sync without re-reading the DOM. */
export interface SidebarTogglePayload {
  visible: boolean;
}

/** Sidebar resize committed (mouse-up after drag). The host persists
 *  the new width through `updateSettings`. */
export interface SidebarResizeCommitPayload {
  width: number;
}

/** Focus the surface that emitted a sidebar notification. Fired by
 *  the sidebar item body click. */
export interface FocusNotificationSourcePayload {
  notificationId: string;
  surfaceId: string;
}

// ─────────────────────────────────────────────────────────────────────
// P7 S10 — A6 batch 3 payloads.
// ─────────────────────────────────────────────────────────────────────

/** Agent toolbar — model picker selection. `provider` selects the
 *  backend, `modelId` is the provider-specific identifier. */
export interface AgentSetModelPayload {
  agentId: string;
  provider: string;
  modelId: string;
}

/** Agent toolbar — thinking-level picker selection. The level is a
 *  free-form string the agent host interprets (e.g. "low", "med",
 *  "high"). */
export interface AgentSetThinkingPayload {
  agentId: string;
  level: string;
}

/** Telegram pane — outbound send request. */
export interface TelegramSendPayload {
  chatId: string;
  text: string;
}

/** Telegram pane — history request for backwards-pagination on scroll
 *  up. `before` is the inclusive upper-bound id; omitted means "the
 *  latest page". */
export interface TelegramRequestHistoryPayload {
  chatId: string;
  before?: number;
}

/** Telegram pane — async re-sync of the state snapshot. Void payload. */
export type TelegramRequestStatePayload = void;

/** Split a new editor pane. `path` is optional — when omitted the new
 *  pane opens a blank buffer. */
export interface SplitEditorPayload {
  path?: string;
  direction: "horizontal" | "vertical";
}

/** Sidebar cwd-chip click → tell the host this cwd is the workspace's
 *  primary directory. Re-runs the package.json / cargo card resolve. */
export interface SelectWorkspaceCwdPayload {
  workspaceId: string;
  cwd: string;
}

/** Workspace rename committed via the sidebar inline editor. */
export interface RenameWorkspacePayload {
  workspaceId: string;
  name: string;
}

/** Workspace pin toggle from the sidebar context menu / keyboard. */
export interface PinWorkspacePayload {
  workspaceId: string;
  pinned: boolean;
}

export interface HtEventMap extends Record<string, unknown> {
  "ht-reorder-workspaces": ReorderWorkspacesPayload;
  "ht-surface-focused": SurfaceFocusedPayload;
  "ht-workspace-changed": WorkspaceChangedPayload;
  "ht-workspaces-changed": WorkspacesChangedPayload;
  "ht-open-file-in-editor": OpenFileInEditorPayload;
  // P7 S9 — A6 batch 2 channels.
  "ht-close-surface": CloseSurfacePayload;
  "ht-split": SplitPayload;
  "ht-show-surface-info": ShowSurfaceInfoPayload;
  "ht-open-external": OpenExternalPayload;
  "ht-statuses-changed": StatusesChangedPayload;
  "ht-sidebar-toggle": SidebarTogglePayload;
  "ht-sidebar-resize-commit": SidebarResizeCommitPayload;
  "ht-focus-notification-source": FocusNotificationSourcePayload;
  // P7 S10 — A6 batch 3 channels.
  "ht-agent-set-model": AgentSetModelPayload;
  "ht-agent-set-thinking": AgentSetThinkingPayload;
  "ht-telegram-send": TelegramSendPayload;
  "ht-telegram-request-history": TelegramRequestHistoryPayload;
  "ht-telegram-request-state": TelegramRequestStatePayload;
  "ht-split-editor": SplitEditorPayload;
  "ht-select-workspace-cwd": SelectWorkspaceCwdPayload;
  "ht-rename-workspace": RenameWorkspacePayload;
  "ht-pin-workspace": PinWorkspacePayload;
}

/** Singleton bus that dispatches on `window`. Importers can grab this
 *  directly or instantiate their own `EventBus<MyMap>(target)` for
 *  unit tests with an isolated target.
 *
 *  Guarded for SSR / pre-mount: if `window` isn't defined yet, the
 *  consumer should construct their own bus with an explicit target. */
export const htEvents: EventBus<HtEventMap> =
  typeof window !== "undefined"
    ? new EventBus<HtEventMap>(window)
    : new EventBus<HtEventMap>(makeNoopTarget());

/** Tiny no-op target so `htEvents` is constructible without `window`.
 *  In practice the module always loads in a window'd context; this
 *  exists so a Node-side accidental import doesn't crash at module
 *  load time. */
function makeNoopTarget(): EventBusTarget {
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
}
