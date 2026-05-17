import type { PanelEvent } from "../shared/types";

const encoder = new TextEncoder();

/** P7 S4 — observability snapshot for the fd 3/4/5 sideband pipe.
 *  Surfaced by `EventWriter.getMetrics()` so a runaway producer or a
 *  stalled consumer becomes visible (currently the writer is
 *  fire-and-forget and a wedge is silent).
 *
 *  Definitions:
 *    - `sent`     count of `send()` calls that handed a frame to
 *                 `Bun.write` without synchronously throwing.
 *    - `inFlight` writes that are still pending OS completion. Should
 *                 hover near zero on a healthy pipe. A growing value
 *                 means the reader has stalled (or the pipe is full).
 *    - `failed`   writes whose Promise rejected OR whose synchronous
 *                 leg threw. Reflects total lifetime failures; a non-
 *                 zero value with `inFlight === 0` means the consumer
 *                 went away and the writer is now a no-op.
 *    - `peakInFlight` high-water mark of `inFlight` since construction.
 *                 Decision-aid for sizing the bounded queue / drop
 *                 threshold below.
 *    - `dropped`  P7 S5 — count of `send()` calls rejected by the
 *                 high-water mark guard. A non-zero value means the
 *                 producer outran the consumer at least once. */
export interface EventWriterMetrics {
  sent: number;
  inFlight: number;
  failed: number;
  peakInFlight: number;
  dropped: number;
}

/** P7 S5 — soft cap on concurrent in-flight writes. When `inFlight`
 *  hits this number, further `send()` calls return false + bump
 *  `dropped` instead of stacking more pending Promises that may never
 *  resolve. The default is generous (1024) — well past the
 *  `peakInFlight` healthy bursts we measured at the end of S4, but
 *  tight enough that a hard wedge stops bleeding RAM after ~1 MB of
 *  queued frames (each frame ~1 KB on average). Override in tests /
 *  constructor for tighter assertions. */
export const DEFAULT_MAX_IN_FLIGHT = 1024;

export interface EventWriterOptions {
  /** Override the default high-water mark. Must be > 0; values ≤ 0
   *  fall back to the default. */
  maxInFlight?: number;
}

export class EventWriter {
  private closed = false;

  onError: ((source: string, error: Error) => void) | null = null;

  private metrics: EventWriterMetrics = {
    sent: 0,
    inFlight: 0,
    failed: 0,
    peakInFlight: 0,
    dropped: 0,
  };

  private readonly maxInFlight: number;

  constructor(
    private fd: number,
    options: EventWriterOptions = {},
  ) {
    this.maxInFlight =
      typeof options.maxInFlight === "number" && options.maxInFlight > 0
        ? options.maxInFlight
        : DEFAULT_MAX_IN_FLIGHT;
  }

  send(event: PanelEvent): boolean {
    if (this.closed) return false;
    // P7 S5 — backpressure guard. A wedged consumer leaves Bun.write
    // promises pending; without this cap a runaway producer could
    // queue gigabytes of frames in node-internal write buffers before
    // anything noticed.
    if (this.metrics.inFlight >= this.maxInFlight) {
      this.metrics.dropped++;
      return false;
    }
    try {
      const line = JSON.stringify(event) + "\n";
      const promise = Bun.write(Bun.file(this.fd), encoder.encode(line));
      this.metrics.sent++;
      this.metrics.inFlight++;
      if (this.metrics.inFlight > this.metrics.peakInFlight) {
        this.metrics.peakInFlight = this.metrics.inFlight;
      }
      // Bun.write returns a Promise — catch async write failures and
      // decrement the in-flight counter on settle (resolve or reject).
      (promise as Promise<number>)
        .catch((err: unknown) => {
          this.metrics.failed++;
          this.onError?.(
            "event-write",
            err instanceof Error ? err : new Error(String(err)),
          );
        })
        .finally(() => {
          this.metrics.inFlight--;
        });
      return true;
    } catch (err) {
      this.metrics.failed++;
      this.onError?.(
        "event-write",
        err instanceof Error ? err : new Error(String(err)),
      );
      return false;
    }
  }

  /** Snapshot of the current metric counters. Cheap; not memoised. */
  getMetrics(): EventWriterMetrics {
    return { ...this.metrics };
  }

  /** Current high-water mark — exposed so the host can surface it in
   *  a health snapshot alongside `inFlight`. */
  getMaxInFlight(): number {
    return this.maxInFlight;
  }

  close(): void {
    this.closed = true;
  }
}
