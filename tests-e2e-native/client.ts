/**
 * Typed Unix-socket RPC client for the e2e harness.
 *
 * Mirrors the shape of `bin/ht`'s JSON-RPC calls so tests get completion and
 * compile-time shape checking on every method name + param list. The client is
 * intentionally flat (no generated types) — drift against a handler rename
 * will surface as a TS error in whichever spec uses the method, which is the
 * signal we want.
 *
 * Framing is **newline-delimited JSON** to match `src/bun/socket-server.ts`.
 */

import { connect as netConnect, type Socket } from "node:net";

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface WorkspaceListEntry {
  id: string;
  name: string;
  color: string;
  active: boolean;
  surface_count: number;
}

export interface SurfaceListEntry {
  id: string;
  pid: number;
  title: string;
  cwd: string;
}

export interface SurfaceMetadataDTO {
  pid: number;
  foregroundPid: number;
  cwd: string;
  tree: {
    pid: number;
    ppid: number;
    command: string;
    cpu: number;
    rssKb: number;
  }[];
  listeningPorts: {
    pid: number;
    port: number;
    proto: "tcp" | "tcp6";
    address: string;
  }[];
  git: unknown | null;
  packageJson: {
    path: string;
    directory: string;
    name?: string;
    version?: string;
    type?: string;
    description?: string;
    scripts?: Record<string, string>;
  } | null;
  updatedAt: number;
}

export interface PaneListEntry {
  surface_id: string;
  focused: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanelDescriptor {
  id: string;
  type: string;
  position?: string;
  width?: number | "auto";
  height?: number | "auto";
  createdAt: number;
  updatedAt: number;
}

export interface BrowserSurfaceInfo {
  id: string;
  url: string;
  title: string;
  zoom: number;
  partition?: string;
}

export interface NotificationEntry {
  id: string;
  title: string;
  body: string;
  time: number;
}

export interface PingVerbose {
  pong: "PONG";
  pid: number;
  uptimeMs: number;
}

// ── Tier 2 types ──────────────────────────────────────────────────────────

export interface WebviewState {
  sidebarVisible: boolean;
  paletteVisible: boolean;
  paletteQuery: string;
  settingsPanelVisible: boolean;
  processManagerVisible: boolean;
  searchBarVisible: boolean;
  focusedSurfaceId: string | null;
  activeSurfaceType: "terminal" | "browser" | "agent" | null;
  activeWorkspaceId: string | null;
  fontSize: number;
}

export interface PaletteCommandDTO {
  id: string;
  label: string;
  category: string | null;
  description: string | null;
  shortcut: string | null;
}

export interface ActiveDialog {
  title: string;
  message: string | null;
  value: string;
  placeholder: string;
}

export interface KeydownParams {
  key: string;
  meta?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
}

/** Typed surface for the socket RPC. Groups flat method names into namespaces
 *  so tests read naturally: `rpc.workspace.list()`, `rpc.surface.split({...})`.
 *  Every method maps 1:1 to a JSON-RPC method on the bun side.
 *
 *  The `call<T>` escape hatch covers anything not yet typed here. */
export interface SocketRpc {
  close(): void;

  system: {
    ping(verbose?: boolean): Promise<"PONG" | PingVerbose>;
    version(): Promise<string>;
    capabilities(): Promise<{
      protocol: string;
      version: number;
      methods: string[];
    }>;
    shutdown(): Promise<{ ok: true }>;
  };

  workspace: {
    list(): Promise<WorkspaceListEntry[]>;
    current(): Promise<unknown>;
    create(params?: { cwd?: string }): Promise<"OK">;
    select(params: { workspace_id: string }): Promise<"OK">;
    close(params: { workspace_id: string }): Promise<"OK">;
    rename(params: { workspace_id: string; name: string }): Promise<"OK">;
    next(): Promise<"OK">;
    previous(): Promise<"OK">;
  };

