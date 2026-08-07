// τ-mux web-mirror protocol.
//
// Every WebSocket message on the wire is an Envelope<T>. The envelope
// carries a protocol version and a monotonic per-connection sequence
// number so the client can detect gaps, and so future reconnects can
// resume from a known point.
//
// Binary frames (sideband payloads) keep the same 4-byte big-endian
// header-length prefix used since v1, but the JSON header now carries
// `v`, `seq`, and a `type`.

import type {
  AskUserRequest,
  AskUserResponse,
  AutoContinueAuditEntry,
  PaneNode,
  Plan,
  SurfaceMetadata,
  SidebandContentMessage,
  TelegramChatWire,
  TelegramStatusWire,
  TelegramWireMessage,
} from "./types";
import type { AnsiColors } from "./settings";

export const WEB_PROTOCOL_VERSION = 2;

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface Envelope<T extends string, P> {
  v: typeof WEB_PROTOCOL_VERSION;
  seq: number;
  type: T;
  payload: P;
}

export interface ClientEnvelope<T extends string, P> {
  v: typeof WEB_PROTOCOL_VERSION;
  /** Highest server seq seen so far; 0 when none. Optional in v2. */
  ack?: number;
  type: T;
  payload: P;
}

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

export interface ServerSurfaceRef {
  id: string;
  title: string;
  cols: number;
  rows: number;
}

export interface ServerWorkspaceRef {
  id: string;
  name: string;
  color: string;
  surfaceIds: string[];
  focusedSurfaceId: string | null;
  layout: PaneNode;
}

export interface NotificationEntry {
  id: string;
  title: string;
  body: string;
  surfaceId?: string;
  /** Wall-clock ms. */
  at: number;
}

export interface LogEntry {
  level: "info" | "warning" | "error" | "success";
  message: string;
  source?: string;
  /** Wall-clock ms. */
  at: number;
}

export interface SidebarStatusEntry {
  value: string;
  icon?: string;
  color?: string;
}

export interface SidebarProgressEntry {
  value: number;
  label?: string;
}

export interface PanelState {
  surfaceId: string;
  meta: SidebandContentMessage;
}

/** M11 — subset of `AppSettings` projected onto the wire so the web
 *  mirror can render with the same theme/font/density as the native
 *  webview. Sensitive fields (auth token, telegram token) and
 *  webview-only fields (audit expectations, web mirror bind/port) are
 *  intentionally omitted. */
export interface SettingsSnapshotPayload {
  themePreset: string;
  accentColor: string;
  secondaryColor: string;
  foregroundColor: string;
  bgBase: string;
  terminalBgOpacity: number;
  ansiColors: AnsiColors;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
  scrollbackLines: number;
  paneGap: number;
  sidebarWidth: number;
  notificationOverlayEnabled: boolean;
  notificationOverlayMs: number;
  workspaceCardDensity: "compact" | "comfortable" | "spacious";
  workspaceCardShowMeta: boolean;
  workspaceCardShowStats: boolean;
  workspaceCardShowPanes: boolean;
  workspaceCardShowManifests: boolean;
  workspaceCardShowStatusPills: boolean;
  workspaceCardShowProgress: boolean;
  statusBarKeys: string[];
  htStatusKeyOrder: string[];
  htStatusKeyHidden: string[];
  terminalOsc94Enabled: boolean;
  /** From `AppSettings.autoContinue.engine` so the plan-panel mirror
   *  can hide the audit strip when the engine is off. */
  autoContinueEngine: "off" | "heuristic" | "model" | "hybrid";

  /** Phase 5 / U2 — chrome theme. Mirror applies via
   *  `document.documentElement.dataset.theme = chromeTheme` so the
   *  `[data-theme="…"]` token blocks in web-theme-tokens.css fire.
   *  Optional in older payloads so a v0 server can still talk to
   *  a v1 client; mirror defaults to "system" when missing. */
  chromeTheme?: "system" | "graphite-dark" | "graphite-light" | "high-contrast";
}

