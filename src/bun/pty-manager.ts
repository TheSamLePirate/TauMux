import type { ChannelDescriptor, ChannelMap } from "../shared/types";
import { resolve } from "node:path";

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
  private _destroyed = false;
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
  /** True when the terminal handle hadn't arrived yet the last time
   *  resize() was called. We flush the pending dimensions once the
   *  handle is delivered, so a user who resizes the window during
   *  shell init doesn't end up stuck at spawn-time dimensions. */
  private pendingResize = false;
  private terminalWatchdog: ReturnType<typeof setTimeout> | null = null;

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
    this._destroyed = false;
    this._exitCode = null;
    this.pendingResize = false;
    if (this.terminalWatchdog) {
      clearTimeout(this.terminalWatchdog);
      this.terminalWatchdog = null;
    }
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

    const isBundled = process.execPath.includes("Contents/MacOS");

    // In dev: import.meta.dir is src/bun -> ../../shareBin is root/shareBin
    // In packaged: import.meta.dir is Contents/Resources/app/bun -> ../shareBin is Contents/Resources/app/shareBin
    const shareBinPath = isBundled
      ? resolve(import.meta.dir, "../shareBin")
      : resolve(import.meta.dir, "../../shareBin");

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...opts.env,
      PATH: `${shareBinPath}:${opts.env?.["PATH"] || process.env["PATH"] || ""}`,
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
      HT_SOCKET_PATH: process.env["HT_SOCKET_PATH"] || "/tmp/hyperterm.sock",
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
            if (this.terminalWatchdog) {
              clearTimeout(this.terminalWatchdog);
              this.terminalWatchdog = null;
            }
            // Apply any resize requested between spawn() and the first
            // data callback. Without this, a user resize during shell
            // init would be silently dropped: _cols/_rows were updated
            // but terminal?.resize() was a no-op.
            if (this.pendingResize) {
              try {
                terminal.resize(this._cols, this._rows);
              } catch {
                /* ignore */
              }
              this.pendingResize = false;
            }
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

    // Watchdog: the Bun terminal API only provides the terminal handle via
    // the first data callback.  If the spawned process is completely silent
    // (no output at all), the handle is never delivered and buffered writes
    // are stuck.  Detect this and log a warning so it's diagnosable.
    this.terminalWatchdog = setTimeout(() => {
      this.terminalWatchdog = null;
      if (!this.terminal && !this._exited && this.writeBuffer.length > 0) {
        console.warn(
          `[pty ${this._pid}] Terminal produced no initial output; ` +
            `${this.writeBuffer.length} write(s) stuck in buffer`,
        );
      }
    }, 5000);

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
      // Terminal handle is received via the first data callback.  If the
      // spawned process is completely silent, writes will be buffered
      // indefinitely.  The spawn() watchdog timer logs a warning if this
      // condition persists.
      this.writeBuffer.push(data);
    }
  }

  resize(cols: number, rows: number): void {
    this._cols = cols;
    this._rows = rows;
    if (this.terminal) {
      this.terminal.resize(cols, rows);
    } else {
      // Flushed from the first data callback.
      this.pendingResize = true;
    }
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
    this._destroyed = true;
    if (this.terminalWatchdog) {
      clearTimeout(this.terminalWatchdog);
      this.terminalWatchdog = null;
    }
    if (this.proc && !this._exited) {
      // Send SIGHUP first (G.2 / L2) so shells and editors get a
      // chance to flush buffers, run `trap` handlers, and clean up
      // child daemons. If the child is still alive after a short
      // grace, escalate to SIGKILL. The 2 s parent-shutdown watchdog
      // is the hard upper bound; this 500 ms grace fits inside it.
      const proc = this.proc;
      try {
        proc.kill(1); // SIGHUP
      } catch {
        // proc may already be gone — fall through to the timer
      }
      const escalate = setTimeout(() => {
        try {
          proc.kill(9);
        } catch {
          /* already reaped — no-op */
        }
      }, 500);
      (escalate as { unref?: () => void }).unref?.();
    }
    this.proc = null;
    this.terminal = null;
    this._pid = null;
  }

  private trackExit(): void {
    this.proc?.exited.then((code) => {
      // If destroy() was already called, the object is dead — skip callbacks
      // to avoid executing logic on a torn-down instance (the OS still reaps
      // the process and resolves this promise after kill(9)).
      if (this._destroyed) return;

      // Flush any trailing bytes left in the streaming UTF-8 decoder.
      // Without this final decode(), an incomplete multi-byte character at
      // the very end of the stream would be silently lost.
      const remaining = this.stdoutDecoder.decode();
      if (remaining) this.onStdout?.(remaining);

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
