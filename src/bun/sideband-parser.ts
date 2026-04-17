import type { SidebandContentMessage } from "../shared/types";

/** Default timeout for binary reads (ms) */
const DEFAULT_READ_TIMEOUT_MS = 5000;
/** Max queued binary reads per channel before rejecting new ones */
const MAX_CHANNEL_QUEUE_DEPTH = 64;
/** Hard cap on a single binary payload. A writer advertising a larger
 *  byteLength is rejected before we allocate any buffers — prevents a
 *  malicious or buggy producer from OOMing the host by claiming a 1 GB
 *  frame. 16 MiB is comfortably above any realistic image/SVG payload. */
export const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

interface ChannelState {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  leftover: Uint8Array | null;
  /** FIFO promise chain — serializes reads on this channel */
  queue: Promise<void>;
  /** Number of pending reads in the queue */
  queueDepth: number;
  /** Set to true to abort in-flight reads (timeout, flush, stop) */
  aborted: boolean;
}

export class SidebandParser {
  private metaReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private channels = new Map<string, ChannelState>();
  private metaBuffer = "";
  private metaDecoder = new TextDecoder("utf-8", { fatal: false });
  private stopped = false;

  /** Default data channel name used when msg.dataChannel is absent */
  static readonly DEFAULT_DATA_CHANNEL = "data";

  onMeta: ((msg: SidebandContentMessage) => void) | null = null;
  onData: ((id: string, data: Uint8Array) => void) | null = null;
  onError: ((source: string, error: Error) => void) | null = null;
  /** Fires when a binary read fails (timeout, EOF, abort) after meta was already dispatched */
  onDataFailed: ((id: string, reason: string) => void) | null = null;

  /**
   * @param metaFd - File descriptor for the metadata JSONL channel
   * @param dataChannels - Map of channel name → parent-side fd for binary data channels
   */
  constructor(
    private metaFd: number,
    private dataChannels: Map<string, number>,
  ) {}

  /** Backward-compat constructor helper: single data fd → Map with default name */
  static fromFds(metaFd: number, dataFd: number): SidebandParser {
    return new SidebandParser(
      metaFd,
      new Map([[SidebandParser.DEFAULT_DATA_CHANNEL, dataFd]]),
    );
  }

  start(): void {
    this.stopped = false;
    this.initChannels();
    this.readMetaLoop();
  }

  stop(): void {
    this.stopped = true;
    this.metaReader?.cancel().catch(() => {});
    this.metaReader = null;
    // Abort all in-flight reads and cancel readers
    for (const ch of this.channels.values()) {
      ch.aborted = true;
      ch.reader.cancel().catch(() => {});
    }
    this.channels.clear();
  }

  /** Flush a data channel: abort in-flight read, discard leftover bytes, reset queue */
  flushChannel(channelName: string): void {
    const ch = this.channels.get(channelName);
    if (!ch) return;
    // Abort current in-flight read
    ch.aborted = true;
    ch.leftover = null;
    // Reset the queue — new reads start fresh after current one bails out
    const oldQueue = ch.queue;
    ch.queue = oldQueue.then(() => {
      // Re-enable after the aborted read finishes
      ch.aborted = false;
      ch.queueDepth = 0;
    });
  }

  private initChannels(): void {
    for (const [name, fd] of this.dataChannels) {
      try {
        const reader = this.openReader(fd);
        this.channels.set(name, {
          reader,
          leftover: null,
          queue: Promise.resolve(),
          queueDepth: 0,
          aborted: false,
        });
      } catch (err) {
        this.onError?.(
          "data-init",
          err instanceof Error
            ? err
            : new Error(`Failed to init data channel "${name}": ${err}`),
        );
      }
    }
  }

