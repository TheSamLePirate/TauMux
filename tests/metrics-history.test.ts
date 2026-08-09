// Short-horizon metric history — the series behind the Atlas sparklines
// and the activity river.
//
// Three properties carry the design: the ring is bounded (a week-long
// session cannot grow it), a burst between two draws survives into the
// window (peak, not last), and a collection gap stays a gap rather than
// being bridged by a line implying data nobody collected.

import { beforeEach, describe, expect, test } from "bun:test";
import {
  HISTORY_CAPACITY,
  forgetMetrics,
  historyFor,
  isGap,
  peakCpu,
  pruneMetrics,
  recordMetrics,
  resetMetrics,
  windowBytes,
} from "../src/views/terminal/metrics-history";

const T0 = 1_700_000_000_000;
/** One sample per virtual second — past the 900 ms coalesce window. */
const at = (i: number) => T0 + i * 1000;

describe("metrics history", () => {
  beforeEach(() => resetMetrics());

  test("an unseen key has no series", () => {
    expect(historyFor("nope")).toEqual([]);
    expect(peakCpu("nope")).toBe(0);
    expect(windowBytes("nope")).toBe(0);
  });

  test("samples come back oldest-first", () => {
    recordMetrics("s1", 10, 100, at(0));
    recordMetrics("s1", 20, 200, at(1));
    recordMetrics("s1", 30, 300, at(2));
    expect(historyFor("s1").map((s) => s.cpu)).toEqual([10, 20, 30]);
  });

  test("the ring is bounded and keeps the newest window", () => {
    for (let i = 0; i < HISTORY_CAPACITY * 3; i++) {
      recordMetrics("s1", i, i, at(i));
    }
    const series = historyFor("s1");
    expect(series).toHaveLength(HISTORY_CAPACITY);
    // Oldest retained sample is exactly `capacity` back from the newest.
    const newest = HISTORY_CAPACITY * 3 - 1;
    expect(series[series.length - 1]!.cpu).toBe(newest);
    expect(series[0]!.cpu).toBe(newest - HISTORY_CAPACITY + 1);
  });

  test("samples inside one second coalesce to the peak, not the last", () => {
    recordMetrics("s1", 5, 50, T0);
    recordMetrics("s1", 90, 9_000, T0 + 100); // the spike
    recordMetrics("s1", 5, 50, T0 + 200); // back to idle
    const series = historyFor("s1");
    expect(series).toHaveLength(1);
    expect(series[0]!.cpu).toBe(90);
    expect(series[0]!.bytes).toBe(9_000);
  });

  test("a redraw storm cannot compress the window", () => {
    for (let i = 0; i < 500; i++) recordMetrics("s1", 1, 1, T0 + i);
    expect(historyFor("s1")).toHaveLength(1);
  });

  test("peakCpu reports the window's high-water mark", () => {
    recordMetrics("s1", 10, 0, at(0));
    recordMetrics("s1", 130, 0, at(1));
    recordMetrics("s1", 4, 0, at(2));
    expect(peakCpu("s1")).toBe(130);
  });

  test("a collection gap is detectable and excluded from integration", () => {
    recordMetrics("s1", 0, 1_000, at(0));
    recordMetrics("s1", 0, 1_000, at(1));
    // 30 s of silence — the app was asleep, not the pane.
    recordMetrics("s1", 0, 1_000, at(31));
    const series = historyFor("s1");
    expect(isGap(series[0]!, series[1]!)).toBe(false);
    expect(isGap(series[1]!, series[2]!)).toBe(true);
    // Only the contiguous second contributes; the gap is not bridged.
    expect(windowBytes("s1")).toBe(1_000);
  });

  test("windowBytes integrates rate over elapsed time", () => {
    recordMetrics("s1", 0, 0, at(0));
    recordMetrics("s1", 0, 2_048, at(1));
    recordMetrics("s1", 0, 2_048, at(2));
    expect(windowBytes("s1")).toBe(4_096);
  });

  test("keys are independent", () => {
    recordMetrics("a", 1, 1, at(0));
    recordMetrics("b", 2, 2, at(0));
    expect(historyFor("a")).toHaveLength(1);
    expect(historyFor("b")[0]!.cpu).toBe(2);
  });

  test("forgetting a closed pane drops its series", () => {
    recordMetrics("s1", 1, 1, at(0));
    forgetMetrics("s1");
    expect(historyFor("s1")).toEqual([]);
  });

  test("pruning keeps only the live keys", () => {
    recordMetrics("keep", 1, 1, at(0));
    recordMetrics("gone", 1, 1, at(0));
    pruneMetrics(new Set(["keep"]));
    expect(historyFor("keep")).toHaveLength(1);
    expect(historyFor("gone")).toEqual([]);
  });
});
