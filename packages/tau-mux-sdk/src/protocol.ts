// Shared wire contract between an extension and the τ-mux host. This mirrors
// `src/shared/extension-types.ts` in the host repo; the constant + payload
// shapes are the stable public contract, intentionally duplicated so the SDK
// has zero dependency on host internals.

/** Sentinel tag on every frontend⇄host postMessage envelope. */
export const EXT_BRIDGE_TAG = "taumux-ext" as const;

/** Frontend (iframe) → host. */
export type ExtensionFrontendPayload =
  | {
      kind: "rpc-request";
      id: string;
      method: string;
      params: Record<string, unknown>;
    }
  | { kind: "backend-message"; data: unknown }
  | { kind: "frontend-ready" };

/** Host → frontend (iframe). */
export type ExtensionHostPayload =
  | { kind: "rpc-response"; id: string; result?: unknown; error?: string }
  | { kind: "backend-message"; data: unknown }
  | { kind: "lifecycle"; state: "starting" | "ready" | "exited"; code?: number }
  | { kind: "resize"; width: number; height: number };

/** The bridge envelope carried by `postMessage`. */
export interface BridgeEnvelope<P> {
  source: typeof EXT_BRIDGE_TAG;
  payload: P;
}

/** Generic RPC method — loose params, host-validated. Every τ-mux handler
 *  accepts a params record; methods with well-known shapes get richer
 *  signatures below, the long tail uses this. */
type M = (params?: Record<string, unknown>) => Promise<unknown>;

/**
 * The COMPLETE typed view of τ-mux's control surfaces. Extensions are fully
 * trusted: every JSON-RPC method the `ht` CLI can call is available here, from
 * BOTH the Bun backend (unix socket) and the Vite frontend (postMessage bridge
 * into the same dispatch table). `call(method, params)` remains the universal
 * escape hatch — any method the host registers, even ones added after this SDK
 * shipped, is callable by name.
 *
 * Data access is the read half of the same surface: `surface.metadata` (full
 * process tree, listening ports, git, package.json), `surface.readText`
 * (terminal contents), `surface.screenshot`, `workspace.list`,
 * `notification.list`, `telegram.history`, `browser.snapshot` / `get` /
 * console / cookies, `pane.list`, `panel.list`, `system.tree` / `health` /
 * `capabilities`, …
 */
export interface TauMuxApi {
  /** Raw escape hatch — call ANY RPC method by name. */
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;

  system: {
    ping: M;
    version: M;
    identify: M;
    capabilities: M;
    health: M;
    /** Full process tree of every surface (the metadata poller's view). */
    tree: M;
    /** Gracefully shut τ-mux down. Yes, extensions can do this. */
    shutdown: M;
  };

  workspace: {
    list: M;
    current: M;
    create: M;
    select: M; // { workspace_id | index | name }
    next: M;
    previous: M;
    rename: M; // { workspace_id?, name }
    close: M; // { workspace_id? }
  };

  surface: {
    list(): Promise<unknown>;
    split(opts?: {
      direction?: "right" | "down" | "horizontal" | "vertical";
      surface_id?: string;
      cwd?: string;
      shell?: string;
      ratio?: number;
    }): Promise<unknown>;
    close: M; // { surface_id? }
    focus: M; // { surface_id }
    rename(opts: {
      surfaceId?: string;
      surface_id?: string;
      title: string;
    }): Promise<unknown>;
    sendText(opts: {
      surfaceId?: string;
      surface_id?: string;
      text: string;
    }): Promise<unknown>;
    sendKey: M; // { surface_id?, key } — "enter", "ctrl+c", …
    readText: M; // { surface_id?, lines?, scrollback? } → terminal contents
    /** Live metadata: process tree, listening ports, git, package.json. */
    metadata: M; // { surface_id? }
    waitReady: M; // { surface_id?, timeout_ms? }
    openPort: M; // { surface_id?, port? }
    killPort: M; // { surface_id?, port, signal? }
    killPid: M; // { pid, signal? }
    screenshot: M; // { surface_id? | workspace? | full_window? , output? }
  };

  /** Native Claude Code pane + session observability. */
  claude: {
    /** Open a Claude Code pane. `{ cwd?, resume?, split?, direction? }` */
    pane: M;
    /** Accept a Claude Code terminal permission prompt. `{ surface_id? }` */
    approve: M;
    event: M;
    statusline: M;
    sessions: M;
  };

  sidebar: {
    /** Set a sidebar status chip / chart. Encode a chart renderer in the key
     *  suffix (e.g. `mykey_sparkline`) and pass comma-separated samples as
     *  `value` to draw a live graph. */
    setStatus(opts: {
      key: string;
      value: unknown;
      icon?: string;
      color?: string;
      workspaceId?: string;
    }): Promise<unknown>;
    clearStatus(opts: { key: string; workspaceId?: string }): Promise<unknown>;
    setProgress: M; // { value (0..1), label?, workspaceId? }
    clearProgress: M;
    log(opts: {
      message: string;
      level?: string;
      source?: string;
    }): Promise<unknown>;
  };

