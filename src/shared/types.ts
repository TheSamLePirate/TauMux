import type { ElectrobunRPCSchema } from "electrobun/bun";
import type { AppSettings } from "./settings";

// === Pane Layout Types (shared between webview, bun, and web clients) ===

export interface PaneSplit {
  type: "split";
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [PaneNode, PaneNode];
}

export interface PaneLeaf {
  type: "leaf";
  surfaceId: string;
}

export type PaneNode = PaneSplit | PaneLeaf;

export interface PaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// === Layout Persistence Types ===

export interface PersistedWorkspace {
  name: string;
  color: string;
  layout: PaneNode;
  focusedSurfaceId: string | null;
}

export interface PersistedLayout {
  activeWorkspaceIndex: number;
  workspaces: PersistedWorkspace[];
  sidebarVisible: boolean;
}

// === Live Surface Metadata ===

/** One process observed in a surface's descendant tree. */
export interface ProcessNode {
  pid: number;
  ppid: number;
  /** Full argv as reported by `ps -o args` (not truncated). */
  command: string;
  /** Instantaneous CPU% from `ps %cpu`. */
  cpu: number;
  /** Resident set size in KB from `ps rss`. */
  rssKb: number;
}

/** A TCP listener owned by a process in the tree. */
export interface ListeningPort {
  pid: number;
  port: number;
  proto: "tcp" | "tcp6";
  /** Listening address, e.g. "*", "127.0.0.1", "::1". */
  address: string;
}

/** Git repository observation for the surface's cwd, if any. */
export interface GitInfo {
  /** Branch name, e.g. "main"; "(detached)" when HEAD is detached. */
  branch: string;
  /** Abbreviated HEAD commit hash (first 12 chars), empty if unavailable. */
  head: string;
  /** Upstream branch name, e.g. "origin/main", or empty when none tracked. */
  upstream: string;
  /** Commits ahead of upstream. */
  ahead: number;
  /** Commits behind upstream. */
  behind: number;
  /** Files with changes in the index (staged). */
  staged: number;
  /** Files with changes in the working tree (unstaged). */
  unstaged: number;
  /** Untracked (not .gitignore'd) files. */
  untracked: number;
  /** Files with unresolved merge conflicts. */
  conflicts: number;
  /** Lines inserted in `git diff HEAD --shortstat` (staged + unstaged). */
  insertions: number;
  /** Lines deleted in `git diff HEAD --shortstat` (staged + unstaged). */
  deletions: number;
  /** True when HEAD is detached (rebase, bisect, explicit checkout of a commit). */
  detached: boolean;
}

/** Live, polled view of what a surface's shell and its descendants are doing. */
export interface SurfaceMetadata {
  /** Shell pid (same as pty.pid). */
  pid: number;
  /**
   * Foreground process group leader on the pane's tty.
   * Equal to `pid` when the shell itself is in the foreground.
   * Look up `tree.find(p => p.pid === foregroundPid)?.command` for the
   * full command line ("bun run dev", "python3 -m http.server 8080", …).
   */
  foregroundPid: number;
  /** cwd of the foreground process. */
  cwd: string;
  /** Pre-order tree rooted at `pid`, each entry with its full argv. */
  tree: ProcessNode[];
  /** TCP listeners owned by any pid in the tree. */
  listeningPorts: ListeningPort[];
  /** Git status for the cwd, or null when cwd is not inside a git repo. */
  git: GitInfo | null;
  /** Wall-clock ms when this snapshot was produced. */
  updatedAt: number;
}

// === Sideband Channel Types ===

export interface ChannelDescriptor {
  /** Channel name, e.g. "meta", "data", "events" */
  name: string;
  /** File descriptor number */
  fd: number;
  /** "out" = script writes / parent reads, "in" = parent writes / script reads */
  direction: "out" | "in";
  /** How to parse the stream */
  encoding: "jsonl" | "binary";
}

export interface ChannelMap {
  version: 1;
  channels: ChannelDescriptor[];
}

// === Sideband Protocol Types ===

/** Protocol operations handled by core (not content renderers) */
export type ProtocolOp = "update" | "clear" | "flush";
/** Built-in content types that ship with default renderers */
export type BuiltinContentType = "image" | "svg" | "html" | "canvas2d";
/** Any string is a valid content type — renderers are registered at runtime */
export type ContentType = ProtocolOp | BuiltinContentType | (string & {});

export type PositionType = "inline" | "float" | "overlay" | "fixed";

