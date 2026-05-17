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
 *                 Decision-aid for sizing future bounded queues. */
export interface EventWriterMetrics {
  sent: number;
  inFlight: number;
  failed: number;
  peakInFlight: number;
}

export class EventWriter {
  private closed = false;

  onError: ((source: string, error: Error) => void) | null = null;

  private metrics: EventWriterMetrics = {
    sent: 0,
    inFlight: 0,
    failed: 0,
    peakInFlight: 0,
  };

  constructor(private fd: number) {}

  send(event: PanelEvent): boolean {
    if (this.closed) return false;
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

  close(): void {
    this.closed = true;
  }
}
