// Per-connection state for the web mirror.
//
// A session (identified by `sessionId`) is the durable unit — it owns the
// monotonic sequence counter and a bounded ring buffer of sent envelopes.
// A WebSocket connection is a transient attachment to a session: on
// disconnect the session stays alive for SESSION_TTL_MS so a reconnect
// with ?resume=&lt;id&gt;&amp;seq=&lt;n&gt; can catch up with delta replay.

export const SESSION_TTL_MS = 60_000;
export const SESSION_BUFFER_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/** Stdout coalescing window. Multiple chunks arriving within this
 *  window are concatenated into a single `output` envelope. Small
 *  enough to feel real-time, large enough to absorb shell bursts. */
export const OUTPUT_COALESCE_MS = 16;
/** Flush immediately if a per-surface pending buffer grows past this
 *  many bytes. Avoids building huge frames while still batching. */
export const OUTPUT_COALESCE_SOFT_CAP = 8 * 1024;

/** Backpressure threshold on the underlying WS. If getBufferedAmount()
 *  exceeds this, the session is marked stalled and we stop calling
 *  send() on the ws until the buffer drains. Incoming broadcasts still
 *  fill the session buffer so a resume can replay them. */
export const WS_STALL_HIGH_WATER = 1 * 1024 * 1024;
/** Low-water mark to clear the stall flag (simple hysteresis). */
export const WS_STALL_LOW_WATER = 256 * 1024;

export interface BufferedMessage {
  seq: number;
  /** Serialized frame — either a JSON envelope string or a binary WS frame. */
  data: string | Uint8Array;
  bytes: number;
}

export class SessionBuffer {
  readonly id: string;
  /** Seq to assign to the next outbound message. Starts at 0. */
  nextSeq = 0;
  /** Oldest-first list of messages within the byte cap. */
  messages: BufferedMessage[] = [];
  totalBytes = 0;
  /** True once the cap forced us to drop an unacknowledged entry.
   *  Resume attempts must fall back to a fresh snapshot. */
  truncated = false;
  /** Attached WebSocket. Null while the session is detached. */
  ws: WS | null = null;
  detachedAt: number | null = null;
  subscribedSurfaceIds = new Set<string>();
  readonly maxBytes: number;
  /** Pending stdout chunks per surface, waiting for the coalesce timer. */
  pendingOutput = new Map<string, string>();
  /** Timer id for the next flush of pendingOutput. Null when none armed. */
  outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while ws.getBufferedAmount() is past WS_STALL_HIGH_WATER. */
  stalled = false;

  constructor(id: string, maxBytes: number = SESSION_BUFFER_MAX_BYTES) {
    this.id = id;
    this.maxBytes = maxBytes;
  }

  /** Append a serialized frame to the buffer, returning its assigned seq. */
  append(data: string | Uint8Array): number {
    const seq = this.nextSeq++;
    const bytes = typeof data === "string" ? byteLength(data) : data.byteLength;
    this.messages.push({ seq, data, bytes });
    this.totalBytes += bytes;
    while (this.totalBytes > this.maxBytes && this.messages.length > 1) {
      const dropped = this.messages.shift()!;
      this.totalBytes -= dropped.bytes;
      this.truncated = true;
    }
    return seq;
  }

  /** Messages with seq strictly greater than `since`. Returns null if
   *  the oldest retained seq is past `since + 1` (i.e. we dropped entries
   *  the client never saw, and delta replay would leave a gap). */
  since(since: number): BufferedMessage[] | null {
    if (this.messages.length === 0) {
      // No buffered messages at all: whether this is a valid resume
      // depends on `since`. If the client claims to have seen `nextSeq - 1`
      // (i.e. it's fully caught up), we can resume cleanly with zero
      // replay. Otherwise there's a gap we can't fill.
      if (since + 1 >= this.nextSeq) return [];
      return null;
    }
    const oldestSeq = this.messages[0]!.seq;
    if (since < oldestSeq - 1) return null;
    return this.messages.filter((m) => m.seq > since);
  }
}

export interface ClientData {
  clientId: string;
  session: SessionBuffer;
  /** Present only during upgrade handoff — cleared after open(). */
  resumeId?: string;
  resumeSeq?: number;
}

export interface WS {
  data: ClientData;
  send(data: string | BufferSource): void;
  close(): void;
  /** Bytes currently buffered by the underlying WS transport. Used for
   *  backpressure. Bun's server WS provides this method. */
  getBufferedAmount?(): number;
}

export function makeSessionId(): string {
  // 128-bit url-safe random id. Base36 is slightly shorter than hex.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(36).padStart(2, "0");
  }
  return s;
}

export function makeServerInstanceId(): string {
  return makeSessionId();
}

function byteLength(s: string): number {
  // Byte-accurate UTF-8 length without allocating. `encodeInto` on a
  // scratch buffer would be faster, but the JS engine's TextEncoder is
  // already cheap and this is not on a hot path.
  return new TextEncoder().encode(s).byteLength;
}
