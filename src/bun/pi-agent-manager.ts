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

export class PiAgentInstance {
  readonly id: string;
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private buffer = "";
  private dead = false;
  private readyResolve: (() => void) | null = null;
  private readyPromise: Promise<void>;
  private responseWaiters = new Map<
    string,
    { resolve: (data: unknown) => void; reject: (err: Error) => void }
  >();
  private reqCounter = 0;

  /** Fires for every RPC event from pi (text deltas, tool calls, etc.). */
  onEvent: ((event: PiAgentEvent) => void) | null = null;
  /** Fires when the subprocess exits. */
  onExit: ((code: number) => void) | null = null;

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
    const piPath = this.config.piBinary ?? "pi";
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

    try {
      this.proc = Bun.spawn(args, {
        cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
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
      this.onExit?.(code ?? 1);
      // Reject any pending waiters
      for (const [, waiter] of this.responseWaiters) {
        waiter.reject(new Error("pi process exited"));
      }
      this.responseWaiters.clear();
    });

    return this.readyPromise;
  }

  private async readStdout(): Promise<void> {
    if (!this.proc?.stdout) return;
    const reader = this.proc.stdout.getReader();
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
    const reader = this.proc.stderr.getReader();
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
    // Check if this is a response to a command we sent
    if (msg["type"] === "response" && msg["id"]) {
      const waiter = this.responseWaiters.get(msg["id"] as string);
      if (waiter) {
        this.responseWaiters.delete(msg["id"] as string);
        if (msg["success"]) {
          waiter.resolve(msg["data"] ?? null);
        } else {
          waiter.reject(new Error((msg["error"] as string) ?? "Unknown error"));
        }
        return;
      }
    }
    // Forward all events to the UI
    this.onEvent?.(msg);
  }

  /** Send a command and wait for the response. */
  async send(
    command: Record<string, unknown>,
    timeoutMs = 30000,
  ): Promise<unknown> {
    if (this.dead || !this.proc?.stdin) {
      throw new Error("Agent process is not running");
    }
    const id = `req_${++this.reqCounter}`;
    const msg = { ...command, id };
    const line = JSON.stringify(msg) + "\n";

    return new Promise<unknown>((resolve, reject) => {
      this.responseWaiters.set(id, { resolve, reject });
      const writer = this.proc!.stdin!;
      writer.write(line);
      writer.flush();

      // Timeout
      setTimeout(() => {
        if (this.responseWaiters.has(id)) {
          this.responseWaiters.delete(id);
          reject(new Error(`Timeout waiting for response to ${command["type"]}`));
        }
      }, timeoutMs);
    });
  }

  /** Send a fire-and-forget command (no response expected). */
  sendNoWait(command: Record<string, unknown>): void {
    if (this.dead || !this.proc?.stdin) return;
    const line = JSON.stringify(command) + "\n";
    this.proc.stdin.write(line);
    this.proc.stdin.flush();
  }

  /** Send a prompt to the agent. */
  async prompt(message: string): Promise<void> {
    await this.send({ type: "prompt", message });
  }

  /** Abort the current operation. */
  async abort(): Promise<void> {
    try {
      await this.send({ type: "abort" }, 5000);
    } catch {
      // Ignore — process may have already exited
    }
  }

  /** Get available models. */
  async getAvailableModels(): Promise<unknown> {
    return await this.send({ type: "get_available_models" });
  }

  /** Set the model. */
  async setModel(provider: string, modelId: string): Promise<unknown> {
    return await this.send({ type: "set_model", provider, modelId });
  }

  /** Set thinking level. */
  async setThinkingLevel(level: string): Promise<void> {
    await this.send({ type: "set_thinking_level", level });
  }

  /** Get agent state. */
  async getState(): Promise<unknown> {
    return await this.send({ type: "get_state" });
  }

  /** Get session stats. */
  async getSessionStats(): Promise<unknown> {
    return await this.send({ type: "get_session_stats" });
  }

  /** Compact the session. */
  async compact(customInstructions?: string): Promise<unknown> {
    return await this.send({
      type: "compact",
      ...(customInstructions ? { customInstructions } : {}),
    });
  }

  /** Start a new session. */
  async newSession(): Promise<void> {
    await this.send({ type: "new_session" });
  }

  /** Respond to an extension UI request. */
  respondToExtensionUI(
    id: string,
    response: Record<string, unknown>,
  ): void {
    this.sendNoWait({
      type: "extension_ui_response",
      id,
      ...response,
    });
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
  onEvent:
    | ((agentId: string, event: PiAgentEvent) => void)
    | null = null;
  onExit: ((agentId: string, code: number) => void) | null = null;

  createAgent(config: PiAgentConfig): PiAgentInstance {
    const id = `agent-${++this.counter}`;
    const instance = new PiAgentInstance(id, config);

    instance.onEvent = (event) => {
      this.onEvent?.(id, event);
    };

    instance.onExit = (code) => {
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
