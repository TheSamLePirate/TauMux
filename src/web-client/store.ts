// HyperTerm Canvas web-mirror client store.
//
// Pure state + reducer + tiny observer store. No DOM or xterm imports,
// so this module is exercised directly from bun test without JSDOM.
//
// Streaming side effects (xterm `write`, focus pulses, cursor blinks)
// are NOT modelled as state. The transport layer dispatches actions for
// structural changes (surfaces, panels, metadata, sidebar) and invokes
// the xterm instance directly for stdout — the view subscribes to
// structural changes only.

import type {
  SurfaceMetadata,
  SidebandContentMessage,
  TelegramChatWire,
  TelegramStatusWire,
  TelegramWireMessage,
} from "../shared/types";
import { mergeTelegramMessages } from "../shared/telegram-view";
import type {
  LogEntry,
  NotificationEntry,
  PanelState as SnapshotPanelState,
  ServerWorkspaceRef,
  SidebarProgressEntry,
  SidebarStatusEntry,
  Snapshot,
} from "../shared/web-protocol";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface SurfaceState {
  id: string;
  title: string;
  cols: number;
  rows: number;
  metadata: SurfaceMetadata | null;
}

export interface PanelState {
  id: string;
  surfaceId: string;
  meta: SidebandContentMessage;
}

export interface SidebarState {
  notifications: NotificationEntry[];
  logs: LogEntry[];
  status: Record<string, Record<string, SidebarStatusEntry>>;
  progress: Record<string, SidebarProgressEntry>;
}

export interface ConnectionState {
  status: "connecting" | "connected" | "disconnected";
  sessionId: string | null;
  serverInstanceId: string | null;
  lastSeenSeq: number;
}

export interface TelegramState {
  status: TelegramStatusWire;
  chats: TelegramChatWire[];
  /** Newest-last list per chat. Capped at 200 in-memory; the SQLite log
   *  on bun owns the real history. */
  messagesByChat: Record<string, TelegramWireMessage[]>;
  /** UI selection — defaults to the most recently active chat. Local
   *  to the web client; not synced across mirrors. */
  activeChatId: string | null;
}

export interface AppState {
  connection: ConnectionState;
  nativeViewport: { width: number; height: number } | null;
  surfaces: Record<string, SurfaceState>;
  workspaces: ServerWorkspaceRef[];
  activeWorkspaceId: string | null;
  focusedSurfaceId: string | null;
  sidebarVisible: boolean;
  fullscreenSurfaceId: string | null;
  panels: Record<string, PanelState>;
  sidebar: SidebarState;
  /** Per-surface "notify" glow pulses triggered by notification messages. */
  glowingSurfaceIds: string[];
  telegram: TelegramState;
}

