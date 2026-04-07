import type { SidebandMetaMessage } from "../shared/types";

export class SidebandParser {
  private metaReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private dataReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private metaBuffer = "";
  private metaDecoder = new TextDecoder("utf-8", { fatal: false });
  private dataLeftover: Uint8Array | null = null;
  private stopped = false;

  onMeta: ((msg: SidebandMetaMessage) => void) | null = null;
  onData: ((id: string, data: Uint8Array) => void) | null = null;

  constructor(
    private metaFd: number,
    private dataFd: number,
  ) {}

  start(): void {
    this.stopped = false;
    this.initDataReader();
    this.readMetaLoop();
  }

  stop(): void {
    this.stopped = true;
    this.metaReader?.cancel().catch(() => {});
    this.metaReader = null;
    this.dataReader?.cancel().catch(() => {});
    this.dataReader = null;
  }

  private initDataReader(): void {
    try {
      this.dataReader = this.openReader(this.dataFd);
    } catch {
      this.dataReader = null;
    }
  }

  private async readMetaLoop(): Promise<void> {
    try {
      this.metaReader = this.openReader(this.metaFd);
    } catch {
      return;
    }

    try {
      while (!this.stopped) {
        const { value, done } = await this.metaReader!.read();
        if (done) break;

        this.metaBuffer += this.metaDecoder.decode(value, { stream: true });
        await this.processMetaBuffer();
      }
    } catch {
      // fd closed, process exited
    }
  }

  private async processMetaBuffer(): Promise<void> {
    let idx: number;
    while ((idx = this.metaBuffer.indexOf("\n")) !== -1) {
      const line = this.metaBuffer.slice(0, idx).trim();
      this.metaBuffer = this.metaBuffer.slice(idx + 1);

      if (!line) continue;

      let msg: SidebandMetaMessage;
      try {
        msg = JSON.parse(line) as SidebandMetaMessage;
      } catch {
        continue;
      }

      // If the message has binary data, read it from the data fd
      if (msg.byteLength && msg.byteLength > 0) {
        const data = await this.readExactBytes(msg.byteLength);
        if (data) {
          this.onData?.(msg.id, data);
        }
      }

      this.onMeta?.(msg);
    }
  }

  /** Read exactly `n` bytes from the data fd, buffering leftovers */
  private async readExactBytes(n: number): Promise<Uint8Array | null> {
    if (!this.dataReader) return null;

    const chunks: Uint8Array[] = [];
    let received = 0;

    // Use leftover bytes from previous read
    if (this.dataLeftover && this.dataLeftover.byteLength > 0) {
      if (this.dataLeftover.byteLength >= n) {
        // Leftover has enough — split it
        const result = this.dataLeftover.slice(0, n);
        this.dataLeftover = this.dataLeftover.slice(n);
        return result;
      }
      chunks.push(this.dataLeftover);
      received = this.dataLeftover.byteLength;
      this.dataLeftover = null;
    }

    try {
      while (received < n) {
        const { value, done } = await this.dataReader.read();
        if (done) break;

        const needed = n - received;
        if (value.byteLength <= needed) {
          chunks.push(value);
          received += value.byteLength;
        } else {
          // Got more than needed — take what we need, save the rest
          chunks.push(value.slice(0, needed));
          this.dataLeftover = value.slice(needed);
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
    const stream = Bun.file(fd).stream() as unknown as ReadableStream<Uint8Array>;
    return stream.getReader();
  }
}
