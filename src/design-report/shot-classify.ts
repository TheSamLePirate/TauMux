/**
 * Pure pixel-diff classifier. Owns the decision of how to bucket a
 * shot into `ok | over | dim-mismatch | new | missing | corrupt`. No
 * filesystem writes; callers hand it decoded PNGs (or `null`s) and a
 * threshold.
 */
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { ShotStatus } from "./types";

export interface DecodedPng {
  width: number;
  height: number;
  data: Buffer;
}

export interface ClassifyInput {
  /** Null when the current run produced no PNG for this key. */
  current: DecodedPng | null;
  /** Null when no committed baseline exists. */
  baseline: DecodedPng | null;
  /** Diff fraction ≤ failFraction → `ok`; above → `over`. */
  failFraction: number;
  /** pixelmatch's per-pixel colour tolerance (0..1). */
  pxThreshold: number;
}

export interface ClassifyResult {
  status: ShotStatus;
  diffFraction: number | null;
  diffPixels: number | null;
  totalPixels: number | null;
  /** Written only when both PNGs decoded AND dimensions matched. */
  diffPng: Buffer | null;
}

export function classifyShot(input: ClassifyInput): ClassifyResult {
  const { current, baseline, failFraction, pxThreshold } = input;

  if (!current && !baseline) {
    // Shouldn't normally happen — callers pair current-or-baseline keys
    // before calling this. Guard anyway.
    return {
      status: "missing",
      diffFraction: null,
      diffPixels: null,
      totalPixels: null,
      diffPng: null,
    };
  }

  if (!current && baseline) {
    return {
      status: "baseline-only",
      diffFraction: null,
      diffPixels: null,
      totalPixels: null,
      diffPng: null,
    };
  }

  if (current && !baseline) {
    return {
      status: "new",
      diffFraction: null,
      diffPixels: null,
      totalPixels: null,
      diffPng: null,
    };
  }

  // Both present.
  const cur = current!;
  const base = baseline!;
  if (cur.width !== base.width || cur.height !== base.height) {
    const total = cur.width * cur.height;
    return {
      status: "dim-mismatch",
      diffFraction: 1,
      diffPixels: total,
      totalPixels: total,
      diffPng: null,
    };
  }

  try {
    const diff = new PNG({ width: cur.width, height: cur.height });
    const mismatched = pixelmatch(
      base.data,
      cur.data,
      diff.data,
      cur.width,
      cur.height,
      { threshold: pxThreshold },
    );
    const total = cur.width * cur.height;
    const fraction = total === 0 ? 0 : mismatched / total;
    return {
      status: fraction > failFraction ? "over" : "ok",
      diffFraction: fraction,
      diffPixels: mismatched,
      totalPixels: total,
      diffPng: PNG.sync.write(diff),
    };
  } catch {
    // pixelmatch / PNG decode hit something unexpected. Surface it as
    // a distinct state rather than silently degrading to `new`.
    return {
      status: "corrupt",
      diffFraction: null,
      diffPixels: null,
      totalPixels: null,
      diffPng: null,
    };
  }
}

/** Decode a PNG buffer; returns null on parse failure so callers can
 *  surface `corrupt` instead of crashing. */
export function tryDecodePng(buf: Buffer): DecodedPng | null {
  try {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data as Buffer };
  } catch {
    return null;
  }
}
