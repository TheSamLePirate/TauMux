import type { ChannelDescriptor, ChannelMap } from "../shared/types";

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
  /** Extra sideband channels beyond the default meta/data/events */
  extraChannels?: ChannelDescriptor[];
}

export interface SidebandFds {
  metaFd: number | null; // fd3: child writes metadata JSONL → parent reads
  dataFd: number | null; // fd4: child writes binary data → parent reads
  eventFd: number | null; // fd5: parent writes event JSONL → child reads
}

/** Default channels: meta (fd3), data (fd4), events (fd5) */
const DEFAULT_CHANNELS: ChannelDescriptor[] = [
  { name: "meta", fd: 3, direction: "out", encoding: "jsonl" },
  { name: "data", fd: 4, direction: "out", encoding: "binary" },
  { name: "events", fd: 5, direction: "in", encoding: "jsonl" },
];

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
  private _channels: ChannelDescriptor[] = [];

  // Current terminal dimensions
  private _cols = 80;
  private _rows = 24;

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

  /** Backward-compat getter for the 3 default fds */
  get sidebandFds(): SidebandFds {
    return { ...this._sidebandFds };
  }

  /** Full channel list (default + extra) */
  get channels(): readonly ChannelDescriptor[] {
    return this._channels;
  }

  spawn(opts: PtySpawnOptions): number {
    this._exited = false;
    this._exitCode = null;
    this._cols = opts.cols;
    this._rows = opts.rows;
    this._sidebandFds = { metaFd: null, dataFd: null, eventFd: null };

    // Build channel list: defaults + any extras
    const allChannels = [...DEFAULT_CHANNELS, ...(opts.extraChannels ?? [])];

    // Build stdio array: slots 0-2 = stdin/stdout/stderr, 3+ = pipes for channels
    const maxFd = Math.max(...allChannels.map((c) => c.fd));
    const stdioArr: [
      undefined,
      undefined,
      undefined,
      ...(undefined | "pipe")[],
    ] = [undefined, undefined, undefined];
    for (let i = 3; i <= maxFd; i++) {
      stdioArr[i] = allChannels.some((c) => c.fd === i) ? "pipe" : undefined;
    }

    // Build channel map for HYPERTERM_CHANNELS env var
    const channelMap: ChannelMap = { version: 1, channels: allChannels };

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...opts.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env["LANG"] || "en_US.UTF-8",
      LC_ALL: process.env["LC_ALL"] || "",
      // Protocol version
      HYPERTERM_PROTOCOL_VERSION: "1",
      // Legacy env vars for backward compat
      HYPERTERM_META_FD: "3",
      HYPERTERM_DATA_FD: "4",
      HYPERTERM_EVENT_FD: "5",
      // New structured channel map
      HYPERTERM_CHANNELS: JSON.stringify(channelMap),
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
      stdio: stdioArr,
    }) as unknown as BunSubprocess;

    this._pid = this.proc.pid;

    // Capture parent-side fd numbers and populate channel descriptors
    const stdio = (this.proc as unknown as { stdio: unknown[] }).stdio;
    this._channels = [];
    if (stdio) {
      for (const ch of allChannels) {
        const parentFd =
          typeof stdio[ch.fd] === "number" ? (stdio[ch.fd] as number) : null;
        if (parentFd !== null) {
          this._channels.push({ ...ch, fd: parentFd });
        }
      }

      // Backward-compat: populate legacy SidebandFds from channel list
      this._sidebandFds = {
        metaFd: this.getChannelFd("meta"),
        dataFd: this.getChannelFd("data"),
        eventFd: this.getChannelFd("events"),
      };
    }

    this.trackExit();
    return this.proc.pid;
  }

  /** Look up a channel's parent-side fd by name */
  getChannelFd(name: string): number | null {
    return this._channels.find((c) => c.name === name)?.fd ?? null;
  }

  write(data: string): void {
    if (this.terminal) {
      this.terminal.write(data);
    } else {
      this.writeBuffer.push(data);
    }
  }

  resize(cols: number, rows: number): void {
    this._cols = cols;
    this._rows = rows;
    this.terminal?.resize(cols, rows);
  }

  get cols(): number {
    return this._cols;
  }

  get rows(): number {
    return this._rows;
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
