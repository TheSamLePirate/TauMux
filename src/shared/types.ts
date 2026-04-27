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
  surfaceType?: "terminal" | "browser" | "agent" | "telegram";
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
  surfaceTypes?: Record<string, "terminal" | "browser" | "agent" | "telegram">;
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

/** Subset of Cargo.toml we surface in the UI. Parallel to `PackageInfo`
 *  but sourced from a Rust project's manifest. Scripts are synthesized
 *  at render time from the fixed set of common cargo subcommands plus
 *  one entry per declared binary target. */
export interface CargoInfo {
  /** Absolute path to the Cargo.toml file; unique key per workspace. */
  path: string;
  /** Absolute path to the directory containing Cargo.toml. */
  directory: string;
  name?: string;
  version?: string;
  /** Rust edition ("2015", "2018", "2021", "2024"). Always stringified. */
  edition?: string;
  description?: string;
  /** Binary target names — union of declared `[[bin]]` entries and the
   *  package's implicit default (package.name when no `[[bin]]` block
   *  is present). Empty for a virtual workspace root manifest. */
  binaries: string[];
  /** Feature flag names declared under `[features]`. */
  features: string[];
  /** True when this Cargo.toml is a virtual workspace root (has
   *  `[workspace]` but no `[package]`). The UI renders it without
   *  per-binary actions. */
  isWorkspace: boolean;
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
  /** Nearest Cargo.toml walking up from cwd, or null when none found. */
  cargoToml: CargoInfo | null;
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

// --- Sideband meta messages ---
// Discriminated on `type`. Two shapes:
//   - SidebandFlushMessage: protocol op that resets a data channel.
//   - SidebandContentMessage: everything else (protocol ops "update"/"clear"
//     and content-renderer dispatches like "image"/"svg"/"html"/custom).

/** Non-flush content / op type — everything except the data-channel reset. */
export type SidebandContentKind =
  | "update"
  | "clear"
  | BuiltinContentType
  | (string & {});

export interface SidebandFlushMessage {
  id: string;
  type: "flush";
  /** Named data channel to flush (default: "data" = fd4). */
  dataChannel?: string;
}

export interface SidebandContentMessage {
  id: string;
  type: SidebandContentKind;
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

export type SidebandMetaMessage = SidebandFlushMessage | SidebandContentMessage;

// --- Panel events ---
// Events flow from rendered panels back to their content scripts. The
// JSON wire form carries an `event` discriminator plus fields specific
// to each event kind.

export type PanelPointerEventName =
  | "mousedown"
  | "mouseup"
  | "click"
  | "mousemove"
  | "mouseenter"
  | "mouseleave";

export interface PanelPointerEvent {
  id: string;
  event: PanelPointerEventName;
  x: number;
  y: number;
  button?: number;
  buttons?: number;
}

export interface PanelWheelEvent {
  id: string;
  event: "wheel";
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  buttons?: number;
}

export interface PanelDragEndEvent {
  id: string;
  event: "dragend";
  x: number;
  y: number;
}

export interface PanelResizeEvent {
  id: string;
  event: "resize";
  width?: number;
  height?: number;
  /** Terminal cell columns — set when the resize is reporting the pane
   *  terminal size (used by __terminal__ pseudo-panel). */
  cols?: number;
  rows?: number;
  pxWidth?: number;
  pxHeight?: number;
}

export interface PanelCloseEvent {
  id: string;
  event: "close";
}

export interface PanelErrorEvent {
  id: string;
  event: "error";
  /** Error code for system error events (id="__system__", event="error") */
  code?: string;
  /** Human-readable message for system error events */
  message?: string;
  /** Reference panel id that triggered the error or ack */
  ref?: string;
}

export type PanelEvent =
  | PanelPointerEvent
  | PanelWheelEvent
  | PanelDragEndEvent
  | PanelResizeEvent
  | PanelCloseEvent
  | PanelErrorEvent;

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
// ── Plan #10: agent → user question protocol ────────────────────────
// An agent (CLI / future model integration) calls `agent.ask_user`
// when it needs human input. The bun-side queue holds the request
// until the user answers via the matching CLI / panel / Telegram
// path; the original `ht ask` invocation blocks on stdout until the
// resolution comes back. Optional `timeout_ms` lets agents bound
// the wait; rejected with `action: "timeout"` when it elapses.
export type AskUserKind = "yesno" | "choice" | "text" | "confirm-command";

export interface AskUserChoice {
  id: string;
  label: string;
}

export interface AskUserRequest {
  /** Stable id assigned by the queue when the request lands.
   *  Surfaced by `agent.ask_pending` so a sibling CLI / UI can
   *  dispatch a response by id. */
  request_id: string;
  /** Originating surface — drives where the future modal panel
   *  anchors and which surface gets focus on resolve. Required even
   *  for headless callers; the CLI forwards `HT_SURFACE`. */
  surface_id: string;
  /** Optional agent id (e.g. `claude:1`) for attribution. Allows
   *  multiple agents to ask questions on the same surface. */
  agent_id?: string;
  kind: AskUserKind;
  /** One-line prompt. */
  title: string;
  /** Optional multi-line body — markdown is allowed when the panel
   *  lands; the CLI prints it verbatim. */
  body?: string;
  /** For `kind === "choice"`: the available picks. Empty for other
   *  kinds. */
  choices?: AskUserChoice[];
  /** Pre-filled / preselected value (interpreted per-kind). */
  default?: string;
  /** Auto-cancel-with-timeout after this many ms. 0 / undefined =
   *  wait forever. */
  timeout_ms?: number;
  /** Hint: render with a "destructive" treatment (used for
   *  confirm-command). */
  unsafe?: boolean;
  /** Wall-clock ms when the request landed in the queue. */
  created_at: number;
}

export interface AskUserResponse {
  request_id: string;
  action: "ok" | "cancel" | "timeout";
  /** The chosen value:
   *    yesno         — "yes" or "no"
   *    choice        — the chosen choice id
   *    text          — the typed string
   *    confirm-command — "run" on accept; absent on cancel/timeout
   */
  value?: string;
  /** Optional human-readable reason (e.g. user supplied a cancel
   *  message). Surfaced by `ht ask` on stderr for context. */
  reason?: string;
}

// ── Plan #09: agent plan store ───────────────────────────────────────
// Each plan step carries an opaque short id (`M1` / `step-3` / …),
// a human-readable title, and a state. `done` / `active` / `waiting`
// are the canonical states; `err` lands a step in red and is the
// signal the auto-continue engine uses to bail rather than push the
// agent forward over a failure.
export type PlanStepState = "done" | "active" | "waiting" | "err";

export interface PlanStep {
  /** Stable identifier — typically the agent's own step label
   *  (`M1`, `M2`, …). Used by `ht plan update <id> --state …`. */
  id: string;
  title: string;
  state: PlanStepState;
}

export interface Plan {
  /** Workspace this plan belongs to. */
  workspaceId: string;
  /** Optional agent id (e.g. `claude:1`). When omitted, treated as
   *  the workspace-level plan — useful when only one agent runs in
   *  the workspace and the user doesn't care to scope. */
  agentId?: string;
  steps: PlanStep[];
  /** Wall-clock ms of the most recent set/update. */
  updatedAt: number;
}

// ── Plan #09 commit B: auto-continue audit ring ─────────────────────
// One entry per decision the auto-continue engine made. Pushed to the
// webview + web mirror via the `autoContinueAudit` envelope so the
// sidebar can show a rolling history; capped at 50 entries in memory
// (engine-side AUDIT_CAP).
export interface AutoContinueAuditEntry {
  /** Wall-clock ms when the decision landed. */
  at: number;
  /** Surface that fired the turn-end notification. */
  surfaceId: string;
  /** Optional agent id from the plan, when known. */
  agentId?: string;
  /** Outcome the engine produced — `fired` actually sent the
   *  instruction, `dry-run` logged it, `skipped` waited (cooldown,
   *  loop, heuristic, etc). */
  outcome: "fired" | "dry-run" | "skipped";
  /** One-sentence reason for the outcome — surfaced verbatim in the
   *  sidebar audit log. */
  reason: string;
  /** Engine mode at decision time. */
  engine: "off" | "heuristic" | "model" | "hybrid";
  /** Whether an LLM call participated in the decision. */
  modelConsulted: boolean;
}

// webview.messages = what webview RECEIVES from bun

export interface TauMuxRPC extends ElectrobunRPCSchema {
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

