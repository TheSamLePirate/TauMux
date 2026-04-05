interface BunTerminal {
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

interface BunSubprocess {
  pid: number;
  exitCode: number | null;
  exited: Promise<number>;
  kill(signal?: number): void;
}

export interface PtySpawnOptions {
  shell: string;
  args?: string[];
  cols: number;
  rows: number;
  env?: Record<string, string>;
  cwd?: string;
}

export interface SidebandFds {
  metaFd: number | null; // fd3: child writes metadata JSONL → parent reads
  dataFd: number | null; // fd4: child writes binary data → parent reads
  eventFd: number | null; // fd5: parent writes event JSONL → child reads
}

export class PtyManager {
  private proc: BunSubprocess | null = null;
  private terminal: BunTerminal | null = null;
  private _pid: number | null = null;
  private _exited = false;
  private _exitCode: number | null = null;
  private _sidebandFds: SidebandFds = {
    metaFd: null,
    dataFd: null,
    eventFd: null,
  };

  // Write buffer for commands sent before terminal is ready
  private writeBuffer: string[] = [];

  // Streaming decoder to handle multi-byte UTF-8 split across chunks
  private stdoutDecoder = new TextDecoder("utf-8", { fatal: false });

  // Callbacks
  onStdout: ((data: string) => void) | null = null;
  onExit: ((code: number) => void) | null = null;

  get pid(): number | null {
    return this._pid;
  }

  get exited(): boolean {
    return this._exited;
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  get sidebandFds(): SidebandFds {
    return { ...this._sidebandFds };
  }

  spawn(opts: PtySpawnOptions): number {
    this._exited = false;
    this._exitCode = null;
    this._sidebandFds = { metaFd: null, dataFd: null, eventFd: null };

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...opts.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env["LANG"] || "en_US.UTF-8",
      LC_ALL: process.env["LC_ALL"] || "",
      HYPERTERM_META_FD: "3",
      HYPERTERM_DATA_FD: "4",
      HYPERTERM_EVENT_FD: "5",
      HT_SOCKET_PATH: "/tmp/hyperterm.sock",
    };

    this.proc = Bun.spawn([opts.shell, ...(opts.args ?? [])], {
      cwd: opts.cwd ?? process.env["HOME"] ?? "/",
      env,
      terminal: {
        cols: opts.cols,
        rows: opts.rows,
        data: (terminal: BunTerminal, data: Uint8Array) => {
          if (!this.terminal) {
            this.terminal = terminal;
            for (const buffered of this.writeBuffer) {
              terminal.write(buffered);
            }
            this.writeBuffer = [];
          }
          const str = this.stdoutDecoder.decode(data, { stream: true });
          if (str) this.onStdout?.(str);
        },
      },
      stdio: [undefined, undefined, undefined, "pipe", "pipe", "pipe"],
    }) as unknown as BunSubprocess;

    this._pid = this.proc.pid;

    // Capture extra fd numbers from parent side
    const stdio = (this.proc as unknown as { stdio: unknown[] }).stdio;
    if (stdio) {
      this._sidebandFds = {
        metaFd: typeof stdio[3] === "number" ? stdio[3] : null,
        dataFd: typeof stdio[4] === "number" ? stdio[4] : null,
        eventFd: typeof stdio[5] === "number" ? stdio[5] : null,
      };
    }

    this.trackExit();
    return this.proc.pid;
  }

  write(data: string): void {
    if (this.terminal) {
      this.terminal.write(data);
    } else {
      this.writeBuffer.push(data);
    }
  }

  resize(cols: number, rows: number): void {
    this.terminal?.resize(cols, rows);
  }

  kill(signal?: string): void {
    if (!this.proc || this._exited) return;
    const sigNum = signalToNumber(signal ?? "SIGTERM");
    this.proc.kill(sigNum);
  }

  destroy(): void {
    if (this.proc && !this._exited) {
      this.proc.kill(9);
    }
    this.proc = null;
    this.terminal = null;
    this._pid = null;
  }

  private trackExit(): void {
    this.proc?.exited.then((code) => {
      this._exited = true;
      this._exitCode = code;
      this.onExit?.(code);
    });
  }
}

function signalToNumber(signal: string): number {
  const signals: Record<string, number> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGTERM: 15,
    SIGKILL: 9,
    SIGUSR1: 10,
    SIGUSR2: 12,
  };
  return signals[signal] ?? 15;
}
