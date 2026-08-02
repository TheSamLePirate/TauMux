export const NATIVE_STDOUT_COALESCE_MS = 8;
export const NATIVE_STDOUT_COALESCE_SOFT_CAP = 8 * 1024;

export type NativeStdoutSink = (surfaceId: string, data: string) => void;

/**
 * Coalesce PTY stdout before it crosses the Electrobun RPC bridge.
 *
 * The PTY, history buffer, and headless replay still receive every chunk
 * immediately in SessionManager. This class only batches the UI transport so
 * fast producers do not generate one JSON/RPC dispatch per tiny read.
 *
 * ## Latency-first, throughput-second
 *
 * A fixed window is the obvious implementation and the wrong one: it
 * taxes the case where latency is most visible. Pressing a key produces
 * one tiny echo chunk, and a flat 8 ms window delays that echo by up to
 * 8 ms — on an idle terminal, where there is no batching benefit to be
 * had, because there is nothing else to batch it with.
 *
 * So the window is engaged by evidence of streaming rather than assumed:
 *
 *   - **Quiet surface** (nothing flushed within the last window) — flush
 *     on a microtask. Every chunk delivered in the same turn of the event
 *     loop still merges into one dispatch, so this costs no extra RPC
 *     traffic; it just stops waiting on a timer that has nothing to
 *     collect. Keystroke echo lands in the same tick it arrived.
 *   - **Busy surface** (something flushed within the last window) — fall
 *     back to the timer, batching everything that arrives until it fires.
 *
 * A burst therefore pays exactly one immediate dispatch for its leading
 * chunk — which is what makes output *start* appearing instantly — and
 * then settles into one dispatch per window for as long as it lasts.
 * Under `yes`-style load the steady-state behaviour is identical to the
 * fixed-window version.
 */
export class NativeStdoutCoalescer {
  private pending = new Map<string, string>();
  /** When each surface last handed data to the sink. Drives the
   *  quiet-vs-busy decision in `push`. */
  private lastFlushAt = new Map<string, number>();
  /** Surfaces with a microtask flush already queued, so a run of
   *  synchronous pushes queues one flush rather than one per chunk. */
  private microtaskQueued = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly sink: NativeStdoutSink,
    private readonly windowMs = NATIVE_STDOUT_COALESCE_MS,
    private readonly softCapBytes = NATIVE_STDOUT_COALESCE_SOFT_CAP,
    /** Injectable clock — tests drive the quiet/busy boundary without
     *  sleeping through real windows. */
    private readonly now: () => number = Date.now,
  ) {}

  push(surfaceId: string, data: string): void {
    if (!surfaceId || data.length === 0) return;
    const merged = (this.pending.get(surfaceId) ?? "") + data;
    this.pending.set(surfaceId, merged);

    // Big single reads bypass both paths — waiting only adds latency to
    // data that already justifies its own dispatch.
    if (merged.length >= this.softCapBytes) {
      this.flushSurface(surfaceId);
      return;
    }

    const since = this.now() - (this.lastFlushAt.get(surfaceId) ?? -Infinity);
    if (since >= this.windowMs) {
      if (!this.microtaskQueued.has(surfaceId)) {
        this.microtaskQueued.add(surfaceId);
        queueMicrotask(() => {
          this.microtaskQueued.delete(surfaceId);
          this.flushSurface(surfaceId);
        });
      }
      return;
    }

    this.schedule();
  }

  flushSurface(surfaceId: string): void {
    const data = this.pending.get(surfaceId);
    if (!data) return;
    this.pending.delete(surfaceId);
    this.lastFlushAt.set(surfaceId, this.now());
    this.sink(surfaceId, data);
    if (this.pending.size === 0) this.clearTimer();
  }

  flushAll(): void {
    this.clearTimer();
    const entries = [...this.pending.entries()];
    this.pending.clear();
    const at = this.now();
    for (const [surfaceId, data] of entries) {
      if (!data) continue;
      this.lastFlushAt.set(surfaceId, at);
      this.sink(surfaceId, data);
    }
  }

  /** Drop all state for a surface that has gone away. Without this the
   *  `lastFlushAt` map would retain an entry per surface ever opened for
   *  the lifetime of the app. */
  forget(surfaceId: string): void {
    this.pending.delete(surfaceId);
    this.lastFlushAt.delete(surfaceId);
    this.microtaskQueued.delete(surfaceId);
    if (this.pending.size === 0) this.clearTimer();
  }

  dispose(): void {
    this.flushAll();
    this.lastFlushAt.clear();
    this.microtaskQueued.clear();
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushAll();
    }, this.windowMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
