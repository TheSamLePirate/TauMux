/**
 * Per-surface stdout throughput meter.
 *
 * τ-mux knows a lot about *what* is running in a pane (pid, cwd, git,
 * ports, CPU) and nothing at all about how loudly it is talking. The
 * Atlas graph encodes that missing dimension: the wire between a
 * workspace and its surface flows at a speed derived from the pane's
 * real byte rate, so a `bun test` firehose is visible without reading a
 * single label.
 *
 * Design constraints this module answers:
 *
 *  - **Idle costs nothing.** No timers. Decay is computed lazily at read
 *    time from the last sample's timestamp, so a τ-mux with no output
 *    runs no code here between writes.
 *  - **Never in the PTY's way.** `note()` is two float multiplies and a
 *    map write on the hot `writeToSurface` path. It cannot throw and it
 *    never touches the terminal.
 *  - **Bursts read as bursts.** An exponential moving average over a
 *    ~1.2 s window: fast enough that a build's output looks alive,
 *    slow enough that a single 4 KB chunk doesn't spike the wire to
 *    maximum for a frame and drop back.
 *
 * The unit is bytes/second of decoded PTY text. Consumers should treat
 * it as a log-scale signal (see `flowLevel`), not a precise measurement —
 * chunk boundaries are set by the OS pipe, not by the producer.
 */

/** Half-life of the moving average, in ms. */
const HALF_LIFE_MS = 1_200;

/** Below this rate a stream is "quiet" — consumers render it at rest and
 *  run no animation. Roughly a slow log line every few seconds. */
export const QUIET_BYTES_PER_SEC = 200;

/** Above this rate the signal saturates. ~256 KB/s is a full-tilt build
 *  log; beyond it the difference is not perceptually useful. */
const SATURATION_BYTES_PER_SEC = 262_144;

interface Sample {
  /** Current EWMA estimate in bytes/sec. */
  rate: number;
  /** `performance.now()` of the last `note()`. */
  at: number;
}

const samples = new Map<string, Sample>();

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Decay `rate` forward from `elapsed` ms of silence. */
function decay(rate: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return rate;
  return rate * Math.pow(0.5, elapsedMs / HALF_LIFE_MS);
}

/**
 * Record `byteCount` bytes written to `surfaceId`. Called from the PTY
 * write path — must stay cheap and total.
 */
export function noteThroughput(surfaceId: string, byteCount: number): void {
  if (byteCount <= 0) return;
  const t = now();
  const prev = samples.get(surfaceId);
  if (!prev) {
    // First chunk: attribute it to one half-life so a single burst
    // doesn't read as an infinite rate.
    samples.set(surfaceId, {
      rate: byteCount / (HALF_LIFE_MS / 1000),
      at: t,
    });
    return;
  }
  // Floor the gap so two writes landing in the same millisecond can't
  // divide by ~0 and spike the estimate to an absurd rate.
  const elapsed = Math.max(t - prev.at, 8);
  const decayed = decay(prev.rate, elapsed);
  const instant = byteCount / (elapsed / 1000);
  const weight = 1 - Math.pow(0.5, elapsed / HALF_LIFE_MS);
  prev.rate = decayed + (instant - decayed) * weight;
  prev.at = t;
}

/** Current estimated rate in bytes/sec for `surfaceId`, decayed to now. */
export function throughputOf(surfaceId: string): number {
  const s = samples.get(surfaceId);
  if (!s) return 0;
  const r = decay(s.rate, now() - s.at);
  // Collapse dust to zero so consumers can compare against 0 exactly and
  // the map doesn't hold micro-values forever.
  return r < 1 ? 0 : r;
}

/**
 * Normalised 0…1 flow level for `surfaceId`, log-scaled between the quiet
 * floor and saturation. Returns exactly 0 for anything at or below the
 * quiet floor so callers can branch on `=== 0` to skip animation
 * entirely — that branch is what keeps an idle τ-mux at ~0 % CPU.
 */
export function flowLevel(surfaceId: string): number {
  const rate = throughputOf(surfaceId);
  if (rate <= QUIET_BYTES_PER_SEC) return 0;
  const span = Math.log(SATURATION_BYTES_PER_SEC / QUIET_BYTES_PER_SEC);
  const level = Math.log(rate / QUIET_BYTES_PER_SEC) / span;
  return Math.min(1, Math.max(0, level));
}

/** Human-readable rate, e.g. `1.4 KB/s`. Empty string when quiet. */
export function formatThroughput(surfaceId: string): string {
  const rate = throughputOf(surfaceId);
  if (rate <= QUIET_BYTES_PER_SEC) return "";
  if (rate < 1024) return `${Math.round(rate)} B/s`;
  if (rate < 1024 * 1024) return `${(rate / 1024).toFixed(1)} KB/s`;
  return `${(rate / (1024 * 1024)).toFixed(1)} MB/s`;
}

/** Drop a surface's sample when its pane closes. */
export function forgetThroughput(surfaceId: string): void {
  samples.delete(surfaceId);
}

/** Test seam — clears every sample. */
export function resetThroughput(): void {
  samples.clear();
}
