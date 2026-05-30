/**
 * Pi Agent Manager — spawns `pi --mode rpc` as a subprocess and communicates
 * via JSON-RPC over stdin/stdout. Each agent instance maps to a virtual
 * "surface" in the UI so it can live inside the pane layout like terminals
 * and browser panes.
 */

export interface PiAgentConfig {
  provider?: string;
  model?: string;
  thinkingLevel?: string;
  cwd?: string;
  /** Extra CLI flags passed verbatim to `pi`. */
  extraArgs?: string[];
  /** Override the path to the pi binary. */
  piBinary?: string;
  /** Skill file paths to load. */
  skills?: string[];
}

export interface PiAgentState {
  model: { provider: string; id: string; name: string } | null;
  thinkingLevel: string;
  isStreaming: boolean;
  sessionFile: string | null;
}

export interface PiAgentEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Resolve the full path to `pi` by checking common locations and
 * the user's login-shell PATH. Packaged macOS apps inherit a minimal
 * system PATH that excludes nvm / volta / brew / etc.
 */
let _resolvedPiPath: string | null = null;
async function resolvePiBinary(): Promise<string> {
  if (_resolvedPiPath) return _resolvedPiPath;

  // 1. Already on PATH?
  const direct = Bun.spawnSync(["which", "pi"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  });
  if (direct.exitCode === 0) {
    const p = new TextDecoder().decode(direct.stdout).trim();
    if (p) {
      _resolvedPiPath = p;
      return p;
    }
  }

  // 2. Ask the user's login shell for the full PATH and resolve from there.
  //    This handles nvm, volta, fnm, brew, mise, asdf, etc.
  const shell = process.env["SHELL"] || "/bin/zsh";
  const login = Bun.spawnSync([shell, "-ilc", "which pi"], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HOME: process.env["HOME"] ?? "",
      LC_ALL: "C",
      LANG: "C",
    },
  });
  if (login.exitCode === 0) {
    const p = new TextDecoder().decode(login.stdout).trim();
    if (p) {
      _resolvedPiPath = p;
      return p;
    }
  }

  // 3. Common known locations
  const home = process.env["HOME"] ?? "";
  const candidates = [
    `${home}/.nvm/versions/node/v24.14.0/bin/pi`,
    `${home}/.volta/bin/pi`,
    `${home}/.local/bin/pi`,
    "/usr/local/bin/pi",
    "/opt/homebrew/bin/pi",
  ];
  for (const c of candidates) {
    try {
      const f = Bun.file(c);
      if (await f.exists()) {
        _resolvedPiPath = c;
        return c;
      }
    } catch {
      /* skip */
    }
  }

  // 4. Fallback — hope it's on PATH at runtime
  return "pi";
}

export class PiAgentInstance {
  readonly id: string;
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private buffer = "";
  private dead = false;
  private readyResolve: (() => void) | null = null;
  private readyPromise: Promise<void>;

  /** Fires for every RPC event from pi (text deltas, tool calls, etc.). */
  onEvent: ((event: PiAgentEvent) => void) | null = null;
  /** Fires when the subprocess exits. Public — call sites overwrite
   *  this freely (e.g. to fan an `agent_exit` event to the webview),
   *  so the manager cannot rely on it for its own bookkeeping. See
   *  `_managerExit` below. */
  onExit: ((code: number) => void) | null = null;
  /** Manager-private exit hook — set once by `PiAgentManager.createAgent`
   *  and not exposed for overwrite. Used to evict dead instances from
   *  the registry without colliding with user-supplied `onExit`
   *  handlers in `index.ts:createAgentSurface` / `splitAgentSurface`. */
  _managerExit: ((code: number) => void) | null = null;

  constructor(
    id: string,
    private config: PiAgentConfig,
  ) {
    this.id = id;
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  async start(): Promise<void> {
    const piPath = this.config.piBinary ?? (await resolvePiBinary());
    const args = [piPath, "--mode", "rpc", "--no-session"];

    if (this.config.provider) {
      args.push("--provider", this.config.provider);
    }
    if (this.config.model) {
      args.push("--model", this.config.model);
    }
    if (this.config.thinkingLevel && this.config.thinkingLevel !== "off") {
      args.push("--thinking", this.config.thinkingLevel);
    }
    if (this.config.skills) {
      for (const skill of this.config.skills) {
        args.push("--skill", skill);
      }
    }
    if (this.config.extraArgs) {
      args.push(...this.config.extraArgs);
    }

    const cwd = this.config.cwd ?? process.cwd();

    // Resolve the user's login-shell PATH so pi (and the tools it
    // invokes like node, npm, git) can be found even when the app
    // was launched from Finder with a minimal system PATH.
    let shellPath = process.env["PATH"] ?? "";
    try {
      const shell = process.env["SHELL"] || "/bin/zsh";
      const r = Bun.spawnSync([shell, "-ilc", "echo $PATH"], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, LC_ALL: "C", LANG: "C" },
      });
      if (r.exitCode === 0) {
        const p = new TextDecoder().decode(r.stdout).trim();
        if (p) shellPath = p;
      }
    } catch {
      /* keep existing PATH */
    }