  surface: {
    list(): Promise<SurfaceListEntry[]>;
    metadata(params?: {
      surface_id?: string;
    }): Promise<SurfaceMetadataDTO | null>;
    split(params: {
      direction: "horizontal" | "vertical";
      cwd?: string;
    }): Promise<"OK">;
    close(params?: { surface_id?: string }): Promise<"OK">;
    focus(params: { surface_id: string }): Promise<"OK">;
    rename(params: { surface_id: string; title: string }): Promise<"OK">;
    send_text(params: { surface_id?: string; text: string }): Promise<"OK">;
    send_key(params: { surface_id?: string; key: string }): Promise<"OK">;
    read_text(params?: {
      surface_id?: string;
      lines?: number;
      scrollback?: boolean;
    }): Promise<string>;
    kill_pid(params: { pid: number; signal?: string }): Promise<unknown>;
  };

  pane: {
    list(): Promise<PaneListEntry[]>;
  };

  panel: {
    list(params?: { surface_id?: string }): Promise<PanelDescriptor[]>;
  };

  script: {
    run(params: {
      cwd: string;
      command: string;
      workspace_id?: string;
      script_key?: string;
    }): Promise<{ ok: true; scriptKey: string }>;
  };

  browser: {
    list(): Promise<BrowserSurfaceInfo[]>;
    open(params?: { url?: string }): Promise<"OK">;
    navigate(params: { surface_id: string; url: string }): Promise<"OK">;
    url(params: { surface_id: string }): Promise<string | null>;
    identify(params?: {
      surface_id?: string;
    }): Promise<BrowserSurfaceInfo | null>;
    close(params: { surface_id: string }): Promise<"OK">;
  };

  notification: {
    list(): Promise<NotificationEntry[]>;
    clear(): Promise<"OK">;
    create(params: {
      title: string;
      body: string;
      surface_id?: string;
    }): Promise<"OK">;
  };

  /** Tier 2 webview-state + driver namespace. Every method routes through a
   *  test-only webview IPC and is only available when the app was launched
   *  with `HYPERTERM_TEST_MODE=1` + `HT_CONFIG_DIR` under `/tmp`. Calls made
   *  without the gate succeed at the socket layer but fail at dispatch with
   *  `Unknown method: __test.*`. */
  ui: {
    keydown(params: KeydownParams): Promise<{ ok: true }>;
    dispatchEvent(params: {
      type: string;
      detail?: unknown;
    }): Promise<{ ok: true } | { ok: false; reason: string }>;
    readState(): Promise<WebviewState>;
    readPaletteCommands(): Promise<PaletteCommandDTO[]>;
    setPaletteQuery(
      query: string,
    ): Promise<{ ok: true; query: string } | { ok: false }>;
    executePalette(): Promise<
      { ok: true; id: string; label: string } | { ok: false }
    >;
    readDialog(): Promise<ActiveDialog | null>;
    submitDialog(value: string): Promise<{ ok: boolean }>;
    cancelDialog(): Promise<{ ok: boolean }>;
    openRenameWorkspaceDialog(params: {
      workspaceId: string;
      name: string;
    }): Promise<{ ok: true } | { ok: false; reason: string }>;
    openRenameSurfaceDialog(params: {
      surfaceId: string;
      title: string;
    }): Promise<{ ok: true } | { ok: false; reason: string }>;
    readSettingsField(key: string): Promise<unknown>;
    setSettingsField(key: string, value: unknown): Promise<{ ok: true }>;
    openPalette(): Promise<{ ok: true }>;
    openSettings(): Promise<{ ok: true }>;
    toggleProcessManager(): Promise<{ ok: true }>;
    toggleSidebar(): Promise<{ ok: true }>;
    getWindowId(): Promise<number | null>;
    getWindowBounds(): Promise<{
      width: number;
      height: number;
      devicePixelRatio: number;
    } | null>;
  };