  private async readMetaLoop(): Promise<void> {
    try {
      this.metaReader = this.openReader(this.metaFd);
    } catch (err) {
      this.onError?.(
        "meta-init",
        err instanceof Error ? err : new Error(String(err)),
      );
      return;
    }

    try {
      while (!this.stopped) {
        const { value, done } = await this.metaReader!.read();
        if (done) break;

        this.metaBuffer += this.metaDecoder.decode(value, { stream: true });
        this.processMetaBuffer();
      }
    } catch (err) {
      if (!this.stopped) {
        this.onError?.(
          "meta-stream",
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  }

  /**
   * Parse all complete lines from metaBuffer.
   * Uses offset-based scanning — single slice at end for unparsed tail.
   * Non-blocking: binary reads are queued, not awaited.
   */
  private processMetaBuffer(): void {
    let start = 0;
    let idx: number;
    while ((idx = this.metaBuffer.indexOf("\n", start)) !== -1) {
      const line = this.metaBuffer.substring(start, idx).trim();
      start = idx + 1;

      if (!line) continue;

      // Parse as the broader content shape. The flush variant is a
      // subset (id + type:"flush" + dataChannel?) so reading its fields
      // through SidebandContentMessage is safe. We narrow to the strict
      // union only when emitting to onMeta.
      let msg: SidebandContentMessage;
      try {
        msg = JSON.parse(line) as SidebandContentMessage;
      } catch {
        this.onError?.(
          "meta-parse",
          new Error(`Invalid JSON on meta fd: ${line.slice(0, 120)}`),
        );
        continue;
      }

      // Validate required fields
      if (typeof msg.id !== "string" || msg.id.length === 0) {
        this.onError?.(
          "meta-validate",
          new Error(`Missing or empty "id" field: ${line.slice(0, 120)}`),
        );
        continue;
      }
      if (typeof msg.type !== "string") {
        this.onError?.(
          "meta-validate",
          new Error(
            `Missing or invalid "type" field for id="${msg.id}": ${line.slice(0, 120)}`,
          ),
        );
        continue;
      }
      if (
        msg.byteLength !== undefined &&
        (typeof msg.byteLength !== "number" ||
          msg.byteLength < 0 ||
          !Number.isFinite(msg.byteLength))
      ) {
        this.onError?.(
          "meta-validate",
          new Error(
            `Invalid "byteLength" (${msg.byteLength}) for id="${msg.id}"`,
          ),
        );
        continue;
      }
      // Oversized frames are a protocol violation. The data stream is
      // now corrupted — we can't skip ahead because we don't know how
      // many bytes to skip (the writer can lie about byteLength). Abort
      // the channel the same way we do on timeout, and report failure
      // so the UI can signal the broken panel. A subsequent `flush`
      // command from the writer resets the channel.
      if (msg.byteLength !== undefined && msg.byteLength > MAX_MESSAGE_BYTES) {
        this.onError?.(
          "meta-validate",
          new Error(
            `byteLength ${msg.byteLength} exceeds MAX_MESSAGE_BYTES (${MAX_MESSAGE_BYTES}) for id="${msg.id}"`,
          ),
        );
        const channelName =
          msg.dataChannel ?? SidebandParser.DEFAULT_DATA_CHANNEL;
        this.onDataFailed?.(msg.id, "byteLength exceeds maximum");
        const ch = this.channels.get(channelName);
        if (ch) {
          ch.aborted = true;
          ch.leftover = null;
        }
        continue;
      }

      // Handle flush command
      if (msg.type === "flush") {
        const channelName =
          msg.dataChannel ?? SidebandParser.DEFAULT_DATA_CHANNEL;
        this.flushChannel(channelName);
        continue;
      }

      // If the message has binary data, enqueue an async read (non-blocking)
      if (msg.byteLength && msg.byteLength > 0) {
        const channelName =
          msg.dataChannel ?? SidebandParser.DEFAULT_DATA_CHANNEL;
        this.enqueueDataRead(
          msg.id,
          msg.byteLength,
          channelName,
          msg.timeout ?? DEFAULT_READ_TIMEOUT_MS,
        );
      }

      // Dispatch metadata IMMEDIATELY — non-blocking.
      // The webview's pendingData map handles out-of-order data arrival.
      this.onMeta?.(msg);
    }
    // Single slice at end for unparsed tail
    if (start > 0) {
      this.metaBuffer = this.metaBuffer.slice(start);
    }
  }

  /**
   * Enqueue a binary read on a per-channel FIFO.
   * Reads on the same channel are serialized. Different channels are parallel.
   */
  private enqueueDataRead(
    id: string,
    byteLength: number,
    channelName: string,
    timeoutMs: number,
  ): void {
    const ch = this.channels.get(channelName);
    if (!ch) {
      this.onError?.(
        "data-channel",
        new Error(`Unknown data channel "${channelName}"`),
      );
      this.onDataFailed?.(id, `Unknown data channel "${channelName}"`);
      return;
    }

    // Queue depth check
    if (ch.queueDepth >= MAX_CHANNEL_QUEUE_DEPTH) {
      this.onError?.(
        "data-queue-full",
        new Error(
          `Channel "${channelName}" queue full (${MAX_CHANNEL_QUEUE_DEPTH}), dropping read for id="${id}"`,
        ),
      );
      this.onDataFailed?.(id, "Channel queue full");
      return;
    }

    ch.queueDepth++;

    // Chain onto the per-channel FIFO
    ch.queue = ch.queue.then(async () => {
      if (this.stopped || ch.aborted) {
        ch.queueDepth--;
        this.onDataFailed?.(id, "Aborted");
        return;
      }

      try {
        const data = await this.readExactBytesWithTimeout(
          ch,
          byteLength,
          channelName,
          timeoutMs,
        );
        ch.queueDepth--;

        if (data) {
          this.onData?.(id, data);
        } else {
          this.onDataFailed?.(id, "Incomplete data (EOF)");
          this.onError?.(
            "data-incomplete",
            new Error(
              `Expected ${byteLength} bytes on channel "${channelName}" for id="${id}", got EOF`,
            ),
          );
        }
      } catch (err) {
        ch.queueDepth--;
        const reason = err instanceof Error ? err.message : "Read failed";
        this.onDataFailed?.(id, reason);
        this.onError?.(
          "data-read",
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    });
  }

  /** Read exactly `n` bytes with a timeout. Returns null on EOF/abort. Throws on timeout. */
  private async readExactBytesWithTimeout(
    ch: ChannelState,
    n: number,
    channelName: string,
    timeoutMs: number,
  ): Promise<Uint8Array | null> {
    return new Promise<Uint8Array | null>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // Abort this channel — the stream position is now undefined
        ch.aborted = true;
        ch.leftover = null;
        reject(
          new Error(
            `Timeout: ${n} bytes on channel "${channelName}" not received within ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this.readExactBytes(ch, n).then(
        (data) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(data);
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  /** Read exactly `n` bytes from a channel, buffering leftovers */
  private async readExactBytes(
    ch: ChannelState,
    n: number,
  ): Promise<Uint8Array | null> {
    const chunks: Uint8Array[] = [];
    let received = 0;

    // Use leftover bytes from previous read on this channel
    if (ch.leftover && ch.leftover.byteLength > 0) {
      if (ch.leftover.byteLength >= n) {
        const result = ch.leftover.slice(0, n);
        ch.leftover = ch.leftover.slice(n);
        return result;
      }
      chunks.push(ch.leftover);
      received = ch.leftover.byteLength;
      ch.leftover = null;
    }

    try {
      while (received < n) {
        if (ch.aborted) return null;

        const { value, done } = await ch.reader.read();
        if (done) break;
        if (ch.aborted) return null;

        const needed = n - received;
        if (value.byteLength <= needed) {
          chunks.push(value);
          received += value.byteLength;
        } else {
          chunks.push(value.slice(0, needed));
          ch.leftover = value.slice(needed);
          received += needed;
        }
      }
    } catch {
      return null;
    }

    if (received < n) return null;

    // Fast path: single chunk
    if (chunks.length === 1) return chunks[0];

    // Concatenate
    const result = new Uint8Array(n);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  private openReader(fd: number): ReadableStreamDefaultReader<Uint8Array> {
    const stream = Bun.file(
      fd,
    ).stream() as unknown as ReadableStream<Uint8Array>;
    return stream.getReader();
  }
}