    try {
      this.proc = Bun.spawn(args, {
        cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          PATH: shellPath,
          TERM: "dumb",
          NO_COLOR: "1",
        },
      });
    } catch (err) {
      this.dead = true;
      throw err;
    }

    // Read stdout (JSON-RPC events)
    this.readStdout();
    // Read stderr (for debugging)
    this.readStderr();

    // Wait for process to be alive, then mark ready
    // pi --mode rpc is ready immediately (no handshake needed)
    setTimeout(() => {
      this.readyResolve?.();
      this.readyResolve = null;
    }, 500);

    // Watch for exit
    this.proc.exited.then((code) => {
      this.dead = true;
      // Fire the manager hook first so the instance is evicted from
      // the registry before any user-side `onExit` callback gets a
      // chance to look it up and find a corpse.
      this._managerExit?.(code ?? 1);
      this.onExit?.(code ?? 1);
    });

    return this.readyPromise;
  }

  private async readStdout(): Promise<void> {
    if (!this.proc?.stdout) return;
    // We always spawn with stdout: "pipe", so the runtime value is a
    // ReadableStream. The @types/node union also admits `number` (a raw
    // fd) when stdio is configured that way, hence the narrowing.
    const stream = this.proc.stdout as ReadableStream<Uint8Array>;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        this.processBuffer();
      }
    } catch {
      // Stream closed
    }
  }

  private async readStderr(): Promise<void> {
    if (!this.proc?.stderr) return;
    // stderr is spawned with "pipe" — same narrowing as readStdout.
    const stream = this.proc.stderr as ReadableStream<Uint8Array>;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (text.trim()) {
          // Forward stderr as agent system events
          this.onEvent?.({
            type: "agent_stderr",
            text: text.trim(),
          });
        }
      }
    } catch {
      // Stream closed
    }
  }

  private processBuffer(): void {
    while (true) {
      const nlIndex = this.buffer.indexOf("\n");
      if (nlIndex === -1) break;
      let line = this.buffer.slice(0, nlIndex);
      this.buffer = this.buffer.slice(nlIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as PiAgentEvent;
        this.handleMessage(parsed);
      } catch {
        // Ignore non-JSON lines (startup messages, etc.)
      }
    }
  }

  private handleMessage(msg: PiAgentEvent): void {
    // Forward every line to the UI. pi's `response` events carry their
    // originating command's `type`, which the webview correlates on —
    // the bun side keeps no per-request state (H12).
    this.onEvent?.(msg);
  }

  /** Send a fire-and-forget command (no response expected). pi's RPC
   *  protocol streams back `response`/event lines that the webview
   *  correlates by the command's own `type`, so the bun side never
   *  awaits a reply — every handler in `webview-handlers/agent.ts` uses
   *  this. (H12 — full_app_review_2026-05.md §10.3 — removed the unused
   *  Promise-based `send()` + ~25 typed wrappers that correlated on an
   *  injected `id` nothing ever read.) */
  sendNoWait(command: Record<string, unknown>): void {
    if (this.dead || !this.proc?.stdin) return;
    const line = JSON.stringify(command) + "\n";
    const writer = this.proc.stdin as Bun.FileSink;
    writer.write(line);
    writer.flush();
  }

  /** Respond to an extension UI request. */
  respondToExtensionUI(id: string, response: Record<string, unknown>): void {
    this.sendNoWait({
      type: "extension_ui_response",
      id,
      ...response,
    });
  }

  /** Queue a steering message (delivered during streaming). */
  steer(message: string): void {
    this.sendNoWait({ type: "steer", message });
  }

  /** Queue a follow-up message (delivered after agent finishes). */
  followUp(message: string): void {
    this.sendNoWait({ type: "follow_up", message });
  }

  /** Abort a running bash command. */
  abortBash(): void {
    this.sendNoWait({ type: "abort_bash" });
  }

  /** Cancel an in-progress retry. */
  abortRetry(): void {
    this.sendNoWait({ type: "abort_retry" });
  }

  /** Kill the subprocess. */
  kill(): void {
    if (this.dead) return;
    this.dead = true;
    try {
      this.proc?.kill();
    } catch {
      // Ignore
    }
  }

  get isAlive(): boolean {
    return !this.dead;
  }
}

/**
 * Manages all pi agent instances across the app.
 */
export class PiAgentManager {
  private instances = new Map<string, PiAgentInstance>();
  private counter = 0;

  /** Callbacks wired by the main process. */
  onEvent: ((agentId: string, event: PiAgentEvent) => void) | null = null;
  onExit: ((agentId: string, code: number) => void) | null = null;

  createAgent(config: PiAgentConfig): PiAgentInstance {
    const id = `agent-${++this.counter}`;
    const instance = new PiAgentInstance(id, config);

    instance.onEvent = (event) => {
      this.onEvent?.(id, event);
    };

    // Internal manager-only exit hook — survives even if the caller
    // overwrites the public `onExit` field with their own handler.
    // The manager's onExit is the seam used by `index.ts` to evict
    // dead instances; the public onExit is for the same call site to
    // notify the webview.
    instance._managerExit = (code) => {
      this.onExit?.(id, code);
    };

    this.instances.set(id, instance);
    return instance;
  }

  getAgent(id: string): PiAgentInstance | undefined {
    return this.instances.get(id);
  }

  getAllAgents(): PiAgentInstance[] {
    return [...this.instances.values()];
  }

  removeAgent(id: string): void {
    const inst = this.instances.get(id);
    if (inst) {
      inst.kill();
      this.instances.delete(id);
    }
  }

  /** Clean up all agents on process exit. */
  dispose(): void {
    for (const [, inst] of this.instances) {
      inst.kill();
    }
    this.instances.clear();
  }

  get agentCount(): number {
    return this.instances.size;
  }

  /** Check if an id belongs to a pi agent surface. */
  isAgentSurface(id: string): boolean {
    return this.instances.has(id);
  }
}
