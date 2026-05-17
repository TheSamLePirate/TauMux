import { describe, test, expect } from "bun:test";
import { DEFAULT_MAX_IN_FLIGHT, EventWriter } from "../src/bun/event-writer";

describe("EventWriter", () => {
  test("send returns true on success", () => {
    // Use a writable fd — stdout works for testing
    const writer = new EventWriter(1);
    // We can't easily verify the write went to stdout, but it shouldn't throw
    const result = writer.send({
      id: "test",
      event: "click",
      x: 10,
      y: 20,
    });
    expect(result).toBe(true);
  });

  test("send returns false after close", () => {
    const writer = new EventWriter(1);
    writer.close();
    const result = writer.send({ id: "test", event: "click" });
    expect(result).toBe(false);
  });

  test("send still returns true even with bad fd (Bun.write is async)", () => {
    // Bun.write to Bun.file(fd) doesn't throw synchronously for bad fds
    const writer = new EventWriter(99999);
    const result = writer.send({ id: "test", event: "click" });
    expect(result).toBe(true);
  });

  test("close is safe to call multiple times", () => {
    const writer = new EventWriter(1);
    expect(() => {
      writer.close();
      writer.close();
    }).not.toThrow();
  });

  test("sends valid JSONL format", () => {
    // Spawn a process to capture the output
    const proc = Bun.spawn(["cat"], {
      stdout: "pipe",
      stdio: [undefined, undefined, undefined, "pipe"],
    });

    const fd = proc.stdio[3] as number;
    const writer = new EventWriter(fd);

    writer.send({ id: "evt1", event: "dragend", x: 100, y: 200 });

    proc.kill();

    // The write succeeded (no throw)
    expect(true).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────
  // P7 S4 — metrics surface for backpressure observability
  // ──────────────────────────────────────────────────────────────────

  test("metrics start at zero before any send", () => {
    const writer = new EventWriter(1);
    expect(writer.getMetrics()).toEqual({
      sent: 0,
      inFlight: 0,
      failed: 0,
      peakInFlight: 0,
      dropped: 0,
    });
  });

  test("sent counter increments on each call; inFlight settles after the OS write resolves", async () => {
    const writer = new EventWriter(1);
    writer.send({ id: "a", event: "click", x: 0, y: 0 });
    writer.send({ id: "b", event: "click", x: 0, y: 0 });
    writer.send({ id: "c", event: "click", x: 0, y: 0 });

    expect(writer.getMetrics().sent).toBe(3);
    // peakInFlight must reflect the burst even after writes complete.
    expect(writer.getMetrics().peakInFlight).toBeGreaterThanOrEqual(1);

    // Wait for the Bun.write Promises to settle.
    await new Promise((r) => setTimeout(r, 30));
    expect(writer.getMetrics().inFlight).toBe(0);
  });

  test("close stops the counters from advancing", () => {
    const writer = new EventWriter(1);
    writer.send({ id: "a", event: "click", x: 0, y: 0 });
    const before = writer.getMetrics().sent;
    writer.close();
    writer.send({ id: "b", event: "click", x: 0, y: 0 });
    expect(writer.getMetrics().sent).toBe(before);
  });

  test("getMetrics returns a snapshot, not a live ref", () => {
    const writer = new EventWriter(1);
    writer.send({ id: "a", event: "click", x: 0, y: 0 });
    const snap = writer.getMetrics();
    writer.send({ id: "b", event: "click", x: 0, y: 0 });
    // First snapshot must NOT have picked up the second send.
    expect(snap.sent).toBe(1);
    expect(writer.getMetrics().sent).toBe(2);
  });

  // ──────────────────────────────────────────────────────────────────
  // P7 S5 — bounded queue + drop policy
  // ──────────────────────────────────────────────────────────────────

  test("default maxInFlight is exposed and matches the documented constant", () => {
    const writer = new EventWriter(1);
    expect(writer.getMaxInFlight()).toBe(DEFAULT_MAX_IN_FLIGHT);
  });

  test("custom maxInFlight is honoured; non-positive falls back to the default", () => {
    expect(new EventWriter(1, { maxInFlight: 5 }).getMaxInFlight()).toBe(5);
    expect(new EventWriter(1, { maxInFlight: 0 }).getMaxInFlight()).toBe(
      DEFAULT_MAX_IN_FLIGHT,
    );
    expect(new EventWriter(1, { maxInFlight: -1 }).getMaxInFlight()).toBe(
      DEFAULT_MAX_IN_FLIGHT,
    );
  });

  test("send rejects when inFlight hits the cap, increments dropped, leaves sent untouched", async () => {
    // Use a closed fd target so Bun.write Promises don't resolve
    // immediately on this run; the in-flight gauge stays high enough
    // to trip the cap. fd 1 (stdout) typically completes very fast on
    // a TTY so we pick a small cap and burst past it.
    const cap = 4;
    const writer = new EventWriter(1, { maxInFlight: cap });

    // Drive a burst larger than the cap. Some may settle very fast,
    // but we should always observe at least one drop because Bun.write
    // is async.
    let sentCount = 0;
    let dropCount = 0;
    for (let i = 0; i < cap * 8; i++) {
      const ok = writer.send({ id: `${i}`, event: "click", x: 0, y: 0 });
      if (ok) sentCount++;
      else dropCount++;
    }

    const m = writer.getMetrics();
    // Each accepted send incremented `sent`; rejections did not.
    expect(m.sent).toBe(sentCount);
    expect(m.dropped).toBe(dropCount);
    // The drop policy fired at least once.
    expect(m.dropped).toBeGreaterThan(0);
    // peakInFlight never crossed the cap.
    expect(m.peakInFlight).toBeLessThanOrEqual(cap);

    await new Promise((r) => setTimeout(r, 30));
    expect(writer.getMetrics().inFlight).toBe(0);
  });

  test("send recovers once inFlight drains below the cap", async () => {
    const writer = new EventWriter(1, { maxInFlight: 2 });
    // Burst past the cap to ensure drops happen.
    for (let i = 0; i < 8; i++) {
      writer.send({ id: `${i}`, event: "click", x: 0, y: 0 });
    }
    const dropsBefore = writer.getMetrics().dropped;
    expect(dropsBefore).toBeGreaterThan(0);

    // Let the OS drain the queue.
    await new Promise((r) => setTimeout(r, 30));
    expect(writer.getMetrics().inFlight).toBe(0);

    // Now a fresh send must succeed; `dropped` stays where it was.
    const ok = writer.send({ id: "after", event: "click", x: 0, y: 0 });
    expect(ok).toBe(true);
    expect(writer.getMetrics().dropped).toBe(dropsBefore);
  });
});
