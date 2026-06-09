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

/** Split a new extension pane running the same extension. */
export interface SplitExtensionPayload {
  extensionId: string;
  direction: "horizontal" | "vertical";
}

/** Extension iframe → host bridge message (relayed to bun as
 *  `extensionFrontendMessage`). `payload` is an opaque
 *  `ExtensionFrontendPayload`. */
export interface ExtensionFrontendMessagePayload {
  surfaceId: string;
  payload: import("./extension-types").ExtensionFrontendPayload;
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

// ─────────────────────────────────────────────────────────────────────
// P7 S11 — A6 batch 4 payloads.
// ─────────────────────────────────────────────────────────────────────

/** Dismiss one notification by id — fired by sidebar dismiss + overlay
 *  close button. */
export interface DismissNotificationPayload {
  id: string;
}

/** Clear every notification — sidebar header clear button + ht CLI
 *  notification.clear. Void payload. */
export type ClearNotificationsPayload = void;

/** Clear log history — sidebar header clear button on the logs
 *  section. Void payload. */
export type ClearLogsPayload = void;

/** Cookie store maintenance from the Settings panel. Import accepts a
 *  raw text payload auto-detected as JSON or Netscape format by the
 *  Settings producer; export streams the current store back; clear is
 *  destructive. */
export interface CookieImportPayload {
  data: string;
  format: "json" | "netscape";
}
export interface CookieExportPayload {
  format: "json";
}
export type CookieClearPayload = void;

/** Editor pane file IO requests routed through the host: read seeds
 *  the buffer, save commits, reload re-reads from disk discarding the
 *  buffer. `expectedMtimeMs` round-trips so the save handler can spot
 *  out-of-band edits (P7 S5 save-race UX). */
export interface EditorReadFilePayload {
  surfaceId: string;
  path: string;
  create?: boolean;
}
export interface EditorSaveFilePayload {
  surfaceId: string;
  path: string;
  content: string;
  expectedMtimeMs: number | null;
}
export interface EditorReloadFilePayload {
  surfaceId: string;
  path: string;
}

/** Create a new (terminal) workspace. Void payload — the host owns
 *  the cwd / shell defaults. */
export type NewWorkspacePayload = void;

/** Focus a surface programmatically — sidebar notification-source
 *  click + cmd-palette result. */
export interface FocusSurfacePayload {
  surfaceId: string;
}

/** Aggregate notify state across the workspace set. Producers
 *  rebuild this on every notification arrival / dismissal so the
 *  variant chrome can highlight workspaces with pending notifs. */
export interface NotifyStateChangedPayload {
  surfaces: string[];
  workspaces: string[];
}

/** Context-menu requests. Both share the `NativeContextMenuRequest`
 *  discriminated union from `src/shared/types.ts`. The sidebar fires
 *  the generic `ht-open-context-menu` (workspace OR surface flavour);
 *  the pane bar fires the surface-only `ht-open-surface-context-menu`
 *  so the host can apply different action sets. */
export type OpenContextMenuPayload = import("./types").NativeContextMenuRequest;
export type OpenSurfaceContextMenuPayload =
  import("./types").SurfaceContextMenuRequest;

/** Open the Process Manager overlay. The sidebar CPU-bar producer
 *  includes a `workspaceId` hint so the overlay focuses the right
 *  workspace; keyboard / cmd-palette callers omit the hint and let
 *  the overlay read the focused workspace from app state. */
export interface OpenProcessManagerPayload {
  workspaceId?: string;
}

/** Run a manifest-card script (npm script / cargo action). Carries
 *  enough context that the host doesn't need to re-resolve the cwd. */
export interface RunScriptPayload {
  workspaceId: string;
  cwd: string;
  scriptKey: string;
  /** When present, used verbatim; otherwise synthesised from the
   *  configured packageRunner + scriptKey. */
  command?: string;
}

// ─────────────────────────────────────────────────────────────────────
// P7 S12 — A6 batch 5 payloads (browser-pane internals + agent
// callbacks). These channels close the migration: 0 raw producers
// remain in the native code after this batch.
// ─────────────────────────────────────────────────────────────────────

/** Browser pane navigation event — fired after the webview commits a
 *  navigation. `title` may be empty if the page hasn't reported one
 *  yet; consumers should keep the prior title until a separate
 *  `ht-browser-title-changed` arrives. */
export interface BrowserNavigatedPayload {
  surfaceId: string;
  url: string;
  title: string;
}

/** Browser pane title change. Fired independently of navigation so
 *  pages that update `document.title` after load (SPA route
 *  changes) still flow through. */
export interface BrowserTitleChangedPayload {
  surfaceId: string;
  title: string;
}

/** Browser pane evalJs response. `result` is JSON-stringified by the
 *  webview side (undefined when the eval threw or returned nothing);
 *  `error` is the message string when the eval threw. */
export interface BrowserEvalResultPayload {
  surfaceId: string;
  reqId: string;
  result: string | undefined;
  error?: string;
}

/** Browser pane console capture from the OOPIF preload. */
export interface BrowserConsoleLogPayload {
  surfaceId: string;
  level: string;
  args: string[];
  timestamp: number;
}

/** Browser pane uncaught error from the OOPIF preload. */
export interface BrowserErrorPayload {
  surfaceId: string;
  message: string;
  filename?: string;
  lineno?: number;
  timestamp: number;
}

/** Browser pane DOMContentLoaded — used as the "page is interactive"
 *  cue for the host's eval queue + the snapshot RPC. */
export interface BrowserDomReadyPayload {
  surfaceId: string;
  url: string;
}

/** Browser pane zoom change. Fired by SurfaceManager.setBrowserZoom
 *  so the bun side can persist the value across restarts. */
export interface BrowserZoomPayload {
  surfaceId: string;
  zoom: number;
}

/** Agent pane prompt submission. `message` is the user text; `images`
 *  is the optional ordered list of image attachments — typed as the
 *  `ImageAttachment` shape from the agent-panel module so the host
 *  doesn't have to reshape them. */
export interface AgentPromptPayload {
  agentId: string;
  message: string;
  images?: import("../views/terminal/agent-panel-utils").ImageAttachment[];
}

/** Agent pane shared shape for the four no-payload agent commands —
 *  abort, new-session, compact, get-models, get-state. All carry
 *  just the targeted agentId so the host knows which subprocess to
 *  signal. */
export interface AgentCommandPayload {
  agentId: string;
}

/** Agent pane restart request — fired when the user clicks "Restart" on
 *  a dead (exited) agent pane (H13). Carries the dead surface id so the
 *  host can close the husk, plus the provider/model/thinking the panel
 *  knew so the replacement agent comes back configured the same. */
export interface AgentRestartPayload {
  surfaceId: string;
  provider?: string;
  model?: string;
  thinkingLevel?: string;
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
  "ht-split-extension": SplitExtensionPayload;
  "ht-extension-frontend-message": ExtensionFrontendMessagePayload;
  "ht-select-workspace-cwd": SelectWorkspaceCwdPayload;
  "ht-rename-workspace": RenameWorkspacePayload;
  "ht-pin-workspace": PinWorkspacePayload;
  // P7 S11 — A6 batch 4 channels.
  "ht-dismiss-notification": DismissNotificationPayload;
  "ht-clear-notifications": ClearNotificationsPayload;
  "ht-clear-logs": ClearLogsPayload;
  "ht-cookie-import": CookieImportPayload;
  "ht-cookie-export": CookieExportPayload;
  "ht-cookie-clear": CookieClearPayload;
  "ht-editor-read-file": EditorReadFilePayload;
  "ht-editor-save-file": EditorSaveFilePayload;
  "ht-editor-reload-file": EditorReloadFilePayload;
  "ht-new-workspace": NewWorkspacePayload;
  "ht-focus-surface": FocusSurfacePayload;
  "ht-notify-state-changed": NotifyStateChangedPayload;
  "ht-open-context-menu": OpenContextMenuPayload;
  "ht-open-surface-context-menu": OpenSurfaceContextMenuPayload;
  "ht-open-process-manager": OpenProcessManagerPayload;
  "ht-run-script": RunScriptPayload;
  // P7 S12 — A6 batch 5 (final) channels.
  "ht-browser-navigated": BrowserNavigatedPayload;
  "ht-browser-title-changed": BrowserTitleChangedPayload;
  "ht-browser-eval-result": BrowserEvalResultPayload;
  "ht-browser-console-log": BrowserConsoleLogPayload;
  "ht-browser-error": BrowserErrorPayload;
  "ht-browser-dom-ready": BrowserDomReadyPayload;
  "ht-browser-zoom": BrowserZoomPayload;
  "ht-agent-prompt": AgentPromptPayload;
  "ht-agent-abort": AgentCommandPayload;
  "ht-agent-new-session": AgentCommandPayload;
  "ht-agent-compact": AgentCommandPayload;
  "ht-agent-get-models": AgentCommandPayload;
  "ht-agent-get-state": AgentCommandPayload;
  "ht-agent-restart": AgentRestartPayload;
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
