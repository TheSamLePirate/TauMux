/**
 * Claude Agent Manager — hosts native Claude Code sessions inside τ-mux
 * via the Agent SDK (august-plan M3 / WS5).
 *
 * Mirrors the pi-agent-manager shape: each instance maps to a virtual
 * "claude" surface in the pane layout; events stream to the webview pane
 * over the same event fan-out. Differences from pi:
 *
 *   - transport is the Agent SDK's `query()` streaming-input mode (the
 *     SDK spawns/owns the Claude Code subprocess), not raw JSONL pipes;
 *   - permissions route through `canUseTool` → the SAME ask-user queue
 *     WS3 uses, so modal + Telegram approval work identically;
 *   - we prefer the user's own `claude` binary (their install, their
 *     auth) via `pathToClaudeCodeExecutable`, falling back to the SDK's
 *     bundled binary when none is found.
 *
 * Testability: the SDK `query` function is injectable (`deps.queryFn`),
 * so tests drive instances with replayed SDKMessage streams and never
 * spawn a real subprocess — see tests/claude-agent-manager.test.ts.
 */

import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type {
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

export interface ClaudeAgentConfig {
  cwd?: string;
  model?: string;
  permissionMode?: "default" | "acceptEdits" | "plan" | "bypassPermissions";
  /** Session id to resume; `fork` resumes into a new session id. */
  resume?: string;
  forkSession?: boolean;
}

/** Ask-the-user callback for tool permissions. Return null on timeout /
 *  no-answer to fall back to deny (the SDK has no "show your own prompt"
 *  fallback — an unanswered canUseTool must resolve). */
export type ClaudeAskUser = (req: {
  agentId: string;
  toolName: string;
  input: Record<string, unknown>;
}) => Promise<"allow" | "deny" | null>;

export interface ClaudeAgentDeps {
  askUser?: ClaudeAskUser;
  /** Injectable for tests — production uses the real SDK `query`. */
  queryFn?: typeof sdkQuery;
  /** Absolute path to the user's `claude` binary (resolved by the
   *  caller; see resolveClaudeBinary). Undefined → SDK bundled binary. */
  claudeBinary?: string;
}

/** Push-channel async iterable — `query()` consumes it as the prompt
 *  stream; `push()` feeds user turns; `end()` closes the session. */
class InputChannel implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private done = false;

  push(msg: SDKUserMessage): void {
    if (this.done) return;
    this.queue.push(msg);
    this.wake?.();
  }

  end(): void {
    this.done = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    for (;;) {
      while (this.queue.length > 0) yield this.queue.shift()!;
      if (this.done) return;
      await new Promise<void>((r) => {
        this.wake = r;
      });
      this.wake = null;
    }
  }
}

let _resolvedClaudePath: string | null | undefined;

/** Find the user's `claude` install (packaged .apps inherit a minimal
 *  PATH — probe the login shell like resolvePiBinary does). Returns
 *  undefined when not found so the SDK falls back to its bundled CLI. */
export function resolveClaudeBinary(): string | undefined {
  if (_resolvedClaudePath !== undefined) {
    return _resolvedClaudePath ?? undefined;
  }
  const probe = (cmd: string[], opts: Record<string, unknown>) => {
    try {
      const r = Bun.spawnSync(cmd, {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, LC_ALL: "C", LANG: "C" },
        ...opts,
      });
      if (r.exitCode === 0) {
        const p = new TextDecoder().decode(r.stdout).trim().split("\n")[0];
        if (p) return p;
      }
    } catch {
      /* keep probing */
    }
    return null;
  };
  let found = probe(["which", "claude"], {});
  if (!found) {
    const shell = process.env["SHELL"] || "/bin/zsh";
    found = probe([shell, "-ilc", "which claude"], {});
  }
  _resolvedClaudePath = found;
  return found ?? undefined;
}

export interface ClaudeAgentState {
  model: string | null;
  permissionMode: string;
  sessionId: string | null;
  isStreaming: boolean;
  totalCostUsd: number | null;
  cwd: string;
  exited: boolean;
}

export class ClaudeAgentInstance {
  readonly id: string;
  readonly config: ClaudeAgentConfig;
  private deps: ClaudeAgentDeps;
  private channel = new InputChannel();
  private q: Query | null = null;
  private closed = false;
  state: ClaudeAgentState;

  /** Fires for every SDK message (already JSON-safe). */
  onEvent: ((event: SDKMessage) => void) | null = null;
  /** Fires when the SDK stream ends (session over / crashed). */
  onExit: ((error: string | null) => void) | null = null;

