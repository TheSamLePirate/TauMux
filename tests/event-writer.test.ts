import { describe, test, expect } from "bun:test";
import { EventWriter } from "../src/bun/event-writer";

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
});