export interface SidebandMetaMessage {
  id: string;
  type: ContentType;
  format?: string;
  position?: PositionType;
  anchor?: "cursor" | { row: number };
  x?: number;
  y?: number;
  width?: number | "auto";
  height?: number | "auto";
  interactive?: boolean;
  draggable?: boolean;
  resizable?: boolean;
  byteLength?: number;
  zIndex?: number;
  opacity?: number;
  borderRadius?: number;
  data?: string;
  /** Named data channel for binary payload (default: "data" = fd4) */
  dataChannel?: string;
  /** Timeout in ms for the binary read (default: 5000) */
  timeout?: number;
}

export interface PanelEvent {
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
  type?: string;
  cols?: number;
  rows?: number;
  pxWidth?: number;
  /** Error code for system error events (id="__system__", event="error") */
  code?: string;
  /** Human-readable message for system error events */
  message?: string;
  /** Reference panel id that triggered the error or ack */
  ref?: string;
  pxHeight?: number;
}

export interface WorkspaceContextMenuRequest {
  kind: "workspace";
  workspaceId: string;
  name: string;
  color?: string;
}

export interface SurfaceContextMenuRequest {
  kind: "surface";
  surfaceId: string;
  title: string;
  workspaceId?: string;
}

export type NativeContextMenuRequest =
  | WorkspaceContextMenuRequest
  | SurfaceContextMenuRequest;

// === RPC Schema ===
// bun.messages = what bun RECEIVES from webview
// webview.messages = what webview RECEIVES from bun

export interface HyperTermRPC extends ElectrobunRPCSchema {
  bun: {
    requests: Record<string, never>;
    messages: {
      // Clipboard (webview → bun)
      clipboardWrite: { text: string };
      clipboardPaste: { surfaceId: string };

      // Terminal I/O (routed by surfaceId)
      writeStdin: { surfaceId: string; data: string };
      resize: { surfaceId: string; cols: number; rows: number };
      viewportSize: { width: number; height: number };

      // Surface lifecycle
      createSurface: { cwd?: string };
      splitSurface: { direction: "horizontal" | "vertical" };
      closeSurface: { surfaceId: string };
      focusSurface: { surfaceId: string };

      // Panels
      panelEvent: PanelEvent & { surfaceId: string };

      // Read screen response (webview → bun)
      readScreenResponse: { reqId: string; content: string };

      // Workspace state sync (webview → bun for socket API)
      workspaceStateSync: {
        workspaces: {
          id: string;
          name: string;
          color: string;
          surfaceIds: string[];
          focusedSurfaceId: string | null;
          layout: PaneNode;
        }[];
        activeWorkspaceId: string | null;
      };

      // Sidebar
      sidebarToggle: { visible: boolean };

      // Notifications
      clearNotifications: void;

      // Native menus
      showContextMenu: NativeContextMenuRequest;

      // Web mirror
      toggleWebServer: void;

      // Window
      toggleMaximize: void;

      // Settings
      updateSettings: { settings: Partial<AppSettings> };

      // Open an external URL in the system default handler (browser, etc.)
      openExternal: { url: string };

      // Window visibility (drives metadata polling rate on the bun side)
      windowVisibility: { visible: boolean };

      // Kill an arbitrary pid (used by the process manager panel)
      killPid: { pid: number; signal?: string };
    };
  };
  webview: {
    requests: {
      readScreen: {
        params: {
          surfaceId: string;
          lines?: number;
          scrollback?: boolean;
        };
        response: string;
      };
    };
    messages: {
      // Terminal I/O (routed by surfaceId)
      writeStdout: { surfaceId: string; data: string };

      // Surface lifecycle
      surfaceCreated: {
        surfaceId: string;
        title: string;
        splitFrom?: string;
        direction?: "horizontal" | "vertical";
      };
      surfaceClosed: { surfaceId: string };

      // Sideband (routed by surfaceId)
      sidebandMeta: SidebandMetaMessage & { surfaceId: string };
      sidebandData: { surfaceId: string; id: string; data: string };
      /** Binary read failed (timeout, EOF, abort) after meta was already dispatched */
      sidebandDataFailed: {
        surfaceId: string;
        id: string;
        reason: string;
      };

      // Live surface metadata (cwd / process tree / listening ports)
      surfaceMetadata: { surfaceId: string; metadata: SurfaceMetadata };

      // Web server status
      webServerStatus: { running: boolean; port: number; url?: string };

      // Layout persistence
      restoreLayout: {
        layout: PersistedLayout;
        surfaceMapping: Record<string, string>;
      };

      // Settings
      restoreSettings: { settings: AppSettings };
      settingsChanged: { settings: AppSettings };

      // Socket API dispatched actions (bun → webview)
      socketAction: { action: string; payload: Record<string, unknown> };
    };
  };
}
