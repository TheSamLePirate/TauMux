/**
 * τ-mux as a Claude Code **IDE host**.
 *
 * Claude Code can attach to an editor and gain capabilities it does not
 * have from a terminal alone — chiefly showing a proposed edit as a diff
 * and waiting for a human verdict. It discovers one by scanning
 * `~/.claude/ide/` for `<port>.lock` files and connecting to the port as
 * an MCP server over WebSocket.
 *
 * Every rendering host for that protocol today is an editor. τ-mux is a
 * terminal that *contains* an editor pane, a notification centre and a
 * Telegram bridge — so `claude` running in a pane can put a diff in the
 * pane next door and ask for approval that reaches a phone.
 *
 * ## The protocol, as observed
 *
 * Recovered by running Claude Code 2.1.225 against an instrumented
 * server (`scripts/ide-spike.ts`), not from documentation:
 *
 * - Discovery: `~/.claude/ide/<port>.lock`. The **port comes from the
 *   filename**; the JSON body carries
 *   `{pid, workspaceFolders, ideName, transport, runningInWindows, authToken}`.
 * - `transport: "ws"` selects `ws://host:port`; anything else means
 *   `http://host:port/sse`.
 * - The lock's `pid` must be live and an ancestor of the `claude`
 *   process, or the lock is ignored — and a lock whose pid is dead gets
 *   **deleted by Claude Code**.
 * - Upgrade carries `Sec-WebSocket-Protocol: mcp` and
 *   `x-claude-code-ide-authorization: <authToken>`.
 * - Then plain MCP: `initialize` → `notifications/initialized` →
 *   `ide_connected` (a notification *from* Claude, carrying its pid) →
 *   `tools/list`.
 *
 * ## Security
 *
 * Bound to 127.0.0.1 only, and every upgrade must present the token from
 * the lock file — which is `0600` and regenerated per launch. The port
 * is ephemeral. A process that cannot read the lock cannot connect, and
 * nothing off-machine can reach it at all.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Directory Claude Code scans. Fixed by the client, not by us. */
export function ideLockDir(home = homedir()): string {
  return join(home, ".claude", "ide");
}

/** The header carrying the lock file's `authToken`. */
export const IDE_AUTH_HEADER = "x-claude-code-ide-authorization";

/** Subprotocol Claude Code requests on upgrade. */
export const IDE_SUBPROTOCOL = "mcp";

/** Outcome of a diff review, in the exact shape Claude Code decodes.
 *  It reads `[0].text` as the verdict and, for `FILE_SAVED`, `[1].text`
 *  as the content to apply — so the pair is load-bearing, not decorative. */
export type DiffOutcome =
  | { verdict: "FILE_SAVED"; content: string }
  | { verdict: "DIFF_REJECTED" }
  | { verdict: "TAB_CLOSED" };

export function encodeDiffOutcome(
  outcome: DiffOutcome,
): { type: "text"; text: string }[] {
  if (outcome.verdict === "FILE_SAVED") {
    return [
      { type: "text", text: "FILE_SAVED" },
      { type: "text", text: outcome.content },
    ];
  }
  return [{ type: "text", text: outcome.verdict }];
}

export interface OpenDiffRequest {
  oldPath: string;
  newPath: string;
  newContents: string;
  tabName: string;
}

export interface IdeServerDeps {
  /** Directories this τ-mux window is working in. Claude Code uses them
   *  to decide whether an IDE is relevant to its cwd. */
  workspaceFolders: () => string[];
  /** Show the proposal and get a verdict. Implemented over the existing
   *  ask-user queue, so the approval also reaches Telegram. */
  reviewDiff: (req: OpenDiffRequest) => Promise<DiffOutcome>;
  /** Close a review surface Claude has given up on. */
  closeDiff: (tabName: string) => void;
  /** Structured log sink. */
  log?: (message: string) => void;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

/** MCP revision we advertise when the client does not state one. The
 *  client's own version is echoed back when present, which is what the
 *  spec asks for and what avoids a version fight we cannot win. */
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

export class IdeServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private lockPath: string | null = null;
  private token = "";
  private clients = new Set<{ send(data: string): void }>();
  /** Claude Code's pid, from the `ide_connected` notification. */
  private clientPid: number | null = null;
  /** Serialised folder list last written, so `refreshLock` can skip the
   *  write when nothing moved. */
  private lastFolders = "";

