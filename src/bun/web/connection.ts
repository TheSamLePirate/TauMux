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
/** How long a stall can last before we force-close the ws. After a
 *  close the session survives for SESSION_TTL_MS so the client reconnects
 *  with ?resume= and gets delta replay — that's strictly better than
 *  leaving it silently receiving nothing. */
export const WS_STALL_KICK_MS = 10_000;

/** Max size of a single client→server frame, in bytes. Generous enough
 *  for pastes, small enough to bound a single burst from a malicious or
 *  buggy client. */
export const CLIENT_MESSAGE_MAX_BYTES = 256 * 1024;
/** Max size of a single stdin payload after decoding. Pastes on a
 *  1000-col terminal are ~60 KB, so 64 KB is comfortable. */
export const CLIENT_STDIN_MAX_BYTES = 64 * 1024;
/** Token-bucket rate limit on client→server frames. The bucket
 *  regenerates at `REFILL_PER_SEC` tokens/sec and fills to `CAPACITY`. */
export const CLIENT_RATE_CAPACITY = 256;
export const CLIENT_RATE_REFILL_PER_SEC = 256;
/** Terminal resize clamps — defensive against clients that propose
 *  ridiculous dimensions that could trigger allocation failures in
 *  xterm.js / the PTY. */
export const TERMINAL_COLS_MIN = 10;
export const TERMINAL_COLS_MAX = 500;
export const TERMINAL_ROWS_MIN = 4;
export const TERMINAL_ROWS_MAX = 500;

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
  /** Timestamp (ms) when the session first became stalled. Cleared when
   *  the stall resolves. Used to kick a persistently-stalled ws so the
   *  client can reconnect and resume. */
  stalledAt: number | null = null;
  /** Token bucket for client→server frame rate limiting. */
  rateTokens = CLIENT_RATE_CAPACITY;
  rateLastRefillMs = Date.now();

  constructor(id: string, maxBytes: number = SESSION_BUFFER_MAX_BYTES) {
    this.id = id;
    this.maxBytes = maxBytes;
  }

  /** Try to consume one token. Returns false when the bucket is empty,
   *  meaning the caller should drop the incoming frame. */
  consumeRateToken(nowMs: number = Date.now()): boolean {
    const elapsedSec = (nowMs - this.rateLastRefillMs) / 1000;
    if (elapsedSec > 0) {
      this.rateTokens = Math.min(
        CLIENT_RATE_CAPACITY,
        this.rateTokens + elapsedSec * CLIENT_RATE_REFILL_PER_SEC,
      );
      this.rateLastRefillMs = nowMs;
    }
    if (this.rateTokens < 1) return false;
    this.rateTokens -= 1;
    return true;
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
  /** Null between `server.upgrade()` and the `open()` callback. Once
   *  open() runs, this is always non-null for the life of the ws. */
  session: SessionBuffer | null;
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
  // 128-bit random id, hex-encoded. Uniform 32-char output, full 128 bits
  // of entropy (no base36 per-byte truncation). Session-hijacking via
  // guessing requires enumerating 2^128 values.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(16).padStart(2, "0");
  }
  return s;
}

export function makeServerInstanceId(): string {
  return makeSessionId();
}

/** Decide what to do with an outbound ws.send call given the ws buffer
 *  pressure. Pure so we can unit-test the hysteresis + kick timing
 *  without standing up a real WebSocket.
 *
 *  Returns one of:
 *   - `"send"`: clear to send; mutates session to reset any stall flag.
 *   - `"skip"`: ws is stalled, don't send. The caller has already
 *      buffered the message on the session so a resume can replay it.
 *   - `"kick"`: stall has outlasted WS_STALL_KICK_MS. The caller should
 *      close the ws; the session survives TTL so the client can resume.
 *      Still returns `"skip"`-semantics for this call (don't send).
 */
export function decideBackpressure(
  session: SessionBuffer,
  buffered: number,
  nowMs: number = Date.now(),
): "send" | "skip" | "kick" {
  if (session.stalled) {
    if (buffered <= WS_STALL_LOW_WATER) {
      session.stalled = false;
      session.stalledAt = null;
      return "send";
    }
    if (
      session.stalledAt !== null &&
      nowMs - session.stalledAt >= WS_STALL_KICK_MS
    ) {
      return "kick";
    }
    return "skip";
  }
  if (buffered >= WS_STALL_HIGH_WATER) {
    session.stalled = true;
    session.stalledAt = nowMs;
    return "skip";
  }
  return "send";
}

function byteLength(s: string): number {
  // Byte-accurate UTF-8 length without allocating. `encodeInto` on a
  // scratch buffer would be faster, but the JS engine's TextEncoder is
  // already cheap and this is not on a hot path.
  return new TextEncoder().encode(s).byteLength;
}