export function initialState(): AppState {
  return {
    connection: {
      status: "connecting",
      sessionId: null,
      serverInstanceId: null,
      lastSeenSeq: -1,
    },
    nativeViewport: null,
    surfaces: {},
    workspaces: [],
    activeWorkspaceId: null,
    focusedSurfaceId: null,
    sidebarVisible: false,
    fullscreenSurfaceId: null,
    panels: {},
    sidebar: {
      notifications: [],
      logs: [],
      status: {},
      progress: {},
    },
    glowingSurfaceIds: [],
    telegram: {
      status: { state: "disabled" },
      chats: [],
      messagesByChat: {},
      activeChatId: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { kind: "connection/status"; status: ConnectionState["status"] }
  | {
      kind: "connection/hello";
      sessionId: string;
      serverInstanceId: string;
      lastSeenSeq: number;
    }
  | { kind: "connection/seq"; seq: number }
  | { kind: "connection/reset" }
  | { kind: "snapshot/apply"; snapshot: Snapshot }
  | { kind: "surface/created"; surfaceId: string; title: string }
  | { kind: "surface/renamed"; surfaceId: string; title: string }
  | { kind: "surface/closed"; surfaceId: string }
  | { kind: "surface/resized"; surfaceId: string; cols: number; rows: number }
  | { kind: "surface/metadata"; surfaceId: string; metadata: SurfaceMetadata }
  | { kind: "focus/set"; surfaceId: string }
  | {
      kind: "layout/changed";
      workspaces: ServerWorkspaceRef[];
      activeWorkspaceId: string | null;
      focusedSurfaceId: string | null;
    }
  | { kind: "workspace/active"; workspaceId: string }
  | { kind: "sidebar/visible"; visible: boolean }
  | {
      kind: "sidebar/action";
      action: string;
      payload: Record<string, unknown>;
    }
  | { kind: "notification/add"; entry: NotificationEntry }
  | { kind: "notification/remove"; id: string }
  | { kind: "notification/clear" }
  | { kind: "glow/clear"; surfaceId?: string }
  | { kind: "panel/meta"; surfaceId: string; meta: SidebandContentMessage }
  | {
      kind: "panel/event";
      panelId: string;
      event: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    }
  | { kind: "panel/data-failed"; panelId: string }
  | { kind: "native-viewport"; width: number; height: number }
  | { kind: "fullscreen/enter"; surfaceId: string }
  | { kind: "fullscreen/exit" }
  | {
      kind: "telegram/state";
      status: TelegramStatusWire;
      chats: TelegramChatWire[];
    }
  | {
      kind: "telegram/history";
      chatId: string;
      messages: TelegramWireMessage[];
    }
  | { kind: "telegram/message"; message: TelegramWireMessage }
  | { kind: "telegram/select-chat"; chatId: string }
  | { kind: "telegram/glow-incoming" };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const MAX_GLOWING = 16;

export function reducer(state: AppState, action: Action): AppState {
  switch (action.kind) {
    case "connection/status":
      return {
        ...state,
        connection: { ...state.connection, status: action.status },
      };

    case "connection/hello":
      return {
        ...state,
        connection: {
          ...state.connection,
          sessionId: action.sessionId,
          serverInstanceId: action.serverInstanceId,
          lastSeenSeq: action.lastSeenSeq,
        },
      };

    case "connection/seq":
      if (action.seq <= state.connection.lastSeenSeq) return state;
      return {
        ...state,
        connection: { ...state.connection, lastSeenSeq: action.seq },
      };

    case "connection/reset":
      return {
        ...state,
        connection: {
          status: "connecting",
          sessionId: null,
          serverInstanceId: null,
          lastSeenSeq: -1,
        },
        surfaces: {},
        panels: {},
        workspaces: [],
        activeWorkspaceId: null,
        focusedSurfaceId: null,
        fullscreenSurfaceId: null,
        glowingSurfaceIds: [],
      };

    case "snapshot/apply": {
      const s = action.snapshot;
      const surfaces: Record<string, SurfaceState> = {};
      for (const sref of s.surfaces) {
        surfaces[sref.id] = {
          id: sref.id,
          title: sref.title,
          cols: sref.cols,
          rows: sref.rows,
          metadata: s.metadata[sref.id] ?? null,
        };
      }
      const panels: Record<string, PanelState> = {};
      for (const pid in s.panels) {
        const entry = s.panels[pid] as SnapshotPanelState;
        panels[pid] = {
          id: pid,
          surfaceId: entry.surfaceId,
          meta: entry.meta,
        };
      }
      return {
        ...state,
        nativeViewport: s.nativeViewport,
        surfaces,
        workspaces: s.workspaces,
        activeWorkspaceId: s.activeWorkspaceId,
        focusedSurfaceId: s.focusedSurfaceId,
        sidebarVisible: s.sidebarVisible,
        panels,
        sidebar: {
          notifications: s.notifications.slice(),
          logs: s.logs.slice(),
          status: cloneRecord(s.status),
          progress: { ...s.progress },
        },
        fullscreenSurfaceId: null,
        glowingSurfaceIds: [],
      };
    }

    case "surface/created": {
      if (state.surfaces[action.surfaceId]) {
        const existing = state.surfaces[action.surfaceId];
        return {
          ...state,
          surfaces: {
            ...state.surfaces,
            [action.surfaceId]: { ...existing, title: action.title },
          },
        };
      }
      return {
        ...state,
        surfaces: {
          ...state.surfaces,
          [action.surfaceId]: {
            id: action.surfaceId,
            title: action.title,
            cols: 80,
            rows: 24,
            metadata: null,
          },
        },
      };
    }

    case "surface/renamed": {
      const s = state.surfaces[action.surfaceId];
      if (!s) return state;
      return {
        ...state,
        surfaces: {
          ...state.surfaces,
          [action.surfaceId]: { ...s, title: action.title },
        },
      };
    }

    case "surface/closed": {
      if (!state.surfaces[action.surfaceId]) return state;
      const rest: Record<string, SurfaceState> = {};
      for (const sid in state.surfaces) {
        if (sid !== action.surfaceId) rest[sid] = state.surfaces[sid]!;
      }
      // Also forget panels that belonged to this surface.
      const panels: Record<string, PanelState> = {};
      for (const pid in state.panels) {
        if (state.panels[pid]!.surfaceId !== action.surfaceId) {
          panels[pid] = state.panels[pid]!;
        }
      }
      return {
        ...state,
        surfaces: rest,
        panels,
        fullscreenSurfaceId:
          state.fullscreenSurfaceId === action.surfaceId
            ? null
            : state.fullscreenSurfaceId,
        focusedSurfaceId:
          state.focusedSurfaceId === action.surfaceId
            ? null
            : state.focusedSurfaceId,
        glowingSurfaceIds: state.glowingSurfaceIds.filter(
          (id) => id !== action.surfaceId,
        ),
      };
    }

    case "surface/resized": {
      const s = state.surfaces[action.surfaceId];
      if (!s) return state;
      return {
        ...state,
        surfaces: {
          ...state.surfaces,
          [action.surfaceId]: {
            ...s,
            cols: action.cols,
            rows: action.rows,
          },
        },
      };
    }

    case "surface/metadata": {
      const s = state.surfaces[action.surfaceId];
      if (!s) {
        // Metadata for a surface we don't yet know about — store a stub so
        // hello latency doesn't lose early metadata pushes.
        return {
          ...state,
          surfaces: {
            ...state.surfaces,
            [action.surfaceId]: {
              id: action.surfaceId,
              title: action.surfaceId,
              cols: 80,
              rows: 24,
              metadata: action.metadata,
            },
          },
        };
      }
      return {
        ...state,
        surfaces: {
          ...state.surfaces,
          [action.surfaceId]: { ...s, metadata: action.metadata },
        },
      };
    }

    case "focus/set":
      return {
        ...state,
        focusedSurfaceId: action.surfaceId,
        glowingSurfaceIds: state.glowingSurfaceIds.filter(
          (id) => id !== action.surfaceId,
        ),
      };

    case "layout/changed":
      return {
        ...state,
        workspaces: action.workspaces,
        activeWorkspaceId: action.activeWorkspaceId ?? state.activeWorkspaceId,
        focusedSurfaceId: action.focusedSurfaceId ?? state.focusedSurfaceId,
      };

    case "workspace/active":
      return { ...state, activeWorkspaceId: action.workspaceId };

    case "sidebar/visible":
      return { ...state, sidebarVisible: action.visible };

    case "sidebar/action": {
      const wsIdRaw = action.payload["workspaceId"];
      const wsId =
        (typeof wsIdRaw === "string" && wsIdRaw) ||
        state.activeWorkspaceId ||
        "";
      if (!wsId) return state;
      const next = { ...state.sidebar };
      if (action.action === "setStatus") {
        const key = action.payload["key"];
        if (typeof key !== "string" || !key) return state;
        next.status = { ...next.status };
        next.status[wsId] = { ...(next.status[wsId] ?? {}) };
        next.status[wsId][key] = {
          value: String(action.payload["value"] ?? ""),
          icon:
            typeof action.payload["icon"] === "string"
              ? (action.payload["icon"] as string)
              : undefined,
          color:
            typeof action.payload["color"] === "string"
              ? (action.payload["color"] as string)
              : undefined,
        };
      } else if (action.action === "clearStatus") {
        const key = action.payload["key"];
        if (typeof key !== "string" || !next.status[wsId]) return state;
        next.status = { ...next.status };
        const bucket = { ...(next.status[wsId] ?? {}) };
        delete bucket[key];
        next.status[wsId] = bucket;
      } else if (action.action === "setProgress") {
        next.progress = {
          ...next.progress,
          [wsId]: {
            value: Number(action.payload["value"] ?? 0),
            label:
              typeof action.payload["label"] === "string"
                ? (action.payload["label"] as string)
                : undefined,
          },
        };
      } else if (action.action === "clearProgress") {
        next.progress = { ...next.progress };
        delete next.progress[wsId];
      } else if (action.action === "log") {
        const level = action.payload["level"];
        const entry: LogEntry = {
          level:
            level === "error" ||
            level === "warning" ||
            level === "success" ||
            level === "info"
              ? level
              : "info",
          message: String(action.payload["message"] ?? ""),
          source:
            typeof action.payload["source"] === "string"
              ? (action.payload["source"] as string)
              : undefined,
          at: Date.now(),
        };
        next.logs = [...next.logs, entry].slice(-200);
      }
      return { ...state, sidebar: next };
    }

    case "notification/add": {
      const next: SidebarState = {
        ...state.sidebar,
        notifications: [...state.sidebar.notifications, action.entry].slice(
          -50,
        ),
      };
      const glow = action.entry.surfaceId
        ? uniqueAppend(state.glowingSurfaceIds, action.entry.surfaceId)
        : state.glowingSurfaceIds;
      return {
        ...state,
        sidebar: next,
        glowingSurfaceIds: glow.slice(-MAX_GLOWING),
      };
    }

    case "notification/remove": {
      const before = state.sidebar.notifications;
      const after = before.filter((n) => n.id !== action.id);
      if (after.length === before.length) return state;
      return {
        ...state,
        sidebar: { ...state.sidebar, notifications: after },
      };
    }

    case "notification/clear":
      return {
        ...state,
        sidebar: { ...state.sidebar, notifications: [] },
        glowingSurfaceIds: [],
      };

    case "glow/clear":
      if (!action.surfaceId) {
        return { ...state, glowingSurfaceIds: [] };
      }
      return {
        ...state,
        glowingSurfaceIds: state.glowingSurfaceIds.filter(
          (id) => id !== action.surfaceId,
        ),
      };

    case "panel/meta": {
      const id = action.meta.id;
      if (!id) return state;
      if (action.meta.type === "clear") {
        if (!state.panels[id]) return state;
        return { ...state, panels: omitKey(state.panels, id) };
      }
      const existing = state.panels[id];
      if (action.meta.type === "update") {
        // Drop updates whose target panel is gone — matches the native
        // PanelManager, which ignores updates for ids it has no entry
        // for. Without this the web mirror resurrected a just-closed
        // panel on the next streaming frame (webcam at 30 fps made the
        // close button look broken).
        if (!existing) return state;
        // Preserve the original content kind (html/svg/image/…) and id.
        // Otherwise the "update" type clobbers the renderer key and every
        // subsequent binary frame for this panel becomes unrenderable.
        return {
          ...state,
          panels: {
            ...state.panels,
            [id]: {
              ...existing,
              meta: {
                ...existing.meta,
                ...action.meta,
                type: existing.meta.type,
                id: existing.meta.id,
              },
            },
          },
        };
      }
      return {
        ...state,
        panels: {
          ...state.panels,
          [id]: { id, surfaceId: action.surfaceId, meta: action.meta },
        },
      };
    }

    case "panel/event": {
      const existing = state.panels[action.panelId];
      if (!existing) return state;
      if (action.event === "close") {
        return { ...state, panels: omitKey(state.panels, action.panelId) };
      }
      if (action.event === "dragend" || action.event === "resize") {
        const meta: SidebandContentMessage = { ...existing.meta };
        if (action.x !== undefined) meta.x = action.x;
        if (action.y !== undefined) meta.y = action.y;
        if (action.width !== undefined) meta.width = action.width;
        if (action.height !== undefined) meta.height = action.height;
        return {
          ...state,
          panels: {
            ...state.panels,
            [action.panelId]: { ...existing, meta },
          },
        };
      }
      return state;
    }

    case "panel/data-failed": {
      if (!state.panels[action.panelId]) return state;
      return { ...state, panels: omitKey(state.panels, action.panelId) };
    }

    case "native-viewport":
      return {
        ...state,
        nativeViewport: { width: action.width, height: action.height },
      };

    case "fullscreen/enter":
      return { ...state, fullscreenSurfaceId: action.surfaceId };

    case "fullscreen/exit":
      return { ...state, fullscreenSurfaceId: null };

    case "telegram/state": {
      const next: TelegramState = {
        ...state.telegram,
        status: action.status,
        chats: action.chats,
      };
      if (!next.activeChatId && action.chats.length > 0) {
        next.activeChatId = action.chats[0].id;
      }
      return { ...state, telegram: next };
    }

    case "telegram/history": {
      const existing = state.telegram.messagesByChat[action.chatId] ?? [];
      const merged = mergeTelegramMessages(existing, action.messages);
      return {
        ...state,
        telegram: {
          ...state.telegram,
          messagesByChat: {
            ...state.telegram.messagesByChat,
            [action.chatId]: merged,
          },
        },
      };
    }

    case "telegram/message": {
      const m = action.message;
      const list = state.telegram.messagesByChat[m.chatId] ?? [];
      const merged = mergeTelegramMessages(list, [m]);
      return {
        ...state,
        telegram: {
          ...state.telegram,
          messagesByChat: {
            ...state.telegram.messagesByChat,
            [m.chatId]: merged,
          },
        },
      };
    }

    case "telegram/select-chat":
      return {
        ...state,
        telegram: { ...state.telegram, activeChatId: action.chatId },
      };

    case "telegram/glow-incoming": {
      // Glow every telegram surface that isn't currently focused. The
      // store knows surfaces by id but not by kind — telegram surface
      // ids are prefixed `tg:`, which is the cheapest test we have.
      const next: string[] = state.glowingSurfaceIds.slice();
      for (const sid in state.surfaces) {
        if (
          sid.startsWith("tg:") &&
          sid !== state.focusedSurfaceId &&
          !next.includes(sid)
        ) {
          next.push(sid);
        }
      }
      if (next.length === state.glowingSurfaceIds.length) return state;
      return { ...state, glowingSurfaceIds: next.slice(-MAX_GLOWING) };
    }

    default:
      return state;
  }
}

function uniqueAppend(list: string[], value: string): string[] {
  if (list.includes(value)) return list;
  return [...list, value];
}

function omitKey<V>(r: Record<string, V>, key: string): Record<string, V> {
  const out: Record<string, V> = {};
  for (const k in r) {
    if (k !== key) out[k] = r[k]!;
  }
  return out;
}

function cloneRecord<V>(
  r: Record<string, Record<string, V>>,
): Record<string, Record<string, V>> {
  const out: Record<string, Record<string, V>> = {};
  for (const k in r) out[k] = { ...r[k]! };
  return out;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type Listener = (state: AppState, action: Action | null) => void;

export interface Store {
  getState(): AppState;
  dispatch(action: Action): void;
  subscribe(listener: Listener): () => void;
}

export function createStore(
  seed: AppState = initialState(),
  reduce: (s: AppState, a: Action) => AppState = reducer,
): Store {
  let state = seed;
  const listeners: Set<Listener> = new Set();
  return {
    getState: () => state,
    dispatch(action: Action) {
      const next = reduce(state, action);
      if (next === state) return;
      state = next;
      for (const listener of listeners) {
        try {
          listener(state, action);
        } catch (err) {
          // A crashing subscriber must not poison the store.
          console.error("[store] listener error", err);
        }
      }
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      listener(state, null);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
