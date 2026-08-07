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

// ── H8 / 10.2 — cheap gates run before the paid model call ───

describe("AutoContinueEngine — gates short-circuit before the model (H8)", () => {
  let nowMs = 1_000;
  beforeEach(() => {
    nowMs = 1_000;
  });

  test("cooldown gate skips WITHOUT consulting the model", async () => {
    const callModel = mock(async () => ({
      action: "continue" as const,
      reason: "model says go",
    }));
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ engine: "model", cooldownMs: 5_000 }),
      sendText: () => {},
      callModel,
      now: () => nowMs,
    });
    // First dispatch fires (and consults the model once).
    await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(callModel).toHaveBeenCalledTimes(1);
    // Second dispatch is inside the cooldown window — must skip with
    // NO additional billed round-trip.
    nowMs += 1_000;
    const out = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(out.kind).toBe("skipped");
    expect(out.kind === "skipped" && out.reason).toContain("cooldown");
    expect(callModel).toHaveBeenCalledTimes(1);
    // The cooldown audit must not claim the model was consulted.
    const last = engine.getAudit().at(-1)!;
    expect(last.modelConsulted).toBe(false);
  });

  test("runaway gate skips WITHOUT consulting the model", async () => {
    const callModel = mock(async () => ({
      action: "continue" as const,
      reason: "model says go",
    }));
    const engine = new AutoContinueEngine({
      getSettings: () =>
        settings({ engine: "model", maxConsecutive: 2, cooldownMs: 0 }),
      sendText: () => {},
      callModel,
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
    expect(callModel).toHaveBeenCalledTimes(2);
    // Third dispatch trips the runaway gate — looped surfaces are the
    // headline cost runaway; the model must not be called again.
    const out = await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    });
    expect(out.kind).toBe("skipped");
    expect(out.kind === "skipped" && out.reason).toContain("looped");
    expect(callModel).toHaveBeenCalledTimes(2);
  });
});

describe("AutoContinueEngine — runaway audit de-dupe (10.2)", () => {
  test("emits the looped audit once per episode, then suppresses repeats", async () => {
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ maxConsecutive: 2 }),
      sendText: () => {},
    });
    // 2 fires + 3 looped dispatches.
    for (let i = 0; i < 2; i++) {
      await engine.dispatch({
        surfaceId: "s1",
        plan: samplePlan,
        surfaceTail: [],
      });
    }
    for (let i = 0; i < 3; i++) {
      const out = await engine.dispatch({
        surfaceId: "s1",
        plan: samplePlan,
        surfaceTail: [],
      });
      expect(out.kind).toBe("skipped");
      expect(out.kind === "skipped" && out.reason).toContain("looped");
    }
    // Only ONE looped audit entry despite three looped dispatches.
    const looped = engine.getAudit().filter((e) => e.reason.includes("looped"));
    expect(looped).toHaveLength(1);
  });

  test("a human intervention re-arms the looped warning", async () => {
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ maxConsecutive: 1 }),
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
    }); // loop #1 (audited)
    engine.notifyHumanInput("s1"); // resets consecutive + loopWarned
    await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    }); // fires again
    await engine.dispatch({
      surfaceId: "s1",
      plan: samplePlan,
      surfaceTail: [],
    }); // loop #2 (audited again)
    const looped = engine.getAudit().filter((e) => e.reason.includes("looped"));
    expect(looped).toHaveLength(2);
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

describe("AutoContinueEngine — forgetSurface (W2b)", () => {
  test("drops a surface's paused flag + per-surface state, notifying once", () => {
    const changes: string[][] = [];
    const engine = new AutoContinueEngine({
      getSettings: () => settings(),
      sendText: () => {},
      onPausedChange: (ids) => changes.push(ids),
    });
    engine.pause("s1");
    engine.pause("s2");
    expect(engine.isPaused("s1")).toBe(true);
    const before = changes.length;

    engine.forgetSurface("s1");
    expect(engine.isPaused("s1")).toBe(false);
    expect(engine.isPaused("s2")).toBe(true);
    expect(changes.length).toBe(before + 1); // dropped paused id → notified

    // Forgetting an unpaused / unknown surface must NOT notify (no churn of
    // the paused-surfaces persister).
    const after = changes.length;
    engine.forgetSurface("never-seen");
    expect(changes.length).toBe(after);
  });
});

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
    // Distinct surfaces on purpose: consecutive *identical* skips now
    // collapse into one counted row (see the de-dupe describe below), so
    // 60 dispatches at the same surface would legitimately produce 1
    // entry. The cap governs distinct rows, which is what this pins.
    for (let i = 0; i < 60; i++) {
      await engine.dispatch({
        surfaceId: `s${i}`,
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

describe("AutoContinueEngine — consecutive identical skips collapse", () => {
  test("five no-plan skips render as ONE row carrying a count", async () => {
    // Reported by the user: the panel showed five identical
    // "No plan published; refusing to nudge agent without anchor."
    // rows — every Claude Code turn-end runs the engine, so a workspace
    // with no plan floods the ring and pushes real decisions out of it.
    const engine = new AutoContinueEngine({
      getSettings: () => settings({}),
      sendText: () => {},
    });
    for (let i = 0; i < 5; i++) {
      const out = await engine.dispatch({
        surfaceId: "s1",
        plan: null,
        surfaceTail: [],
      });
      expect(out.kind).toBe("skipped");
    }
    const audit = engine.getAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.repeated).toBe(5);
    expect(audit[0]!.reason).toContain("No plan published");
  });

  test("a different surface, reason, or a non-skip gets its own row", async () => {
    const engine = new AutoContinueEngine({
      getSettings: () => settings({}),
      sendText: () => {},
    });
    await engine.dispatch({ surfaceId: "s1", plan: null, surfaceTail: [] });
    await engine.dispatch({ surfaceId: "s2", plan: null, surfaceTail: [] });
    await engine.dispatch({ surfaceId: "s1", plan: null, surfaceTail: [] });
    // Same reason, but the surface alternated — three distinct rows.
    expect(engine.getAudit()).toHaveLength(3);
    for (const e of engine.getAudit()) expect(e.repeated ?? 1).toBe(1);
  });

  test("real continues are never collapsed", async () => {
    const engine = new AutoContinueEngine({
      getSettings: () => settings({ maxConsecutive: 10 }),
      sendText: () => {},
    });
    for (let i = 0; i < 3; i++) {
      await engine.dispatch({
        surfaceId: "s1",
        plan: samplePlan,
        surfaceTail: [],
      });
    }
    const fired = engine.getAudit().filter((e) => e.outcome !== "skipped");
    expect(fired.length).toBeGreaterThanOrEqual(2);
  });
});
