// HyperTerm Canvas web-mirror protocol.
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
  PaneNode,
  SurfaceMetadata,
  SidebandContentMessage,
} from "./types";

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
  | Envelope<"nativeViewport", NativeViewportPayload>;

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

export interface FocusSurfacePayload {
  surfaceId: string;
}

export interface DismissNotificationClientPayload {
  id: string;
}

export interface SidebarTogglePayload {
  visible: boolean;
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
  | ClientEnvelope<"subscribeWorkspace", SubscribeWorkspacePayload>
  | ClientEnvelope<"focusSurface", FocusSurfacePayload>
  | ClientEnvelope<"sidebarToggle", SidebarTogglePayload>
  | ClientEnvelope<"clearNotifications", Record<string, never>>
  | ClientEnvelope<"dismissNotification", DismissNotificationClientPayload>
  | ClientEnvelope<"panelMouseEvent", PanelMouseEventPayload>;

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