export interface Snapshot {
  /** Native window dimensions when the server is a mirror of the desktop app. */
  nativeViewport: { width: number; height: number } | null;
  surfaces: ServerSurfaceRef[];
  workspaces: ServerWorkspaceRef[];
  activeWorkspaceId: string | null;
  focusedSurfaceId: string | null;
  sidebarVisible: boolean;
  /** Latest metadata observed per surface. Empty map if nothing has been polled yet. */
  metadata: Record<string, SurfaceMetadata>;
  /** Panels currently on screen, keyed by panel id. */
  panels: Record<string, PanelState>;
  /** Sidebar notifications, oldest first. */
  notifications: NotificationEntry[];
  /** Sidebar log entries, oldest first. */
  logs: LogEntry[];
  /** Sidebar status pills, keyed by workspace id then by entry key. */
  status: Record<string, Record<string, SidebarStatusEntry>>;
  /** Sidebar progress, keyed by workspace id. */
  progress: Record<string, SidebarProgressEntry>;
  /** M11 — settings subset broadcast to the web client. `null` until
   *  the host runs `sendSettingsSnapshot` for the first time; the
   *  client falls back to its own Graphite token defaults. */
  settings: SettingsSnapshotPayload | null;
  /** M11 — list of `ht set-status` keys discovered by the host so the
   *  web client can render the same `ht-all` ordering as native. */
  htKeysSeen: string[];
}

export interface HelloPayload {
  sessionId: string;
  serverInstanceId: string;
  protocolVersion: typeof WEB_PROTOCOL_VERSION;
  /** Negotiation flags. Unused in M2 but reserved for feature flags. */
  capabilities: string[];
  snapshot: Snapshot;
}

export interface OutputPayload {
  surfaceId: string;
  data: string;
}

export interface HistoryPayload {
  surfaceId: string;
  data: string;
}

export interface ResizePayload {
  surfaceId: string;
  cols: number;
  rows: number;
}

export interface SurfaceCreatedPayload {
  surfaceId: string;
  title: string;
}

export interface SurfaceRenamedPayload {
  surfaceId: string;
  title: string;
}

export interface SurfaceClosedPayload {
  surfaceId: string;
}

export interface SurfaceExitedPayload {
  surfaceId: string;
  exitCode: number;
}

export interface FocusChangedPayload {
  surfaceId: string;
}

export interface LayoutChangedPayload {
  workspaces: ServerWorkspaceRef[];
  activeWorkspaceId: string | null;
  focusedSurfaceId: string | null;
}

export interface SurfaceMetadataPayload {
  surfaceId: string;
  metadata: SurfaceMetadata;
}

export interface SidebandMetaPayload {
  surfaceId: string;
  meta: SidebandContentMessage;
}

export interface SidebandDataFailedPayload {
  surfaceId: string;
  id: string;
  reason: string;
}