      // Generic webview → bun response, used by Tier 2 `__test.*` round-trips
      // and any future read-style RPC. `result` is opaque JSON.
      webviewResponse: { reqId: string; result: unknown };

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
          surfaceTypes?: Record<
            string,
            "terminal" | "browser" | "agent" | "telegram"
          >;
        }[];
        activeWorkspaceId: string | null;
      };

      // Sidebar
      sidebarToggle: { visible: boolean };

      // Notifications
      clearNotifications: void;
      dismissNotification: { id: string };

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

      // Reveal the active log file in Finder. Webview triggers this from
      // the Settings → Advanced "Reveal" button; same end-effect as the
      // top-level "Reveal Log File in Finder" menu item.
      revealLogFile: void;

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

      // ── Telegram (webview → bun) ──
      /** Open a new Telegram pane in the active workspace. */
      createTelegramSurface: { chatId?: string };
      /** Split the focused pane and place a new Telegram pane there. */
      splitTelegramSurface: {
        direction: "horizontal" | "vertical";
        chatId?: string;
      };
      /** Send a message via the bot. */
      telegramSend: { chatId: string; text: string };
      /** Request history for a chat (used on pane open + scroll-up). */
      telegramRequestHistory: {
        chatId: string;
        limit?: number;
        before?: number;
      };
      /** Request the current chat list + service status. */
      telegramRequestState: void;

