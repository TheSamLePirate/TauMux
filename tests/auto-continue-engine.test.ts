// Plan #09 commit B — AutoContinueEngine tests.
//
// The pure heuristic in `auto-continue.ts` already has its own test
// suite (commit A); this file covers the engine wrapper that adds
// settings, cooldown, runaway detection, dry-run, model fallback,
// and the audit ring.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AutoContinueEngine,
  buildAutoContinuePrompt,
  parseModelResponse,
  shouldEscalate,
  type ModelCaller,
} from "../src/bun/auto-continue-engine";
import type { AutoContinueDecision } from "../src/bun/auto-continue";
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

function plan(
  steps: { id: string; title: string; state: Plan["steps"][number]["state"] }[],
): Plan {
  return {
    workspaceId: "ws-1",
    agentId: "claude:1",
    steps,
    updatedAt: 0,
  };
}

const samplePlan: Plan = plan([
  { id: "M1", title: "Explore", state: "done" },
  { id: "M2", title: "Implement", state: "active" },
  { id: "M3", title: "Test", state: "waiting" },
]);

// ── Engine: heuristic branch ─────────────────────────────────

describe("AutoContinueEngine — engine off", () => {
  test("engine 'off' skips immediately and never calls sendText", async () => {
    const sendText = mock(() => {});
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ engine: "off" }),
      sendText,
    });
    const out = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
      notificationText: "ready",
    });
    expect(out.kind).toBe("skipped");
    expect(sendText).not.toHaveBeenCalled();
  });
});

describe("AutoContinueEngine — heuristic mode", () => {
  test("fires the next plan step instruction with trailing newline", async () => {
    const sendText = mock(() => {});
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      sendText,
    });
    const out = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
      notificationText: "completed M2",
    });
    expect(out.kind).toBe("fired");
    expect(sendText).toHaveBeenCalledTimes(1);
    const [sid, text] = sendText.mock.calls[0]!;
    expect(sid).toBe("s1");
    expect(text).toBe("Continue M2\n");
  });

  test("dryRun logs a decision but never calls sendText", async () => {
    const sendText = mock(() => {});
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ dryRun: true }),
      sendText,
    });
    const out = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(out.kind).toBe("dry-run");
    expect(sendText).not.toHaveBeenCalled();
  });

  test("error in notification waits and skips", async () => {
    const sendText = mock(() => {});
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      sendText,
    });
    const out = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
      notificationText: "failed: tests panic",
    });
    expect(out.kind).toBe("skipped");
    expect(sendText).not.toHaveBeenCalled();
  });

  test("question in surface tail waits and skips", async () => {
    const sendText = mock(() => {});
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      sendText,
    });
    const out = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: ["What should I do next?"],
    });
    expect(out.kind).toBe("skipped");
    expect(sendText).not.toHaveBeenCalled();
  });
});

// ── Cooldown + runaway ───────────────────────────────────────

describe("AutoContinueEngine — cooldown gate", () => {
  let nowMs = 1_000;
  beforeEach(() => {
    nowMs = 1_000;
  });

  test("second fire within cooldown is skipped with remaining ms", async () => {
    const sendText = mock(() => {});
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ cooldownMs: 5_000 }),
      sendText,
      now: () => nowMs,
    });
    const a = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(a.kind).toBe("fired");

    nowMs += 1_000;
    const b = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(b.kind).toBe("skipped");
    expect(b.kind === "skipped" && b.reason).toContain("cooldown");
  });

  test("fires again after the cooldown elapses", async () => {
    const sendText = mock(() => {});
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ cooldownMs: 5_000 }),
      sendText,
      now: () => nowMs,
    });
    await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    nowMs += 6_000;
    const out = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(out.kind).toBe("fired");
    expect(sendText).toHaveBeenCalledTimes(2);
  });
});

describe("AutoContinueEngine — runaway counter", () => {
  test("pauses after maxConsecutive without intervening human input", async () => {
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ maxConsecutive: 3 }),
      sendText: () => {},
    });
    for (let i = 0; i < 3; i++) {
      const o = await engine.dispatch({
        surfaceId: "s1",
        plan: samplePlan,
        surfaceTail: [],
      });
      expect(o.kind).toBe("fired");
    }
    const last = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(last.kind).toBe("skipped");
    expect(last.kind === "skipped" && last.reason).toContain("looped");
  });

  test("notifyHumanInput resets the counter", async () => {
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ maxConsecutive: 2 }),
      sendText: () => {},
    });
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
    engine.notifyHumanInput("s1");
    const out = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(out.kind).toBe("fired");
  });
});

// ── Model + hybrid ───────────────────────────────────────────

describe("AutoContinueEngine — model + hybrid", () => {
  test("'model' mode uses the caller verbatim when it returns a decision", async () => {
    const callModel: ModelCaller = async () => ({
      action: "continue",
      reason: "model says go",
      instruction: "Continue M3",
    });
    const sendText = mock(() => {});
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ engine: "model" }),
      sendText,
      callModel,
    });
    const out = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(out.kind).toBe("fired");
    expect(out.kind === "fired" && out.instruction).toBe("Continue M3\n");
  });

  test("'model' falls back to heuristic when the caller returns null", async () => {
    const callModel: ModelCaller = async () => null;
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ engine: "model" }),
      sendText: () => {},
      callModel,
    });
    const out = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(out.kind).toBe("fired"); // heuristic continued via plan
  });

  test("'hybrid' skips the model when heuristic is confident (error)", async () => {
    const callModel = mock(async () => ({
      action: "continue" as const,
      reason: "model overruled",
    }));
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ engine: "hybrid" }),
      sendText: () => {},
      callModel,
    });
    const out = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: ["error: build failed"],
    });
    expect(out.kind).toBe("skipped");
    expect(callModel).not.toHaveBeenCalled();
  });

  test("'hybrid' escalates when no plan is published", async () => {
    const callModel = mock(async () => ({
      action: "wait" as const,
      reason: "model says wait",
    }));
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ engine: "hybrid" }),
      sendText: () => {},
      callModel,
    });
    await engine.dispatch({
      surfaceId: "s1",
      plan: null,
      surfaceTail: ["thinking..."],
      notificationText: "ready",
    });
    expect(callModel).toHaveBeenCalledTimes(1);
  });
});

