export const NATIVE_STDOUT_COALESCE_MS = 8;
export const NATIVE_STDOUT_COALESCE_SOFT_CAP = 8 * 1024;

export type NativeStdoutSink = (surfaceId: string, data: string) => void;

/**
 * Coalesce PTY stdout before it crosses the Electrobun RPC bridge.
 *
 * The PTY, history buffer, and headless replay still receive every chunk
 * immediately in SessionManager. This class only batches the UI transport so
 * fast producers do not generate one JSON/RPC dispatch per tiny read.
 */
export class NativeStdoutCoalescer {
  private pending = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly sink: NativeStdoutSink,
    private readonly windowMs = NATIVE_STDOUT_COALESCE_MS,
    private readonly softCapBytes = NATIVE_STDOUT_COALESCE_SOFT_CAP,
  ) {}

  push(surfaceId: string, data: string): void {
    if (!surfaceId || data.length === 0) return;
    const merged = (this.pending.get(surfaceId) ?? "") + data;
    this.pending.set(surfaceId, merged);
    if (merged.length >= this.softCapBytes) {
      this.flushSurface(surfaceId);
      return;
    }
    this.schedule();
  }

  flushSurface(surfaceId: string): void {
    const data = this.pending.get(surfaceId);
    if (!data) return;
    this.pending.delete(surfaceId);
    this.sink(surfaceId, data);
    if (this.pending.size === 0) this.clearTimer();
  }

  flushAll(): void {
    this.clearTimer();
    const entries = [...this.pending.entries()];
    this.pending.clear();
    for (const [surfaceId, data] of entries) {
      if (data) this.sink(surfaceId, data);
    }
  }

  dispose(): void {
    this.flushAll();
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
