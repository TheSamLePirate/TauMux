import { describe, test, expect } from "bun:test";
import {
  decideBackpressure,
  SessionBuffer,
  WS_STALL_HIGH_WATER,
  WS_STALL_KICK_MS,
  WS_STALL_LOW_WATER,
} from "../src/bun/web/connection";

function mkSession(): SessionBuffer {
  return new SessionBuffer("test");
}

describe("decideBackpressure", () => {
  test("returns send when ws buffer is empty and session is healthy", () => {
    const s = mkSession();
    expect(decideBackpressure(s, 0, 1_000)).toBe("send");
    expect(s.stalled).toBe(false);
    expect(s.stalledAt).toBeNull();
  });

  test("transitions to stalled and skips when buffer crosses high water", () => {
    const s = mkSession();
    expect(decideBackpressure(s, WS_STALL_HIGH_WATER, 1_000)).toBe("skip");
    expect(s.stalled).toBe(true);
    expect(s.stalledAt).toBe(1_000);
  });

  test("keeps skipping while stalled and within kick window", () => {
    const s = mkSession();
    decideBackpressure(s, WS_STALL_HIGH_WATER, 1_000);
    // Half the kick window later, buffer is still past low water.
    const result = decideBackpressure(
      s,
      WS_STALL_HIGH_WATER,
      1_000 + WS_STALL_KICK_MS / 2,
    );
    expect(result).toBe("skip");
    expect(s.stalled).toBe(true);
    expect(s.stalledAt).toBe(1_000);
  });

  test("clears stall and resumes sending when buffer drops to low water", () => {
    const s = mkSession();
    decideBackpressure(s, WS_STALL_HIGH_WATER, 1_000);
    const result = decideBackpressure(s, WS_STALL_LOW_WATER, 1_500);
    expect(result).toBe("send");
    expect(s.stalled).toBe(false);
    expect(s.stalledAt).toBeNull();
  });

  test("hysteresis: buffer between low and high water stays skipped", () => {
    const s = mkSession();
    decideBackpressure(s, WS_STALL_HIGH_WATER, 1_000);
    // Buffer partially drained but still above LOW — stall holds.
    const mid = Math.floor((WS_STALL_HIGH_WATER + WS_STALL_LOW_WATER) / 2);
    expect(decideBackpressure(s, mid, 1_100)).toBe("skip");
    expect(s.stalled).toBe(true);
  });

  test("kicks after stall outlasts WS_STALL_KICK_MS without draining", () => {
    const s = mkSession();
    decideBackpressure(s, WS_STALL_HIGH_WATER, 1_000);
    const result = decideBackpressure(
      s,
      WS_STALL_HIGH_WATER,
      1_000 + WS_STALL_KICK_MS,
    );
    expect(result).toBe("kick");
    // Session stays marked stalled so the close path is idempotent — the
    // subsequent close handler is what clears the session.
    expect(s.stalled).toBe(true);
  });

  test("kick is only returned once the kick threshold is actually reached", () => {
    const s = mkSession();
    decideBackpressure(s, WS_STALL_HIGH_WATER, 1_000);
    // Exactly one millisecond before the kick threshold: still skip.
    expect(
      decideBackpressure(s, WS_STALL_HIGH_WATER, 1_000 + WS_STALL_KICK_MS - 1),
    ).toBe("skip");
  });

  test("does not stall when buffer is exactly at the low water mark", () => {
    const s = mkSession();
    // A healthy client sitting right at LOW should still be able to send.
    expect(decideBackpressure(s, WS_STALL_LOW_WATER, 1_000)).toBe("send");
    expect(s.stalled).toBe(false);
  });
});
