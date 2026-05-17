// Plan #09 commit C — pause / resume / listPaused on AutoContinueEngine.
//
// Sister to `auto-continue-engine.test.ts`; isolated here so the new
// administrative paths (pause / resume) get a focused suite that the
// existing 32-case suite doesn't have to absorb.

import { describe, expect, mock, test } from "bun:test";
import { AutoContinueEngine } from "../src/bun/auto-continue-engine";
import type { AutoContinueSettings } from "../src/shared/settings";
import type { Plan } from "../src/shared/types";

function settings(
  overrides: Partial<AutoContinueSettings> = {},
): AutoContinueSettings {
  return {
    engine: "heuristic",
    dryRun: false,
    cooldownMs: 0,
    maxConsecutive: 5,
    modelProvider: "anthropic",
    modelName: "claude-haiku-4-5-20251001",
    modelApiKeyEnv: "TEST_ANTHROPIC_KEY",
    ...overrides,
  };
}

const samplePlan: Plan = {
  workspaceId: "ws-1",
  agentId: "claude:1",
  steps: [
    { id: "M1", title: "Explore", state: "done" },
    { id: "M2", title: "Implement", state: "active" },
  ],
  updatedAt: 0,
};

describe("AutoContinueEngine — pause / resume", () => {
  test("pause gates dispatch with a 'paused' skip without calling sendText", async () => {
    const sendText = mock(() => {});
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      sendText,
    });
    engine.pause("s1");
    expect(engine.isPaused("s1")).toBe(true);
    expect(engine.listPaused()).toEqual(["s1"]);

    const out = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(out.kind).toBe("skipped");
    expect(out.kind === "skipped" && out.reason).toBe("paused");
    expect(sendText).not.toHaveBeenCalled();
  });

  test("pause is per-surface — other surfaces fire normally", async () => {
    const sendText = mock(() => {});
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      sendText,
    });
    engine.pause("s1");

    const other = await engine.dispatch({
      surfaceId: "s2",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(other.kind).toBe("fired");
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  test("resume clears the pause and lets the next dispatch fire", async () => {
    const sendText = mock(() => {});
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      sendText,
    });
    engine.pause("s1");
    engine.resume("s1");
    expect(engine.isPaused("s1")).toBe(false);
    expect(engine.listPaused()).toEqual([]);

    const out = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(out.kind).toBe("fired");
  });

  test("resume also resets the runaway counter", async () => {
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ maxConsecutive: 2 }),
      sendText: () => {},
    });
    // Two fires hit the runaway cap.
    await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    const looped = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(looped.kind).toBe("skipped");
    expect(looped.kind === "skipped" && looped.reason).toContain("looped");

    // Pause + resume clears the latched runaway state.
    engine.pause("s1");
    engine.resume("s1");
    const after = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(after.kind).toBe("fired");
  });

  test("pause emits a 'paused' audit entry", () => {
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      sendText: () => {},
    });
    engine.pause("s1", "user clicked pause");
    const audit = engine.getAudit();
    expect(audit.length).toBe(1);
    expect(audit[0]?.outcome).toBe("paused");
    expect(audit[0]?.reason).toBe("user clicked pause");
    expect(audit[0]?.surfaceId).toBe("s1");
  });

  test("resume emits a 'resumed' audit entry", () => {
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      sendText: () => {},
    });
    engine.pause("s1");
    engine.resume("s1");
    const audit = engine.getAudit();
    expect(audit.length).toBe(2);
    expect(audit[1]?.outcome).toBe("resumed");
  });

  test("double pause is a no-op (idempotent, no extra audit row)", () => {
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      sendText: () => {},
    });
    engine.pause("s1");
    engine.pause("s1");
    expect(engine.getAudit().length).toBe(1);
    expect(engine.listPaused()).toEqual(["s1"]);
  });

  test("resume on a non-paused surface is a no-op", () => {
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      sendText: () => {},
    });
    engine.resume("s1");
    expect(engine.getAudit().length).toBe(0);
  });

  test("resetAll drops every pause", () => {
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      sendText: () => {},
    });
    engine.pause("s1");
    engine.pause("s2");
    engine.resetAll();
    expect(engine.listPaused()).toEqual([]);
  });

  // ────────────────────────────────────────────────────────────────
  // P7 S6 — onPausedChange hook + hydratePaused
  // ────────────────────────────────────────────────────────────────

  test("onPausedChange fires on pause, resume, and resetAll", () => {
    const calls: string[][] = [];
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      onPausedChange: (ids) => calls.push([...ids]),
    });
    engine.pause("s1");
    engine.pause("s2");
    engine.resume("s1");
    engine.resetAll();
    expect(calls).toEqual([["s1"], ["s1", "s2"], ["s2"], []]);
  });

  test("onPausedChange does NOT fire when pause is a no-op (already paused)", () => {
    const calls: string[][] = [];
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      onPausedChange: (ids) => calls.push([...ids]),
    });
    engine.pause("s1");
    engine.pause("s1"); // no-op
    expect(calls).toEqual([["s1"]]);
  });

  test("onPausedChange does NOT fire when resetAll has nothing to clear", () => {
    const calls: string[][] = [];
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      onPausedChange: (ids) => calls.push([...ids]),
    });
    engine.resetAll();
    expect(calls).toEqual([]);
  });

  test("hydratePaused seeds the set without echoing through onPausedChange", () => {
    const calls: string[][] = [];
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      onPausedChange: (ids) => calls.push([...ids]),
    });
    engine.hydratePaused(["s7", "s8"]);
    expect(engine.listPaused().sort()).toEqual(["s7", "s8"]);
    // Boot-time restore must not re-write what we just read.
    expect(calls).toEqual([]);
  });

  test("hydratePaused does not duplicate ids already in the set", () => {
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
    });
    engine.pause("s1");
    engine.hydratePaused(["s1", "s2"]);
    expect(engine.listPaused().sort()).toEqual(["s1", "s2"]);
  });
});
