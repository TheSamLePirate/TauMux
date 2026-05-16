// Phase 6 / L5 — behavioural regression for the reconnect-jitter
// spread. Phase 0's source-grep pinned the math formula; this test
// drives the extracted helper with deterministic randomness and
// observes the spread the real reconnect path produces.
//
// The invariant: for any baseDelay D, the jittered wait is in
// [floor(D * 0.75), ceil(D * 1.25)]. A regression that drops the
// jitter (deterministic 30 s) would fail the spread assertion;
// a regression that broadens it (e.g. ±50 % instead of ±25 %) would
// fail the bounds.

import { describe, expect, it } from "bun:test";
import { applyReconnectJitter } from "../src/web-client/transport";

describe("[L5] applyReconnectJitter — uniform ±25 % spread", () => {
  it("rand()=0.5 (mid-point) returns the base delay unchanged", () => {
    // 0.5 - 0.5 = 0, * 0.5 = 0, * baseDelay = 0, baseDelay + 0 = baseDelay.
    expect(applyReconnectJitter(1000, () => 0.5)).toBe(1000);
  });

  it("rand()=0.0 returns the lower bound (-25 %)", () => {
    // 0.0 - 0.5 = -0.5, * 0.5 = -0.25 → multiplier 0.75 → 750.
    expect(applyReconnectJitter(1000, () => 0.0)).toBe(750);
  });

  it("rand()≈1.0 returns the upper bound (+25 %)", () => {
    // 1.0 - 0.5 = 0.5, * 0.5 = 0.25 → multiplier 1.25 → 1250.
    // Math.random returns values in [0, 1) — we use 0.9999 as the
    // closest-to-1 input.
    expect(applyReconnectJitter(1000, () => 0.9999)).toBe(1250);
  });

  it("spread across 1000 calls stays within [0.75 × D, 1.25 × D]", () => {
    // Use real Math.random — observe the bounds rather than the exact
    // distribution. The thundering-herd defense doesn't need a perfect
    // uniform; it needs each peer's wait to differ enough to avoid
    // collision. ±25 % delivers that.
    const baseDelay = 4000;
    const low = baseDelay * 0.75;
    const high = baseDelay * 1.25;
    for (let i = 0; i < 1000; i++) {
      const wait = applyReconnectJitter(baseDelay);
      expect(wait).toBeGreaterThanOrEqual(low);
      expect(wait).toBeLessThanOrEqual(high);
    }
  });

  it("spread across 100 deterministic seeds covers a range > base × 0.4", () => {
    // Drive a sweep that simulates ten peers reconnecting and verify
    // the spread is wide enough that the LAN isn't seeing a thundering
    // herd. We feed 100 evenly-spaced rand() values and assert the
    // max-min spread is >= 40 % of the base delay (the worst case is
    // 50 % = 25 % × 2, so 40 % is a safe floor).
    const baseDelay = 2000;
    const waits: number[] = [];
    for (let i = 0; i < 100; i++) {
      const r = i / 100; // [0, 1)
      waits.push(applyReconnectJitter(baseDelay, () => r));
    }
    const min = Math.min(...waits);
    const max = Math.max(...waits);
    expect(max - min).toBeGreaterThanOrEqual(baseDelay * 0.4);
  });

  it("does NOT return a deterministic value (catches the pre-fix regression)", () => {
    // The pre-fix bug was `reconnectDelay = Math.min(reconnectDelay
    // * 2, 30000)` with no jitter — every peer got the same wait.
    // Verify the helper's output differs across rand() inputs.
    const a = applyReconnectJitter(5000, () => 0);
    const b = applyReconnectJitter(5000, () => 0.5);
    const c = applyReconnectJitter(5000, () => 0.9999);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("rounds to an integer (setTimeout takes ms)", () => {
    // The helper returns an integer because setTimeout in browsers
    // floors fractional values; we want explicit rounding so the
    // logged wait is readable.
    const w = applyReconnectJitter(1234, () => 0.123);
    expect(Number.isInteger(w)).toBe(true);
  });
});