  /** Escape hatch for methods not yet typed. Prefer the typed namespaces above. */
  call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
}

class RpcClient implements SocketRpc {
  private socket: Socket;
  private buffer = "";
  private seq = 1;
  private pending = new Map<number, PendingCall>();
  private closed = false;
  private defaultTimeoutMs: number;

  constructor(socket: Socket, defaultTimeoutMs = 10_000) {
    this.socket = socket;
    this.defaultTimeoutMs = defaultTimeoutMs;
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => this.onData(String(chunk)));
    socket.on("close", () => this.onClose(new Error("socket closed")));
    socket.on("error", (err) => this.onClose(err));
  }

  private onData(text: string): void {
    this.buffer += text;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg: { id: number; result?: unknown; error?: string };
      try {
        msg = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const entry = this.pending.get(msg.id);
      if (!entry) continue;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(msg.error));
      else entry.resolve(msg.result);
    }
  }

  private onClose(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error("client closed"));
    const id = this.seq++;
    const payload = JSON.stringify({ id, method, params }) + "\n";
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(
            new Error(
              `rpc timeout: ${method} after ${timeoutMs ?? this.defaultTimeoutMs}ms`,
            ),
          );
        }
      }, timeoutMs ?? this.defaultTimeoutMs);
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });
      this.socket.write(payload);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.end();
    } catch {
      /* ignore */
    }
  }

  system = {
    ping: (verbose?: boolean) =>
      this.call<"PONG" | PingVerbose>(
        "system.ping",
        verbose ? { verbose: true } : {},
      ),
    version: () => this.call<string>("system.version"),
    capabilities: () =>
      this.call<{ protocol: string; version: number; methods: string[] }>(
        "system.capabilities",
      ),
    shutdown: () => this.call<{ ok: true }>("system.shutdown"),
  };

  workspace = {
    list: () => this.call<WorkspaceListEntry[]>("workspace.list"),
    current: () => this.call<unknown>("workspace.current"),
    create: (params: { cwd?: string } = {}) =>
      this.call<"OK">("workspace.create", params),
    select: (params: { workspace_id: string }) =>
      this.call<"OK">("workspace.select", params),
    close: (params: { workspace_id: string }) =>
      this.call<"OK">("workspace.close", params),
    rename: (params: { workspace_id: string; name: string }) =>
      this.call<"OK">("workspace.rename", params),
    next: () => this.call<"OK">("workspace.next"),
    previous: () => this.call<"OK">("workspace.previous"),
  };

  surface = {
    list: () => this.call<SurfaceListEntry[]>("surface.list"),
    metadata: (params: { surface_id?: string } = {}) =>
      this.call<SurfaceMetadataDTO | null>("surface.metadata", params),
    split: (params: { direction: "horizontal" | "vertical"; cwd?: string }) =>
      this.call<"OK">("surface.split", params),
    close: (params: { surface_id?: string } = {}) =>
      this.call<"OK">("surface.close", params),
    focus: (params: { surface_id: string }) =>
      this.call<"OK">("surface.focus", params),
    rename: (params: { surface_id: string; title: string }) =>
      this.call<"OK">("surface.rename", params),
    send_text: (params: { surface_id?: string; text: string }) =>
      this.call<"OK">("surface.send_text", params),
    send_key: (params: { surface_id?: string; key: string }) =>
      this.call<"OK">("surface.send_key", params),
    read_text: (
      params: {
        surface_id?: string;
        lines?: number;
        scrollback?: boolean;
      } = {},
    ) => this.call<string>("surface.read_text", params),
    kill_pid: (params: { pid: number; signal?: string }) =>
      this.call<unknown>("surface.kill_pid", params),
  };

  pane = {
    list: () => this.call<PaneListEntry[]>("pane.list"),
  };

  panel = {
    list: (params: { surface_id?: string } = {}) =>
      this.call<PanelDescriptor[]>("panel.list", params),
  };

  script = {
    run: (params: {
      cwd: string;
      command: string;
      workspace_id?: string;
      script_key?: string;
    }) => this.call<{ ok: true; scriptKey: string }>("script.run", params),
  };

  browser = {
    list: () => this.call<BrowserSurfaceInfo[]>("browser.list"),
    open: (params: { url?: string } = {}) =>
      this.call<"OK">("browser.open", params),
    navigate: (params: { surface_id: string; url: string }) =>
      this.call<"OK">("browser.navigate", params),
    url: (params: { surface_id: string }) =>
      this.call<string | null>("browser.url", params),
    identify: (params: { surface_id?: string } = {}) =>
      this.call<BrowserSurfaceInfo | null>("browser.identify", params),
    close: (params: { surface_id: string }) =>
      this.call<"OK">("browser.close", params),
  };

  notification = {
    list: () => this.call<NotificationEntry[]>("notification.list"),
    clear: () => this.call<"OK">("notification.clear"),
    create: (params: { title: string; body: string; surface_id?: string }) =>
      this.call<"OK">("notification.create", params),
  };

  ui = {
    keydown: (params: KeydownParams) =>
      this.call<{ ok: true }>("__test.keydown", params),
    dispatchEvent: (params: { type: string; detail?: unknown }) =>
      this.call<{ ok: true } | { ok: false; reason: string }>(
        "__test.dispatchEvent",
        params as Record<string, unknown>,
      ),
    readState: () => this.call<WebviewState>("__test.readWebviewState"),
    readPaletteCommands: () =>
      this.call<PaletteCommandDTO[]>("__test.readPaletteCommands"),
    setPaletteQuery: (query: string) =>
      this.call<{ ok: true; query: string } | { ok: false }>(
        "__test.setPaletteQuery",
        { query },
      ),
    executePalette: () =>
      this.call<{ ok: true; id: string; label: string } | { ok: false }>(
        "__test.executePalette",
      ),
    readDialog: () => this.call<ActiveDialog | null>("__test.readDialog"),
    submitDialog: (value: string) =>
      this.call<{ ok: boolean }>("__test.submitDialog", { value }),
    cancelDialog: () => this.call<{ ok: boolean }>("__test.cancelDialog"),
    openRenameWorkspaceDialog: (params: {
      workspaceId: string;
      name: string;
    }) =>
      this.call<{ ok: true } | { ok: false; reason: string }>(
        "__test.openRenameWorkspaceDialog",
        params,
      ),
    openRenameSurfaceDialog: (params: { surfaceId: string; title: string }) =>
      this.call<{ ok: true } | { ok: false; reason: string }>(
        "__test.openRenameSurfaceDialog",
        params,
      ),
    readSettingsField: (key: string) =>
      this.call<unknown>("__test.readSettingsField", { key }),
    setSettingsField: (key: string, value: unknown) =>
      this.call<{ ok: true }>("__test.setSettingsField", {
        key,
        value: value as Record<string, unknown>[string],
      }),
    openPalette: () => this.call<{ ok: true }>("__test.openPalette"),
    openSettings: () => this.call<{ ok: true }>("__test.openSettings"),
    toggleProcessManager: () =>
      this.call<{ ok: true }>("__test.toggleProcessManager"),
    toggleSidebar: () => this.call<{ ok: true }>("__test.toggleSidebar"),
    getWindowId: () => this.call<number | null>("__test.getWindowId"),
    getWindowBounds: () =>
      this.call<{
        width: number;
        height: number;
        devicePixelRatio: number;
      } | null>("__test.getWindowBounds"),
  };
}

/** Connect to a running app's Unix socket. Resolves once the socket is open. */
export async function connect(
  socketPath: string,
  defaultTimeoutMs = 10_000,
): Promise<SocketRpc> {
  return new Promise<SocketRpc>((resolve, reject) => {
    const socket = netConnect({ path: socketPath });
    const onError = (err: Error) => {
      socket.removeListener("connect", onConnect);
      reject(err);
    };
    const onConnect = () => {
      socket.removeListener("error", onError);
      resolve(new RpcClient(socket, defaultTimeoutMs));
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}