  constructor(id: string, config: ClaudeAgentConfig, deps: ClaudeAgentDeps) {
    this.id = id;
    this.config = config;
    this.deps = deps;
    this.state = {
      model: config.model ?? null,
      permissionMode: config.permissionMode ?? "default",
      sessionId: config.resume ?? null,
      isStreaming: false,
      totalCostUsd: null,
      cwd: config.cwd ?? process.cwd(),
      exited: false,
    };
  }

  start(): void {
    const queryFn = this.deps.queryFn ?? sdkQuery;
    const askUser = this.deps.askUser;
    this.q = queryFn({
      prompt: this.channel,
      options: {
        cwd: this.config.cwd,
        model: this.config.model,
        permissionMode: this.config.permissionMode,
        resume: this.config.resume,
        forkSession: this.config.forkSession,
        includePartialMessages: true,
        pathToClaudeCodeExecutable: this.deps.claudeBinary,
        canUseTool: async (
          toolName: string,
          input: Record<string, unknown>,
        ): Promise<PermissionResult> => {
          if (!askUser) return { behavior: "allow", updatedInput: input };
          const answer = await askUser({ agentId: this.id, toolName, input });
          return answer === "allow"
            ? { behavior: "allow", updatedInput: input }
            : {
                behavior: "deny",
                message:
                  answer === "deny"
                    ? "Denied by the user in τ-mux."
                    : "No answer from the user (τ-mux modal timed out).",
              };
        },
      },
    });
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      for await (const msg of this.q!) {
        this.digest(msg);
        try {
          this.onEvent?.(msg);
        } catch {
          /* a broken consumer must not kill the stream */
        }
      }
      this.finish(null);
    } catch (err) {
      this.finish(err instanceof Error ? err.message : String(err));
    }
  }

  /** Track the headline state the pane header needs. */
  private digest(msg: SDKMessage): void {
    const m = msg as { type: string; [k: string]: unknown };
    if (m.type === "system" && m["subtype"] === "init") {
      const model = m["model"];
      if (typeof model === "string") this.state.model = model;
      const sid = m["session_id"];
      if (typeof sid === "string") this.state.sessionId = sid;
      const mode = m["permissionMode"];
      if (typeof mode === "string") this.state.permissionMode = mode;
    } else if (m.type === "assistant" || m.type === "stream_event") {
      this.state.isStreaming = true;
    } else if (m.type === "result") {
      this.state.isStreaming = false;
      const cost = m["total_cost_usd"];
      if (typeof cost === "number") this.state.totalCostUsd = cost;
    }
  }

  private finish(error: string | null): void {
    if (this.state.exited) return;
    this.state.exited = true;
    this.state.isStreaming = false;
    try {
      this.onExit?.(error);
    } catch {
      /* observer errors are not ours */
    }
  }

  /** Send a user turn. */
  prompt(text: string): void {
    if (this.closed) return;
    this.channel.push({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
      parent_tool_use_id: null,
    } as SDKUserMessage);
  }

  async interrupt(): Promise<void> {
    try {
      await this.q?.interrupt();
    } catch {
      /* not streaming / already done */
    }
  }

  async setModel(model: string | undefined): Promise<void> {
    await this.q?.setModel(model);
    if (model) this.state.model = model;
  }

  async setPermissionMode(mode: string): Promise<void> {
    await (
      this.q as unknown as {
        setPermissionMode: (m: string) => Promise<void>;
      }
    )?.setPermissionMode(mode);
    this.state.permissionMode = mode;
  }

  /** Graceful close: end the input stream so the SDK winds the
   *  subprocess down; interrupt first if mid-turn. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.interrupt();
    this.channel.end();
  }
}

export class ClaudeAgentManager {
  private instances = new Map<string, ClaudeAgentInstance>();
  private counter = 0;
  private deps: ClaudeAgentDeps;

  constructor(deps: ClaudeAgentDeps = {}) {
    this.deps = deps;
  }

  create(config: ClaudeAgentConfig): ClaudeAgentInstance {
    const id = `claude-agent:${++this.counter}`;
    const inst = new ClaudeAgentInstance(id, config, {
      claudeBinary: resolveClaudeBinary(),
      ...this.deps,
    });
    this.instances.set(id, inst);
    inst.start();
    return inst;
  }

  get(id: string): ClaudeAgentInstance | undefined {
    return this.instances.get(id);
  }

  list(): ClaudeAgentInstance[] {
    return [...this.instances.values()];
  }

  async close(id: string): Promise<boolean> {
    const inst = this.instances.get(id);
    if (!inst) return false;
    await inst.close();
    this.instances.delete(id);
    return true;
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.instances.keys()].map((id) => this.close(id)));
  }
}
