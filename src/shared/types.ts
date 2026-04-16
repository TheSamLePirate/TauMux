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
  /** Surface kind. Omitted or "terminal" = terminal PTY pane.
   *  "browser" = embedded web browser pane.
   *  "agent" = pi coding agent pane. */
  surfaceType?: "terminal" | "browser" | "agent";
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
  /** Persisted display title per surface id (pane rename). */
  surfaceTitles?: Record<string, string>;
  /** Live cwd of each surface at save-time, so restored shells can spawn at
   *  the same directory they were running in. Derived from the metadata
   *  poller; entries without a known cwd are omitted. */
  surfaceCwds?: Record<string, string>;
  /** User-pinned cwd for the workspace (drives the package.json card). */
  selectedCwd?: string;
  /** Persisted URL per browser surface id for restore. */
  surfaceUrls?: Record<string, string>;
  /** Surface type per surface id (only stored for "browser" or "agent"; terminal is the default). */
  surfaceTypes?: Record<string, "terminal" | "browser" | "agent">;
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

/** Subset of package.json we surface in the UI. */
export interface PackageInfo {
  /** Absolute path to the package.json file; unique key per workspace. */
  path: string;
  /** Absolute path to the directory containing package.json. */
  directory: string;
  name?: string;
  version?: string;
  type?: string;
  description?: string;
  /** String or map form as it appears in package.json. */
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
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
  /** Nearest package.json walking up from cwd, or null when none found. */
  packageJson: PackageInfo | null;
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
  x?: number;
  y?: number;
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
      splitSurface: {
        direction: "horizontal" | "vertical";
        /** Optional cwd for the new pane; typically the active workspace's
         *  selected cwd. Falls back bun-side to the splitFrom pane's cwd
         *  from the metadata poller when omitted. */
        cwd?: string;
      };
      closeSurface: { surfaceId: string };
      focusSurface: { surfaceId: string };
      renameSurface: { surfaceId: string; title: string };

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
          /** Persisted display title per surface id (pane rename). */
          surfaceTitles?: Record<string, string>;
          /** Live cwd per surface so restart can reopen shells in place. */
          surfaceCwds?: Record<string, string>;
          /** User-pinned workspace cwd (drives package.json card). */
          selectedCwd?: string;
          /** Persisted URL per browser surface id for restore. */
          surfaceUrls?: Record<string, string>;
          /** Surface type per surface id (only stored for "browser" or "agent"). */
          surfaceTypes?: Record<string, "terminal" | "browser" | "agent">;
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

      // Launch a package.json script in a fresh surface inside a workspace.
      // Bun creates the surface, echoes the command into its stdin after the
      // shell is ready, and marks the returned surfaceCreated message with
      // launchFor so the webview can track running/errored state.
      runScript: {
        workspaceId: string;
        cwd: string;
        command: string;
        scriptKey: string;
      };

      // ── Browser surface lifecycle (webview → bun) ──
      createBrowserSurface: { url?: string };
      splitBrowserSurface: {
        direction: "horizontal" | "vertical";
        url?: string;
      };
      /** Webview notifies bun when a browser pane navigates. */
      browserNavigated: { surfaceId: string; url: string; title: string };
      /** Webview notifies bun when a browser pane's page title changes. */
      browserTitleChanged: { surfaceId: string; title: string };
      /** Webview requests zoom change — bun records it for persistence. */
      browserSetZoom: { surfaceId: string; zoom: number };
      /** Console/error capture from browser preload. */
      browserConsoleLog: {
        surfaceId: string;
        level: string;
        args: string[];
        timestamp: number;
      };
      browserError: {
        surfaceId: string;
        message: string;
        filename?: string;
        lineno?: number;
        timestamp: number;
      };
      /** Eval result coming back from a browser webview. */
      browserEvalResult: {
        surfaceId: string;
        reqId: string;
        result?: string;
        error?: string;
      };
      /** Webview notifies bun when a browser pane's DOM is ready (for cookie injection). */
      browserDomReady: { surfaceId: string; url: string };
      /** Webview forwards a cookie action (import/export/clear) from settings panel. */
      browserCookieAction: { action: string; data?: string; format?: string };