  notification: {
    create(opts: {
      title: string;
      body?: string;
      surfaceId?: string;
    }): Promise<unknown>;
    list: M;
    dismiss: M; // { id }
    clear: M;
  };

  /** Full browser-pane automation — open/navigate plus the Playwright-style
   *  driver surface (click/type/eval/snapshot/cookies/console/…). */
  browser: {
    open(opts: { url: string }): Promise<unknown>;
    openSplit: M; // { url?, direction? }
    navigate: M; // { surface_id?, url }
    back: M;
    forward: M;
    reload: M;
    close: M;
    url: M;
    list: M;
    identify: M;
    wait: M; // { selector? | text? | url_contains? | load_state? | function?, timeout_ms? }
    click: M; // { selector, … }
    dblclick: M;
    hover: M;
    focus: M;
    check: M;
    uncheck: M;
    scrollIntoView: M;
    type: M; // { selector, text }
    fill: M;
    press: M; // { key }
    select: M; // { selector, value }
    scroll: M; // { dx?, dy? }
    highlight: M;
    snapshot: M; // { selector?, max_depth? } → DOM snapshot
    get: M; // { what: title|url|text|html|value|attr|count|box|styles, selector? }
    is: M; // { what: visible|enabled|checked, selector }
    eval: M; // { script }
    addScript: M;
    addStyle: M;
    find: M; // find-in-page
    stopFind: M;
    devtools: M;
    consoleList: M;
    consoleClear: M;
    errorsList: M;
    errorsClear: M;
    history: M;
    clearHistory: M;
    cookieList: M;
    cookieGet: M;
    cookieSet: M;
    cookieDelete: M;
    cookieClear: M;
    cookieExport: M;
    cookieImport: M;
    cookieCapture: M;
  };

  /** Pi coding-agent panes. */
  agent: {
    list: M;
    count: M;
    create: M; // { provider?, model?, thinkingLevel?, cwd? }
    createSplit: M;
    close: M; // { agent_id | surface_id }
    /** Ask the human a question (modal). Long-pending — pass no timeout. */
    askUser: M; // { kind, title, message, choices?, … }
    askPending: M;
    askAnswer: M; // { request_id, value }
    askCancel: M; // { request_id, reason? }
  };

  telegram: {
    status: M;
    chats: M;
    history: M; // { chat_id, limit?, before? }
    send: M; // { chat_id, text }
    restart: M;
  };

  /** CodeMirror editor panes. */
  editor: {
    open: M; // { path?, cwd?, create?, split?, direction? }
    split: M;
    list: M;
    save: M; // { surface_id? }
    reload: M;
    close: M;
  };

  /** The extension platform itself — extensions can manage extensions. */
  extension: {
    list: M;
    templates: M;
    open: M; // { id, split?, direction? }
    split: M;
    new: M; // { id, template, name? }
    install: M; // { path }
    remove: M; // { id }
    enable: M; // { id }
    disable: M; // { id } — also stops any surfaces running it
    reload: M;
    stop: M; // { surface_id }
  };

  /** Plan panel (multi-step checklists). */
  plan: {
    set: M; // { steps, title?, … }
    update: M;
    complete: M;
    list: M;
    clear: M;
  };

  /** Auto-continue engine. */
  autoContinue: {
    status: M;
    set: M;
    pause: M;
    resume: M;
    fire: M;
    audit: M;
  };

  /** Built-in self-audits. */
  audit: {
    list: M;
    run: M;
    fix: M;
  };

  pane: { list: M };
  panel: { list: M };
  script: { run: M }; // { workspace_id, cwd, command, script_key }

  /** Claude Code integration (august-plan M1) — hook-event ingestion,
   *  statusline tee, and session observability. `event` / `statusline`
   *  are producer-facing (the ht-bridge and `ht claude statusline` are
   *  the normal callers); `sessions` is the read side. */
  claude: {
    event: M; // { event: ClaudeBridgeEvent }
    statusline: M; // { data: ClaudeStatuslineData }
    sessions: M; // { all? } → { sessions: ClaudeSessionState[] }
  };
}

/** Internal: wire-name table for the generated namespaces. Each entry is
 *  [apiName, wireName-without-prefix]. */
