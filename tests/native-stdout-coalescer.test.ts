import { describe, expect, test } from "bun:test";
import { NativeStdoutCoalescer } from "../src/bun/native-stdout-coalescer";

describe("native stdout coalescer", () => {
  test("batches small chunks within the coalescing window", async () => {
    const sent: { surfaceId: string; data: string }[] = [];
    const coalescer = new NativeStdoutCoalescer(
      (surfaceId, data) => sent.push({ surfaceId, data }),
      12,
      1024,
    );

    coalescer.push("surface:1", "a");
    coalescer.push("surface:1", "b");
    coalescer.push("surface:1", "c");
    expect(sent).toEqual([]);

    await Bun.sleep(30);
    expect(sent).toEqual([{ surfaceId: "surface:1", data: "abc" }]);
  });

  test("flushes a surface immediately when it crosses the soft cap", () => {
    const sent: { surfaceId: string; data: string }[] = [];
    const coalescer = new NativeStdoutCoalescer(
      (surfaceId, data) => sent.push({ surfaceId, data }),
      100,
      4,
    );

    coalescer.push("surface:1", "ab");
    coalescer.push("surface:2", "xy");
    coalescer.push("surface:1", "cd");

    expect(sent).toEqual([{ surfaceId: "surface:1", data: "abcd" }]);

    coalescer.flushAll();
    expect(sent).toEqual([
      { surfaceId: "surface:1", data: "abcd" },
      { surfaceId: "surface:2", data: "xy" },
    ]);
  });

  test("dispose flushes pending output", () => {
    const sent: { surfaceId: string; data: string }[] = [];
    const coalescer = new NativeStdoutCoalescer(
      (surfaceId, data) => sent.push({ surfaceId, data }),
      100,
      1024,
    );

    coalescer.push("surface:1", "tail");
    coalescer.dispose();

    expect(sent).toEqual([{ surfaceId: "surface:1", data: "tail" }]);
  });
});

/**
 * Adaptive-window behaviour. The point of these is that the *first*
 * chunk after a quiet period must not wait out the coalescing window —
 * that delay is what a user feels as keystroke-echo lag — while a
 * sustained producer must still collapse into one dispatch per window.
 */
describe("native stdout coalescer — adaptive window", () => {
  /** Controllable clock so the quiet/busy boundary is exercised exactly
   *  rather than by sleeping through real windows. */
  function makeClock(start = 10_000) {
    let t = start;
    return {
      now: () => t,
      advance: (ms: number) => {
        t += ms;
      },
    };
  }

  test("a quiet surface flushes on a microtask, not on the timer", async () => {
    const sent: { surfaceId: string; data: string }[] = [];
    const clock = makeClock();
    const coalescer = new NativeStdoutCoalescer(
      (surfaceId, data) => sent.push({ surfaceId, data }),
      1000, // a window long enough that a timer flush would be obvious
      1024,
      clock.now,
    );

    coalescer.push("surface:1", "x");
    // Not yet — still same synchronous turn.
    expect(sent).toEqual([]);

    // One microtask checkpoint, no timers, no real time.
    await Promise.resolve();
    expect(sent).toEqual([{ surfaceId: "surface:1", data: "x" }]);
  });

  test("chunks in the same tick still merge into one dispatch", async () => {
    const sent: { surfaceId: string; data: string }[] = [];
    const clock = makeClock();
    const coalescer = new NativeStdoutCoalescer(
      (surfaceId, data) => sent.push({ surfaceId, data }),
      1000,
      1024,
      clock.now,
    );

    coalescer.push("surface:1", "a");
    coalescer.push("surface:1", "b");
    coalescer.push("surface:1", "c");

    await Promise.resolve();
    // Latency-first must not mean chattier: still exactly one dispatch.
    expect(sent).toEqual([{ surfaceId: "surface:1", data: "abc" }]);
  });

  test("a busy surface falls back to the timer and batches", async () => {
    const sent: { surfaceId: string; data: string }[] = [];
    const clock = makeClock();
    const coalescer = new NativeStdoutCoalescer(
      (surfaceId, data) => sent.push({ surfaceId, data }),
      12,
      1024,
      clock.now,
    );

    // Leading chunk of the burst: immediate.
    coalescer.push("surface:1", "1");
    await Promise.resolve();
    expect(sent.length).toBe(1);

    // Still inside the window → these must batch rather than dispatch
    // one at a time.
    clock.advance(2);
    coalescer.push("surface:1", "2");
    clock.advance(2);
    coalescer.push("surface:1", "3");
    await Promise.resolve();
    expect(sent.length).toBe(1);

    await Bun.sleep(40);
    expect(sent).toEqual([
      { surfaceId: "surface:1", data: "1" },
      { surfaceId: "surface:1", data: "23" },
    ]);
  });

  test("a surface that has gone quiet again regains immediate flush", async () => {
    const sent: { surfaceId: string; data: string }[] = [];
    const clock = makeClock();
    const coalescer = new NativeStdoutCoalescer(
      (surfaceId, data) => sent.push({ surfaceId, data }),
      12,
      1024,
      clock.now,
    );

    coalescer.push("surface:1", "burst");
    await Promise.resolve();
    expect(sent.length).toBe(1);

    // Well past the window — the next keystroke echo should not be taxed
    // just because this surface was busy a moment ago.
    clock.advance(500);
    coalescer.push("surface:1", "k");
    await Promise.resolve();
    expect(sent).toEqual([
      { surfaceId: "surface:1", data: "burst" },
      { surfaceId: "surface:1", data: "k" },
    ]);
  });

  test("the soft cap still short-circuits both paths", () => {
    const sent: { surfaceId: string; data: string }[] = [];
    const clock = makeClock();
    const coalescer = new NativeStdoutCoalescer(
      (surfaceId, data) => sent.push({ surfaceId, data }),
      1000,
      4,
      clock.now,
    );

    // Synchronous — no microtask, no timer.
    coalescer.push("surface:1", "abcd");
    expect(sent).toEqual([{ surfaceId: "surface:1", data: "abcd" }]);
  });

  test("busy/quiet state is tracked per surface", async () => {
    const sent: { surfaceId: string; data: string }[] = [];
    const clock = makeClock();
    const coalescer = new NativeStdoutCoalescer(
      (surfaceId, data) => sent.push({ surfaceId, data }),
      12,
      1024,
      clock.now,
    );

    coalescer.push("surface:1", "a");
    await Promise.resolve();
    sent.length = 0;

    // surface:1 is now busy, but surface:2 has never produced anything —
    // it must not inherit surface:1's window.
    clock.advance(2);
    coalescer.push("surface:2", "z");
    await Promise.resolve();
    expect(sent).toEqual([{ surfaceId: "surface:2", data: "z" }]);
  });

  test("forget drops pending data and resets the surface to quiet", async () => {
    const sent: { surfaceId: string; data: string }[] = [];
    const clock = makeClock();
    const coalescer = new NativeStdoutCoalescer(
      (surfaceId, data) => sent.push({ surfaceId, data }),
      12,
      1024,
      clock.now,
    );

    coalescer.push("surface:1", "gone");
    coalescer.forget("surface:1");

    await Bun.sleep(30);
    // Nothing dispatched for a surface that no longer exists.
    expect(sent).toEqual([]);

    // And a recycled id starts fresh: immediate, not timer-batched.
    clock.advance(1);
    coalescer.push("surface:1", "new");
    await Promise.resolve();
    expect(sent).toEqual([{ surfaceId: "surface:1", data: "new" }]);
  });
});