export interface PanelEventPayload {
  surfaceId: string;
  id: string;
  event: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface NotificationPayload {
  /** Stable id — same across the snapshot store and any subsequent
   *  `notificationDismiss` envelope so the client can match on it. */
  id: string;
  title: string;
  body: string;
  surfaceId?: string;
  at: number;
}

export interface NotificationDismissPayload {
  /** Notification id previously delivered via a `notification` envelope. */
  id: string;
}

export interface SidebarActionPayload {
  action: string;
  payload: Record<string, unknown>;
}

export interface SidebarStatePayload {
  visible: boolean;
}

export interface NativeViewportPayload {
  width: number;
  height: number;
}

// ── Envelope payloads added in the addendum to doc/full_analysis.md
// (issue B3). Each was already broadcast by `src/bun/index.ts` and
// handled by `src/web-client/protocol-dispatcher.ts`, but missing from
// the `ServerMessage` union — leaving the wire contract narrower than
// reality. Reusing the wire types from `src/shared/types.ts` (the
// Electrobun-side contract) keeps mirror + native in sync.
export interface TelegramSurfaceCreatedPayload {
  surfaceId: string;
}

export interface TelegramStatePayload {
  status: TelegramStatusWire;
  chats: TelegramChatWire[];
}

export interface TelegramMessagePayload {
  surfaceId?: string;
  message: TelegramWireMessage;
}

export interface TelegramHistoryPayload {
  chatId: string;
  messages: TelegramWireMessage[];
  isLatest: boolean;
}

export interface PlansSnapshotPayload {
  plans: Plan[];
}

export interface AutoContinueAuditPayload {
  audit: AutoContinueAuditEntry[];
}

export interface AskUserShownPayload {
  request: AskUserRequest;
}

export interface AskUserResolvedPayload {
  request_id: string;
  response: AskUserResponse;
}

// M11 — settings + ht-keys-seen broadcast types. Both have already been
// sent over the wire as untyped pass-throughs before now (the
// `htKeysSeen` broadcast in `src/bun/index.ts` predates this typing);
// adding them to the `ServerMessage` union closes the protocol contract.
export interface HtKeysSeenPayload {
  keys: string[];
}

export type ServerMessage =
  | Envelope<"hello", HelloPayload>
  | Envelope<"snapshot", Snapshot>
  | Envelope<"output", OutputPayload>
  | Envelope<"history", HistoryPayload>
  | Envelope<"resize", ResizePayload>
  | Envelope<"surfaceCreated", SurfaceCreatedPayload>
  | Envelope<"surfaceRenamed", SurfaceRenamedPayload>
  | Envelope<"surfaceClosed", SurfaceClosedPayload>
  | Envelope<"surfaceExited", SurfaceExitedPayload>
  | Envelope<"focusChanged", FocusChangedPayload>
  | Envelope<"layoutChanged", LayoutChangedPayload>
  | Envelope<"surfaceMetadata", SurfaceMetadataPayload>
  | Envelope<"sidebandMeta", SidebandMetaPayload>
  | Envelope<"sidebandDataFailed", SidebandDataFailedPayload>
  | Envelope<"panelEvent", PanelEventPayload>
  | Envelope<"notification", NotificationPayload>
  | Envelope<"notificationDismiss", NotificationDismissPayload>
  | Envelope<"notificationClear", Record<string, never>>
  | Envelope<"sidebarState", SidebarStatePayload>
  | Envelope<"sidebarAction", SidebarActionPayload>
  | Envelope<"nativeViewport", NativeViewportPayload>
  | Envelope<"telegramSurfaceCreated", TelegramSurfaceCreatedPayload>
  | Envelope<"telegramState", TelegramStatePayload>
  | Envelope<"telegramMessage", TelegramMessagePayload>
  | Envelope<"telegramHistory", TelegramHistoryPayload>
  | Envelope<"plansSnapshot", PlansSnapshotPayload>
  | Envelope<"autoContinueAudit", AutoContinueAuditPayload>
  | Envelope<"askUserShown", AskUserShownPayload>
  | Envelope<"askUserResolved", AskUserResolvedPayload>
  | Envelope<"settingsSnapshot", SettingsSnapshotPayload>
  | Envelope<"htKeysSeen", HtKeysSeenPayload>;

export type ServerMessageType = ServerMessage["type"];

// ---------------------------------------------------------------------------
// Client → Server messages
// ---------------------------------------------------------------------------

export interface StdinPayload {
  surfaceId: string;
  data: string;
}

export interface SubscribeSurfacePayload {
  surfaceId: string;
}

export interface SubscribeWorkspacePayload {
  workspaceId: string;
}

export interface SelectWorkspacePayload {
  workspaceId: string;
}

export interface FocusSurfacePayload {
  surfaceId: string;
}

export interface DismissNotificationClientPayload {
  id: string;
}

export interface SidebarTogglePayload {
  visible: boolean;
}

/** M13 — client tells the host which cwd it has pinned for a
 *  workspace's manifest cards. v1 stores it locally and uses it to
 *  drive `WorkspaceInfo.selectedCwd`; the host hook is null-safe so
 *  bun-side wiring is deferred to v1.1 without breaking the
 *  protocol contract. */
export interface SelectWorkspaceCwdPayload {
  workspaceId: string;
  cwd: string;
}

/** Clear a plan card from the mirror. The only plan mutation the
 *  mirror may perform — steps themselves are agent-authored, and the
 *  host still applies its own `plan.clear` semantics. */
export interface PlanClearPayload {
  workspaceId: string;
  agentId?: string;
}

export interface PanelMouseEventPayload {
  surfaceId: string;
  id: string;
  event: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  button?: number;
  buttons?: number;
  deltaX?: number;
  deltaY?: number;
  cols?: number;
  rows?: number;
  pxWidth?: number;
  pxHeight?: number;
}

export type ClientMessage =
  | ClientEnvelope<"stdin", StdinPayload>
  | ClientEnvelope<"subscribeSurface", SubscribeSurfacePayload>
  | ClientEnvelope<"selectWorkspace", SelectWorkspacePayload>
  | ClientEnvelope<"subscribeWorkspace", SubscribeWorkspacePayload>
  | ClientEnvelope<"focusSurface", FocusSurfacePayload>
  | ClientEnvelope<"sidebarToggle", SidebarTogglePayload>
  | ClientEnvelope<"clearNotifications", Record<string, never>>
  | ClientEnvelope<"dismissNotification", DismissNotificationClientPayload>
  | ClientEnvelope<"panelMouseEvent", PanelMouseEventPayload>
  | ClientEnvelope<"selectWorkspaceCwd", SelectWorkspaceCwdPayload>
  | ClientEnvelope<"planClear", PlanClearPayload>;

export type ClientMessageType = ClientMessage["type"];

// ---------------------------------------------------------------------------
// Binary frame header (sideband binary data)
// ---------------------------------------------------------------------------

export interface BinaryFrameHeader {
  v: typeof WEB_PROTOCOL_VERSION;
  seq: number;
  type: "sidebandData";
  surfaceId: string;
  id: string;
}