const NAMESPACES: Record<string, [string, string][]> = {
  system: [
    ["ping", "ping"],
    ["version", "version"],
    ["identify", "identify"],
    ["capabilities", "capabilities"],
    ["health", "health"],
    ["tree", "tree"],
    ["shutdown", "shutdown"],
  ],
  workspace: [
    ["list", "list"],
    ["current", "current"],
    ["create", "create"],
    ["select", "select"],
    ["next", "next"],
    ["previous", "previous"],
    ["rename", "rename"],
    ["close", "close"],
  ],
  surface: [
    ["list", "list"],
    ["split", "split"],
    ["close", "close"],
    ["focus", "focus"],
    ["rename", "rename"],
    ["sendText", "send_text"],
    ["sendKey", "send_key"],
    ["readText", "read_text"],
    ["metadata", "metadata"],
    ["waitReady", "wait_ready"],
    ["openPort", "open_port"],
    ["killPort", "kill_port"],
    ["killPid", "kill_pid"],
    ["screenshot", "screenshot"],
  ],
  sidebar: [
    ["setStatus", "set_status"],
    ["clearStatus", "clear_status"],
    ["setProgress", "set_progress"],
    ["clearProgress", "clear_progress"],
    ["log", "log"],
  ],
  notification: [
    ["create", "create"],
    ["list", "list"],
    ["dismiss", "dismiss"],
    ["clear", "clear"],
  ],
  browser: [
    ["open", "open"],
    ["openSplit", "open_split"],
    ["navigate", "navigate"],
    ["back", "back"],
    ["forward", "forward"],
    ["reload", "reload"],
    ["close", "close"],
    ["url", "url"],
    ["list", "list"],
    ["identify", "identify"],
    ["wait", "wait"],
    ["click", "click"],
    ["dblclick", "dblclick"],
    ["hover", "hover"],
    ["focus", "focus"],
    ["check", "check"],
    ["uncheck", "uncheck"],
    ["scrollIntoView", "scroll_into_view"],
    ["type", "type"],
    ["fill", "fill"],
    ["press", "press"],
    ["select", "select"],
    ["scroll", "scroll"],
    ["highlight", "highlight"],
    ["snapshot", "snapshot"],
    ["get", "get"],
    ["is", "is"],
    ["eval", "eval"],
    ["addScript", "addscript"],
    ["addStyle", "addstyle"],
    ["find", "find"],
    ["stopFind", "stop_find"],
    ["devtools", "devtools"],
    ["consoleList", "console_list"],
    ["consoleClear", "console_clear"],
    ["errorsList", "errors_list"],
    ["errorsClear", "errors_clear"],
    ["history", "history"],
    ["clearHistory", "clear_history"],
    ["cookieList", "cookie_list"],
    ["cookieGet", "cookie_get"],
    ["cookieSet", "cookie_set"],
    ["cookieDelete", "cookie_delete"],
    ["cookieClear", "cookie_clear"],
    ["cookieExport", "cookie_export"],
    ["cookieImport", "cookie_import"],
    ["cookieCapture", "cookie_capture"],
  ],
  agent: [
    ["list", "list"],
    ["count", "count"],
    ["create", "create"],
    ["createSplit", "create_split"],
    ["close", "close"],
    ["askUser", "ask_user"],
    ["askPending", "ask_pending"],
    ["askAnswer", "ask_answer"],
    ["askCancel", "ask_cancel"],
  ],
  telegram: [
    ["status", "status"],
    ["chats", "chats"],
    ["history", "history"],
    ["send", "send"],
    ["restart", "restart"],
  ],
  editor: [
    ["open", "open"],
    ["split", "split"],
    ["list", "list"],
    ["save", "save"],
    ["reload", "reload"],
    ["close", "close"],
  ],
  extension: [
    ["list", "list"],
    ["templates", "templates"],
    ["open", "open"],
    ["split", "split"],
    ["new", "new"],
    ["install", "install"],
    ["remove", "remove"],
    ["enable", "enable"],
    ["disable", "disable"],
    ["reload", "reload"],
    ["stop", "stop"],
  ],
  plan: [
    ["set", "set"],
    ["update", "update"],
    ["complete", "complete"],
    ["list", "list"],
    ["clear", "clear"],
  ],
  audit: [
    ["list", "list"],
    ["run", "run"],
    ["fix", "fix"],
  ],
  claude: [
    ["pane", "pane"],
    ["approve", "approve"],
    ["event", "event"],
    ["statusline", "statusline"],
    ["sessions", "sessions"],
  ],
  pane: [["list", "list"]],
  panel: [["list", "list"]],
  script: [["run", "run"]],
};

/** `autoContinue` maps to the `autocontinue.*` wire prefix (no underscore). */
const AUTOCONTINUE: [string, string][] = [
  ["status", "status"],
  ["set", "set"],
  ["pause", "pause"],
  ["resume", "resume"],
  ["fire", "fire"],
  ["audit", "audit"],
];

/** Build the full typed facade over a raw `call`. Shared by the backend and
 *  frontend SDKs so both expose an identical, COMPLETE surface. */
export function makeApi(
  call: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): TauMuxApi {
  const ns = (prefix: string, entries: [string, string][]) =>
    Object.fromEntries(
      entries.map(([apiName, wire]) => [
        apiName,
        (params?: Record<string, unknown>) =>
          call(`${prefix}.${wire}`, params ?? {}),
      ]),
    );

  const api = { call } as Record<string, unknown>;
  for (const [prefix, entries] of Object.entries(NAMESPACES)) {
    api[prefix] = ns(prefix, entries);
  }
  api["autoContinue"] = ns("autocontinue", AUTOCONTINUE);
  return api as unknown as TauMuxApi;
}
