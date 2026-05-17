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

  // ────────────────────────────────────────────────────────────────
  // Phase 7 — remediation fix()
  // ────────────────────────────────────────────────────────────────

  test("entries without a fix have no fixLabel in the snapshot", () => {
    const r = new HealthRegistry();
    r.set("pty", "ok", "running");
    const snap = r.snapshot();
    expect(snap.entries[0].fixLabel).toBeUndefined();
  });

  test("a fix attached at set() surfaces as fixLabel on the snapshot", () => {
    const r = new HealthRegistry();
    r.set("telegram", "degraded", "polling stopped", {
      label: "Restart polling",
      action: async () => {},
    });
    const snap = r.snapshot();
    expect(snap.entries[0].fixLabel).toBe("Restart polling");
  });

  test("runFix(id) invokes the attached action and returns the post-fix snapshot", async () => {
    const r = new HealthRegistry();
    let actionCalls = 0;
    r.set("telegram", "error", "auth failed", {
      label: "Re-auth",
      action: async () => {
        actionCalls++;
        // Subsystem pushes a fresh state from inside the action.
        r.set("telegram", "ok", "polling");
      },
    });
    const snap = await r.runFix("telegram");
    expect(actionCalls).toBe(1);
    expect(snap.entries[0].severity).toBe("ok");
    expect(snap.entries[0].fixLabel).toBeUndefined();
    expect(snap.ok).toBe(true);
  });

  test("runFix throws when the id doesn't exist", async () => {
    const r = new HealthRegistry();
    await expect(r.runFix("nope")).rejects.toThrow(/no entry for id/);
  });

  test("runFix throws when the entry has no fix attached", async () => {
    const r = new HealthRegistry();
    r.set("pty", "degraded", "slow");
    await expect(r.runFix("pty")).rejects.toThrow(/has no fix attached/);
  });

  test("set() is still idempotent when fix labels match", () => {
    const r = new HealthRegistry();
    let calls = 0;
    r.subscribe(() => calls++);
    const fix = { label: "Restart", action: async () => {} };
    r.set("telegram", "degraded", "x", fix);
    r.set("telegram", "degraded", "x", { ...fix });
    expect(calls).toBe(1);
  });

  test("set() fires a notification when the fix label changes", () => {
    const r = new HealthRegistry();
    let calls = 0;
    r.subscribe(() => calls++);
    r.set("telegram", "degraded", "x", {
      label: "Restart",
      action: async () => {},
    });
    r.set("telegram", "degraded", "x", {
      label: "Re-auth",
      action: async () => {},
    });
    expect(calls).toBe(2);
  });

  test("action errors propagate so the caller sees them", async () => {
    const r = new HealthRegistry();
    r.set("telegram", "error", "x", {
      label: "Try",
      action: async () => {
        throw new Error("backend down");
      },
    });
    await expect(r.runFix("telegram")).rejects.toThrow(/backend down/);
    expect(r.snapshot().entries[0].severity).toBe("error");
  });
});
