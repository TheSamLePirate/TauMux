// Health aggregator tests. The registry is pure state — no
// subprocesses, no DOM — so the suite is hermetic and fast.

import { describe, expect, test } from "bun:test";
import { HealthRegistry } from "../src/bun/health";

describe("HealthRegistry", () => {
  test("snapshot is empty + ok by default", () => {
    const r = new HealthRegistry();
    const snap = r.snapshot();
    expect(snap.ok).toBe(true);
    expect(snap.entries).toEqual([]);
  });

  test("set adds an entry with the configured severity + message", () => {
    const r = new HealthRegistry({ now: () => 1234 });
    r.set("pty", "ok", "1 surface");
    const snap = r.snapshot();
    expect(snap.entries.length).toBe(1);
    expect(snap.entries[0]).toEqual({
      id: "pty",
      severity: "ok",
      message: "1 surface",
      updatedAt: 1234,
    });
    expect(snap.ok).toBe(true);
  });

  test("registration order is preserved across updates", () => {
    const r = new HealthRegistry();
    r.set("a", "ok", "");
    r.set("b", "ok", "");
    r.set("c", "ok", "");
    r.set("a", "degraded", "slow"); // mutate doesn't reorder
    const snap = r.snapshot();
    expect(snap.entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(snap.entries[0]!.severity).toBe("degraded");
  });

  test("idempotent set is a no-op (no subscriber notification)", () => {
    const r = new HealthRegistry();
    r.set("pty", "ok", "1 surface");
    let calls = 0;
    r.subscribe(() => calls++);
    r.set("pty", "ok", "1 surface");
    expect(calls).toBe(0);
    r.set("pty", "ok", "2 surfaces"); // message changed → notify
    expect(calls).toBe(1);
  });

  test("ok flag is false when any entry is degraded", () => {
    const r = new HealthRegistry();
    r.set("pty", "ok", "");
    r.set("telegram", "degraded", "backoff");
    expect(r.snapshot().ok).toBe(false);
  });

  test("ok flag is false when any entry is error", () => {
    const r = new HealthRegistry();
    r.set("pty", "ok", "");
    r.set("socket", "error", "EADDRINUSE");
    expect(r.snapshot().ok).toBe(false);
  });

  test("disabled does NOT count against the ok flag", () => {
    const r = new HealthRegistry();
    r.set("pty", "ok", "");
    r.set("telegram", "disabled", "no token configured");
    expect(r.snapshot().ok).toBe(true);
  });

  test("remove deletes the entry", () => {
    const r = new HealthRegistry();
    r.set("pty", "ok", "");
    r.set("telegram", "ok", "");
    r.remove("telegram");
    expect(r.snapshot().entries.map((e) => e.id)).toEqual(["pty"]);
  });

  test("remove of an unknown id is a no-op", () => {
    const r = new HealthRegistry();
    r.set("pty", "ok", "");
    let calls = 0;
    r.subscribe(() => calls++);
    r.remove("does-not-exist");
    expect(calls).toBe(0);
  });

  test("subscribers receive a snapshot on every change", () => {
    const r = new HealthRegistry();
    const seen: number[] = [];
    r.subscribe((snap) => seen.push(snap.entries.length));
    r.set("a", "ok", "");
    r.set("b", "ok", "");
    r.set("a", "degraded", "x");
    expect(seen).toEqual([1, 2, 2]);
  });

  test("a throwing subscriber doesn't break the registry", () => {
    const r = new HealthRegistry();
    r.subscribe(() => {
      throw new Error("oops");
    });
    let calls = 0;
    r.subscribe(() => calls++);
    r.set("pty", "ok", "");
    // The good subscriber still fired despite the broken one.
    expect(calls).toBe(1);
  });

  test("unsubscribe stops further notifications", () => {
    const r = new HealthRegistry();
    let calls = 0;
    const off = r.subscribe(() => calls++);
    r.set("pty", "ok", "");
    expect(calls).toBe(1);
    off();
    r.set("pty", "degraded", "x");
    expect(calls).toBe(1);
  });
});
