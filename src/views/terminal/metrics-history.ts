/**
 * Short-horizon metric history.
 *
 * The Atlas graph answers "what is happening *now*". It has no way to
 * show "what just happened" — a pane that spiked to 100 % CPU two
 * seconds ago and is idle again looks identical to one that has been
 * asleep all morning. This module is the missing temporal axis: a small
 * ring buffer per key, sampled at the same ~1 Hz the metadata poller
 * already ticks at, read by the inspector's sparklines and by the
 * activity river.
 *
 * Constraints it answers, in the same spirit as `throughput-meter.ts`:
 *
 *  - **No timers.** Samples are pushed by whoever is already awake —
 *    the Atlas panel's draw pass, which itself only runs on a real
 *    change. An idle τ-mux records nothing and costs nothing.
 *  - **Bounded, forever.** Fixed-size ring per key, and keys are dropped
 *    when their pane closes. A week-long session cannot grow this.
 *  - **Gap-honest.** Samples carry their timestamp, so a series with a
 *    30 s hole renders as a hole rather than as a straight line that
 *    implies data nobody collected.
 */

/** Samples retained per key. At ~1 Hz this is a 90-second window — long
 *  enough to see a build ramp up and finish, short enough to stay
 *  legible in a 40 px sparkline. */
export const HISTORY_CAPACITY = 90;

/** A sample older than this is treated as the far side of a gap. */
const GAP_MS = 4_000;

export interface MetricSample {
  /** `Date.now()` when the sample was taken. */
  at: number;
  /** CPU percent across the subject's process tree (can exceed 100). */
  cpu: number;
  /** Stdout bytes/second at sample time. */
  bytes: number;
}

interface Ring {
  samples: MetricSample[];
  /** Next write index. */
  head: number;
}

const rings = new Map<string, Ring>();

/**
 * Record one sample for `key`. Called once per draw pass per subject;
 * duplicate calls inside the same second overwrite rather than append,
 * so a burst of redraws cannot compress the window.
 */
export function recordMetrics(
  key: string,
  cpu: number,
  bytes: number,
  now = Date.now(),
): void {
  let ring = rings.get(key);
  if (!ring) {
    ring = { samples: [], head: 0 };
    rings.set(key, ring);
  }
  const last =
    ring.samples[(ring.head - 1 + HISTORY_CAPACITY) % HISTORY_CAPACITY];
  if (last && now - last.at < 900) {
    // Same second — keep the peak rather than the latest, so a spike
    // between two draws survives into the history.
    last.cpu = Math.max(last.cpu, cpu);
    last.bytes = Math.max(last.bytes, bytes);
    return;
  }
  const sample: MetricSample = { at: now, cpu, bytes };
  if (ring.samples.length < HISTORY_CAPACITY) {
    ring.samples.push(sample);
  } else {
    ring.samples[ring.head] = sample;
  }
  ring.head = (ring.head + 1) % HISTORY_CAPACITY;
}

/** Samples for `key`, oldest first. Empty when nothing was recorded. */
export function historyFor(key: string): MetricSample[] {
  const ring = rings.get(key);
  if (!ring) return [];
  if (ring.samples.length < HISTORY_CAPACITY) return [...ring.samples];
  return [
    ...ring.samples.slice(ring.head),
    ...ring.samples.slice(0, ring.head),
  ];
}

/** True when consecutive samples straddle a collection gap. */
export function isGap(a: MetricSample, b: MetricSample): boolean {
  return b.at - a.at > GAP_MS;
}

/** Peak CPU seen in `key`'s window — the "it did spike" signal a live
 *  reading cannot give you. */
export function peakCpu(key: string): number {
  let peak = 0;
  for (const s of historyFor(key)) if (s.cpu > peak) peak = s.cpu;
  return peak;
}

/** Total bytes attributable to `key`'s window, integrating each sample's
 *  rate over the gap that preceded it. Approximate by construction —
 *  it is a "how much has this pane said lately" figure, not accounting. */
export function windowBytes(key: string): number {
  const samples = historyFor(key);
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const cur = samples[i]!;
    if (isGap(prev, cur)) continue;
    total += cur.bytes * ((cur.at - prev.at) / 1000);
  }
  return total;
}

export function forgetMetrics(key: string): void {
  rings.delete(key);
}

/** Drop every key not in `live`. Called after a draw so closed panes and
 *  removed workspaces don't linger in the river. */
export function pruneMetrics(live: ReadonlySet<string>): void {
  for (const key of [...rings.keys()]) {
    if (!live.has(key)) rings.delete(key);
  }
}

/** Test seam. */
export function resetMetrics(): void {
  rings.clear();
}