// ── shouldEscalate ───────────────────────────────────────────

describe("shouldEscalate", () => {
  function decide(reason: string): AutoContinueDecision {
    return { action: "wait", reason };
  }
  test("continue decisions never escalate", () => {
    expect(
      shouldEscalate({ action: "continue", reason: "ok", instruction: "x" }),
    ).toBe(false);
  });
  test("error reason does not escalate", () => {
    expect(shouldEscalate(decide("Notification mentions an error"))).toBe(
      false,
    );
  });
  test("question reason does not escalate", () => {
    expect(shouldEscalate(decide("Agent asked a question"))).toBe(false);
  });
  test("looped reason does not escalate", () => {
    expect(shouldEscalate(decide("paused — agent looped"))).toBe(false);
  });
  test("'no remaining steps' does not escalate", () => {
    expect(shouldEscalate(decide("Plan has no remaining waiting steps"))).toBe(
      false,
    );
  });
  test("'no plan published' DOES escalate", () => {
    expect(shouldEscalate(decide("No plan published; refusing to nudge"))).toBe(
      true,
    );
  });
});

// ── Prompt + parser ──────────────────────────────────────────

describe("buildAutoContinuePrompt", () => {
  test("includes plan steps with state", () => {
    const text = buildAutoContinuePrompt({
      plan: samplePlan,
      surfaceTail: [],
      settings: settings(),
    });
    expect(text).toContain("[done] M1: Explore");
    expect(text).toContain("[active] M2: Implement");
    expect(text).toContain("[waiting] M3: Test");
  });

  test("captures last 12 surface lines verbatim", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const text = buildAutoContinuePrompt({
      plan: samplePlan,
      surfaceTail: lines,
      settings: settings(),
    });
    expect(text).toContain("> line 20");
    expect(text).toContain("> line 9"); // 12 from end
    expect(text).not.toContain("> line 8");
  });

  test("notes 'no plan published' when null", () => {
    const text = buildAutoContinuePrompt({
      plan: null,
      surfaceTail: [],
      settings: settings(),
    });
    expect(text).toContain("(no plan published)");
  });
});

describe("parseModelResponse", () => {
  test("parses minimal continue", () => {
    const out = parseModelResponse(
      JSON.stringify({ action: "continue", reason: "go" }),
    );
    expect(out).toEqual({ action: "continue", reason: "go" });
  });

  test("preserves instruction when present", () => {
    const out = parseModelResponse(
      JSON.stringify({
        action: "continue",
        reason: "go",
        instruction: "Continue M2",
      }),
    );
    expect(out?.instruction).toBe("Continue M2");
  });

  test("strips leading/trailing markdown fence", () => {
    const text = '```json\n{"action":"wait","reason":"ambiguous"}\n```';
    const out = parseModelResponse(text);
    expect(out).toEqual({ action: "wait", reason: "ambiguous" });
  });

  test("rejects unknown action", () => {
    const out = parseModelResponse(
      JSON.stringify({ action: "explode", reason: "nope" }),
    );
    expect(out).toBeNull();
  });

  test("rejects malformed JSON", () => {
    expect(parseModelResponse("not json")).toBeNull();
    expect(parseModelResponse("")).toBeNull();
  });

  test("clips overlong reasons to 200 chars", () => {
    const huge = "x".repeat(500);
    const out = parseModelResponse(
      JSON.stringify({ action: "wait", reason: huge }),
    );
    expect(out?.reason.length).toBe(200);
  });
});

// ── Audit ring ───────────────────────────────────────────────

describe("AutoContinueEngine — audit ring", () => {
  test("appends one entry per dispatch and preserves outcome", async () => {
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      sendText: () => {},
    });
    await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: ["error: nope"],
    });
    const audit = engine.getAudit();
    expect(audit).toHaveLength(2);
    expect(audit[0]!.outcome).toBe("fired");
    expect(audit[1]!.outcome).toBe("skipped");
  });

  test("subscribers get the snapshot on each dispatch", async () => {
    const subs = mock((_audit: unknown) => {});
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      sendText: () => {},
    });
    engine.subscribeAudit(subs);
    await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(subs).toHaveBeenCalledTimes(1);
  });

  test("audit ring caps at 50 entries", async () => {
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ engine: "off" }),
      sendText: () => {},
    });
    for (let i = 0; i < 60; i++) {
      await engine.dispatch({
        surfaceId: "s1",
        plan: null,
        surfaceTail: [],
      });
    }
    expect(engine.getAudit()).toHaveLength(50);
  });
});

// ── Settings validation defaults ─────────────────────────────

describe("AutoContinueEngine — settings re-read on every dispatch", () => {
  test("flipping engine off mid-stream stops firing", async () => {
    let mode: AutoContinueSettings["engine"] = "heuristic";
    const sendText = mock(() => {});
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ engine: mode }),
      sendText,
    });
    await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(sendText).toHaveBeenCalledTimes(1);
    mode = "off";
    await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(sendText).toHaveBeenCalledTimes(1);
  });
});