      // ── Plan #10 commit C: ask-user (webview → bun) ──
      /** Resolve a pending agent → user question with the user's
       *  answer. The bun-side queue's `resolved` subscriber fans out
       *  the matching `askUserEvent` push to the webview + Telegram
       *  edit-in-place; the webview shouldn't pre-empt either. */
      askUserAnswer: { request_id: string; value: string };
      /** Cancel a pending agent → user question. Optional `reason`
       *  reaches the agent's stderr via the CLI. */
      askUserCancel: { request_id: string; reason?: string };
      /** Ask bun to broadcast the current pending list as a
       *  `askUserEvent: kind=snapshot` push. The webview calls this
       *  once on bootstrap (and after a reconnect) to seed the
       *  modal's per-surface store from bun's authoritative state. */
      askUserRequestSnapshot: void;
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
      sidebandMeta: SidebandContentMessage & { surfaceId: string };
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

      // Static runtime paths surfaced to the Settings → Advanced panel.
      // Sent once at startup; values do not change for the lifetime of
      // the app (logPath rotates daily but the panel re-fetches via the
      // RPC `system.identify` if you really need today's path).
      restoreDiagnostics: {
        logPath: string | null;
        socketPath: string;
        configDir: string;
      };

      // Cumulative list of `ht set-status` key names seen since the
      // app booted, in insertion order. Powers the Settings → Layout
      // "Discovered ht keys" subsection. Pushed (debounced 200 ms)
      // every time a new key fires; never pruned — keys that stop
      // firing stay listed so the user's hide / reorder choices
      // persist.
      restoreHtKeysSeen: { keys: string[] };

      // Plan #09 — every active plan in the bun-side PlanStore. Pushed
      // (debounced 100 ms) on every set / update / complete / clear so
      // the webview's plan panel can render without polling. The wire
      // shape is the same `Plan[]` callers receive from `plan.list`.
      restorePlans: { plans: Plan[] };

      // Plan #09 commit B — auto-continue audit ring. Debounced (100 ms)
      // so a flurry of decisions during a busy turn doesn't spam the
      // webview. Each entry is a single decision the engine made;
      // newest last, capped at 50 in memory.
      autoContinueAudit: { audit: AutoContinueAuditEntry[] };

      // Plan #10 — pending agent → user questions. The future modal
      // panel listens on this channel. `kind: "shown"` covers add +
      // update; `kind: "resolved"` carries the response so the panel
      // can fade out the matching card.
      askUserEvent:
        | {
            kind: "shown";
            request: AskUserRequest;
          }
        | {
            kind: "resolved";
            request_id: string;
            response: AskUserResponse;
          }
        | {
            kind: "snapshot";
            pending: AskUserRequest[];
          };

      // Socket API dispatched actions (bun → webview)
      socketAction: { action: string; payload: Record<string, unknown> };

      // Tier 2: bun tells the webview to enable its `__test.*` handler
      // router. Only sent when the dual-fact runtime gate (env var +
      // /tmp configDir) passes in bun. Production never sends this.
      enableTestMode: { enabled: boolean };

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

      // ── Telegram (bun → webview) ──
      /** Open the Telegram pane in the webview. The pane manages its
       *  own active-chat selection; no chat binding at the layout
       *  level (different from browser surfaces, which carry url). */
      telegramSurfaceCreated: {
        surfaceId: string;
        splitFrom?: string;
        direction?: "horizontal" | "vertical";
      };
      /** Push a single new message to whichever pane is showing this chat. */
      telegramMessage: { surfaceId?: string; message: TelegramWireMessage };
      /** Reply to a `telegramRequestHistory` call. */
      telegramHistory: {
        chatId: string;
        messages: TelegramWireMessage[];
        /** True when the returned page is the most recent one (no newer
         *  rows exist). Drives the pane's "scroll-to-bottom" behavior. */
        isLatest: boolean;
      };
      /** Service status + chat list snapshot. Sent on connect and on any
       *  status change (token edit, restart, polling failure). */
      telegramState: {
        status: TelegramStatusWire;
        chats: TelegramChatWire[];
      };
    };
  };
}

/** Wire shape for a single Telegram message — flat, JSON-friendly. */
export interface TelegramWireMessage {
  id: number;
  chatId: string;
  direction: "in" | "out";
  text: string;
  ts: number;
  fromName: string | null;
  /** Telegram-side message id. Always present on inbound rows; null on
   *  outbound rows whose API call failed (rate-limit, bad chat, network).
   *  UI uses null to render a "failed" badge + retry handle. */
  tgMessageId: number | null;
}

export interface TelegramChatWire {
  id: string;
  name: string;
  lastSeen: number;
}

export interface TelegramStatusWire {
  /** `conflict` means Telegram returned HTTP 409 on getUpdates — another
   *  consumer (a second τ-mux instance, a different bot framework, or a
   *  configured webhook) owns the bot token. The poll loop stays
   *  enabled but backs off long so it doesn't spam the log; the user
   *  has to stop the other consumer (or switch to a separate bot
   *  token) for this bot to resume. */
  state: "disabled" | "starting" | "polling" | "conflict" | "error";
  error?: string;
  botUsername?: string;
}