      // ── Agent surface lifecycle (webview → bun) ──
      createAgentSurface: {
        provider?: string;
        model?: string;
        thinkingLevel?: string;
        cwd?: string;
      };
      splitAgentSurface: {
        direction: "horizontal" | "vertical";
        provider?: string;
        model?: string;
        thinkingLevel?: string;
        cwd?: string;
      };
      /** Prompt sent from the webview agent panel to bun. */
      agentPrompt: {
        agentId: string;
        message: string;
        images?: { type: "image"; data: string; mimeType: string }[];
      };
      /** Abort the current agent operation. */
      agentAbort: { agentId: string };
      /** Set the agent's model. */
      agentSetModel: { agentId: string; provider: string; modelId: string };
      /** Set the agent's thinking level. */
      agentSetThinking: { agentId: string; level: string };
      /** Start a new agent session. */
      agentNewSession: { agentId: string };
      /** Compact the agent session. */
      agentCompact: { agentId: string };
      /** Request available models from the agent. */
      agentGetModels: { agentId: string };
      /** Request current agent state. */
      agentGetState: { agentId: string };
      /** Respond to an extension UI request. */
      agentExtensionUIResponse: {
        agentId: string;
        id: string;
        response: Record<string, unknown>;
      };
      /** Queue a steering message during agent streaming. */
      agentSteer: {
        agentId: string;
        message: string;
        images?: { type: "image"; data: string; mimeType: string }[];
      };
      /** Queue a follow-up message for after agent finishes. */
      agentFollowUp: {
        agentId: string;
        message: string;
        images?: { type: "image"; data: string; mimeType: string }[];
      };
      /** Execute a bash command via the agent. */
      agentBash: { agentId: string; command: string; timeout?: number };
      /** Abort a running bash command. */
      agentAbortBash: { agentId: string };
      /** Cycle to the next model. */
      agentCycleModel: { agentId: string };
      /** Cycle to the next thinking level. */
      agentCycleThinking: { agentId: string };
      /** Get available slash commands. */
      agentGetCommands: { agentId: string };
      /** Get session stats (tokens, cost, context). */
      agentGetSessionStats: { agentId: string };
      /** Get full session message history. */
      agentGetMessages: { agentId: string };
      /** List recent pi session files for browsing/resume UI. */
      agentListSessions: { agentId: string };
      /** Read and summarize a session file tree for branch browsing. */
      agentGetSessionTree: { agentId: string; sessionPath?: string };
      /** Get messages available for forking. */
      agentGetForkMessages: { agentId: string };
      /** Get last assistant message text (for copy). */
      agentGetLastAssistantText: { agentId: string };
      /** Set steering mode. */
      agentSetSteeringMode: { agentId: string; mode: string };
      /** Set follow-up mode. */
      agentSetFollowUpMode: { agentId: string; mode: string };
      /** Enable/disable auto-compaction. */
      agentSetAutoCompaction: { agentId: string; enabled: boolean };
      /** Enable/disable auto-retry. */
      agentSetAutoRetry: { agentId: string; enabled: boolean };
      /** Cancel in-progress retry. */
      agentAbortRetry: { agentId: string };
      /** Set session display name. */
      agentSetSessionName: { agentId: string; name: string };
      /** Switch to a different session. */
      agentSwitchSession: { agentId: string; sessionPath: string };
      /** Fork from a previous user message. */
      agentFork: { agentId: string; entryId: string };
      /** Export session to HTML. */
      agentExportHtml: { agentId: string; outputPath?: string };
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
        /** Set when this surface was spawned by runScript — webview uses it
         *  to place the surface in the target workspace and to register
         *  script-status tracking. */
        launchFor?: { workspaceId: string; scriptKey: string };
      };
      surfaceClosed: { surfaceId: string };
      /** Emitted when a surface's PTY exits. exitCode is whatever the shell
       *  returned to us (often 0 for clean Ctrl-D, non-zero on kill or script
       *  failure). The webview uses this to color script status dots red. */
      surfaceExited: { surfaceId: string; exitCode: number };

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

      // ── Browser surface lifecycle (bun → webview) ──
      browserSurfaceCreated: {
        surfaceId: string;
        url: string;
        splitFrom?: string;
        direction?: "horizontal" | "vertical";
      };
      /** Bun asks webview to close a browser surface (e.g. from socket API). */
      browserSurfaceClosed: { surfaceId: string };
      /** Bun sends cookies for injection into a browser pane. */
      browserInjectCookies: {
        surfaceId: string;
        cookies: Array<{
          name: string;
          value: string;
          path: string;
          expires: number;
          secure: boolean;
          sameSite: string;
        }>;
      };
      /** Cookie export data from bun to webview (for file download). */
      cookieExportResult: { data: string; format: string };
      /** Cookie action result notification. */
      cookieActionResult: { action: string; message: string };

      // ── Agent surface lifecycle (bun → webview) ──
      agentSurfaceCreated: {
        surfaceId: string;
        agentId: string;
        splitFrom?: string;
        direction?: "horizontal" | "vertical";
      };
      /** Bun forwards pi agent events to the webview. */
      agentEvent: {
        agentId: string;
        event: Record<string, unknown>;
      };
      /** Bun asks webview to close an agent surface. */
      agentSurfaceClosed: { surfaceId: string };
    };
  };
}