  constructor(
    private readonly deps: IdeServerDeps,
    private readonly lockDir: string = ideLockDir(),
  ) {}

  get running(): boolean {
    return this.server !== null;
  }
  get port(): number | null {
    return this.server?.port ?? null;
  }
  get connected(): boolean {
    return this.clients.size > 0;
  }
  get connectedPid(): number | null {
    return this.clientPid;
  }

  private log(message: string): void {
    (this.deps.log ?? ((m: string) => console.log(m)))(`[ide] ${message}`);
  }

  start(): void {
    if (this.server) return;
    this.token = randomBytes(24).toString("hex");

    // Port 0 → the OS picks a free one, which we then learn from the
    // server. Claude Code reads the port from the *lock filename*, so it
    // has to be written after binding, never guessed before.
    this.server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req, srv) => {
        if (req.headers.get(IDE_AUTH_HEADER) !== this.token) {
          this.log("rejected an upgrade with a bad or missing token");
          return new Response("unauthorized", { status: 401 });
        }
        if (srv.upgrade(req, { data: {} })) return undefined;
        return new Response("expected a websocket upgrade", { status: 400 });
      },
      websocket: {
        open: (ws) => {
          this.clients.add(ws);
        },
        message: (ws, raw) => {
          this.handleMessage(ws, String(raw));
        },
        close: (ws) => {
          this.clients.delete(ws);
          if (this.clients.size === 0) this.clientPid = null;
          this.log("client disconnected");
        },
      },
    });

    this.lastFolders = "";
    this.writeLock();
    this.log(`listening on 127.0.0.1:${this.port} (lock: ${this.lockPath})`);
  }

  stop(): void {
    if (!this.server) return;
    this.removeLock();
    for (const ws of this.clients) {
      try {
        (ws as unknown as { close(): void }).close();
      } catch {
        /* already gone */
      }
    }
    this.clients.clear();
    this.clientPid = null;
    this.server.stop(true);
    this.server = null;
    this.log("stopped");
  }

  /**
   * Re-write the lock with the current workspace folders.
   *
   * The lock is written at startup, before any pane exists, so its
   * folder list starts empty — and Claude Code reads the lock when
   * *it* launches, which is always later. Without a refresh the
   * advertisement permanently describes a window with no directories.
   *
   * Cheap and idempotent: skipped entirely when the list is unchanged,
   * which is the common case for a layout event that moved a divider.
   */
  refreshLock(): void {
    if (!this.server || !this.lockPath) return;
    const next = JSON.stringify(this.deps.workspaceFolders());
    if (next === this.lastFolders) return;
    this.lastFolders = next;
    this.writeLock();
  }

  /** Tell a connected Claude Code that the user's editor selection
   *  moved. Fire-and-forget: it is a notification, and a client that
   *  went away is not an error. */
  notifySelectionChanged(payload: Record<string, unknown>): void {
    this.broadcast({
      jsonrpc: "2.0",
      method: "selection_changed",
      params: payload,
    });
  }

  /** Push an `@`-mention (a file the user picked in τ-mux) into Claude
   *  Code's prompt. */
  notifyAtMentioned(payload: Record<string, unknown>): void {
    this.broadcast({ jsonrpc: "2.0", method: "at_mentioned", params: payload });
  }

  private broadcast(message: Record<string, unknown>): void {
    const text = JSON.stringify(message);
    for (const ws of this.clients) {
      try {
        ws.send(text);
      } catch {
        /* dropped client — close() will clean up */
      }
    }
  }

  private async handleMessage(
    ws: { send(data: string): void },
    raw: string,
  ): Promise<void> {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(raw) as JsonRpcMessage;
    } catch {
      return;
    }

    const reply = (result: unknown) => {
      if (msg.id === undefined) return; // notification — no response
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
    };
    const fail = (message: string) => {
      if (msg.id === undefined) return;
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32603, message },
        }),
      );
    };

    switch (msg.method) {
      case "initialize": {
        const requested = (msg.params?.["protocolVersion"] as string) || "";
        reply({
          protocolVersion: requested || DEFAULT_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "tau-mux", version: "1" },
        });
        return;
      }

      case "notifications/initialized":
        return;

      case "ide_connected": {
        const pid = Number(msg.params?.["pid"]);
        this.clientPid = Number.isInteger(pid) ? pid : null;
        this.log(`connected (claude pid ${this.clientPid ?? "?"})`);
        return;
      }

      case "tools/list":
        reply({ tools: IDE_TOOLS });
        return;

      case "tools/call": {
        const name = msg.params?.["name"] as string;
        const args = (msg.params?.["arguments"] ?? {}) as Record<
          string,
          unknown
        >;
        try {
          reply(await this.callTool(name, args));
        } catch (err) {
          fail(err instanceof Error ? err.message : String(err));
        }
        return;
      }

      default:
        // Unknown request: answer, don't hang. A silent drop would leave
        // Claude Code waiting on an id forever.
        if (msg.id !== undefined) fail(`unknown method: ${msg.method}`);
        return;
    }
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[] }> {
    switch (name) {
      case "openDiff": {
        const req: OpenDiffRequest = {
          oldPath: String(args["old_file_path"] ?? ""),
          newPath: String(args["new_file_path"] ?? ""),
          newContents: String(args["new_file_contents"] ?? ""),
          tabName: String(args["tab_name"] ?? "diff"),
        };
        const outcome = await this.deps.reviewDiff(req);
        return { content: encodeDiffOutcome(outcome) };
      }

      case "close_tab": {
        this.deps.closeDiff(String(args["tab_name"] ?? ""));
        return { content: [{ type: "text", text: "TAB_CLOSED" }] };
      }

      case "getDiagnostics":
        // Honest empty. τ-mux runs no language server, and inventing
        // diagnostics — or omitting the tool so Claude Code falls back
        // to guessing whether an IDE has them — both cost more than
        // saying "none".
        return { content: [{ type: "text", text: "[]" }] };

      default:
        throw new Error(`unknown tool: ${name}`);
    }
  }

  private writeLock(): void {
    const port = this.port;
    if (port === null) return;
    mkdirSync(this.lockDir, { recursive: true });
    this.lockPath = join(this.lockDir, `${port}.lock`);
    writeFileSync(
      this.lockPath,
      JSON.stringify({
        // Our pid, because Claude Code only trusts a lock whose pid is
        // one of its ancestors — and τ-mux is (bun → shell → claude).
        pid: process.pid,
        workspaceFolders: this.deps.workspaceFolders(),
        ideName: "tau-mux",
        transport: "ws",
        runningInWindows: false,
        authToken: this.token,
      }),
      // 0600: the token in here is the only thing standing between a
      // local process and this server.
      { encoding: "utf-8", mode: 0o600 },
    );
  }

  private removeLock(): void {
    if (!this.lockPath) return;
    try {
      if (existsSync(this.lockPath)) unlinkSync(this.lockPath);
    } catch {
      /* Claude Code deletes locks whose pid is dead, so a leaked file
         is self-healing rather than permanent. */
    }
    this.lockPath = null;
  }
}

/** Tools we advertise. Deliberately short.
 *
 *  `executeCode` is omitted: it means "run this in the active Jupyter
 *  kernel", which τ-mux has no notion of. Advertising it and failing
 *  every call would be worse than not offering it — the model would keep
 *  choosing a tool that never works. */
export const IDE_TOOLS = [
  {
    name: "openDiff",
    description:
      "Show a proposed file change in tau-mux and wait for the user to " +
      "accept or reject it.",
    inputSchema: {
      type: "object",
      properties: {
        old_file_path: { type: "string" },
        new_file_path: { type: "string" },
        new_file_contents: { type: "string" },
        tab_name: { type: "string" },
      },
      required: ["old_file_path", "new_file_path", "new_file_contents"],
    },
  },
  {
    name: "close_tab",
    description: "Close a diff review surface previously opened by openDiff.",
    inputSchema: {
      type: "object",
      properties: { tab_name: { type: "string" } },
      required: ["tab_name"],
    },
  },
  {
    name: "getDiagnostics",
    description:
      "Language diagnostics for a file. tau-mux runs no language server, " +
      "so this always reports none.",
    inputSchema: {
      type: "object",
      properties: { uri: { type: "string" } },
    },
  },
] as const;
