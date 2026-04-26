// Plan #09 §B — pure-function coverage for the auto-continue
// heuristic. Decision tree is small + ordered, so this is genuinely
// table-driven.

import { describe, expect, test } from "bun:test";
import { decideAutoContinue } from "../src/bun/auto-continue";
import type { Plan } from "../src/shared/types";

function plan(...states: ("done" | "active" | "waiting" | "err")[]): Plan {
  return {
    workspaceId: "ws:1",
    steps: states.map((s, i) => ({
      id: `M${i + 1}`,
      title: `step ${i + 1}`,
      state: s,
    })),
    updatedAt: 0,
  };
}

describe("decideAutoContinue", () => {
  test("waits when notification mentions an error", () => {
    const out = decideAutoContinue({
      plan: plan("done", "active"),
      surfaceTail: ["all good"],
      notificationText: "Build failed: TS2304",
    });
    expect(out.action).toBe("wait");
    expect(out.reason.toLowerCase()).toContain("error");
    expect(out.instruction).toBeUndefined();
  });

  test("waits when surface tail mentions an error token", () => {
    const out = decideAutoContinue({
      plan: plan("done", "active"),
      surfaceTail: ["compiling…", "error: TS2345 something"],
    });
    expect(out.action).toBe("wait");
    expect(out.reason.toLowerCase()).toContain("error");
  });

  test("error wins over a pending plan step", () => {
    const out = decideAutoContinue({
      plan: plan("done", "waiting"),
      surfaceTail: [],
      notificationText: "permission denied: cannot write",
    });
    expect(out.action).toBe("wait");
  });

  test("waits when surface tail ends with a question", () => {
    const out = decideAutoContinue({
      plan: plan("done", "active"),
      surfaceTail: ["did the change", "look right?"],
    });
    expect(out.action).toBe("wait");
    expect(out.reason.toLowerCase()).toContain("question");
  });

  test("ignores question marks far back in the tail (only last 5 non-blank lines)", () => {
    const tail = [
      "old question?",
      "",
      "",
      "",
      "",
      "",
      "noise",
      "noise",
      "noise",
      "noise",
      "ready",
    ];
    const out = decideAutoContinue({
      plan: plan("done", "active"),
      surfaceTail: tail,
    });
    expect(out.action).toBe("continue");
  });

  test("continues with the active step's id", () => {
    const out = decideAutoContinue({
      plan: plan("done", "active", "waiting"),
      surfaceTail: ["ready"],
    });
    expect(out.action).toBe("continue");
    expect(out.instruction).toBe("Continue M2");
    expect(out.reason).toContain("M2");
  });

  test("continues with the first waiting step when nothing is active", () => {
    const out = decideAutoContinue({
      plan: plan("done", "done", "waiting", "waiting"),
      surfaceTail: [],
    });
    expect(out.action).toBe("continue");
    expect(out.instruction).toBe("Continue M3");
  });

  test("waits when every step is done", () => {
    const out = decideAutoContinue({
      plan: plan("done", "done"),
      surfaceTail: [],
    });
    expect(out.action).toBe("wait");
    expect(out.reason.toLowerCase()).toContain("no remaining");
  });

  test("waits when only err steps remain", () => {
    const out = decideAutoContinue({
      plan: plan("done", "err"),
      surfaceTail: [],
    });
    expect(out.action).toBe("wait");
  });

  test("waits when there's no plan", () => {
    const out = decideAutoContinue({
      plan: null,
      surfaceTail: ["agent paused"],
    });
    expect(out.action).toBe("wait");
    expect(out.reason.toLowerCase()).toContain("no plan");
  });

  test("waits when the plan is empty", () => {
    const out = decideAutoContinue({
      plan: plan(),
      surfaceTail: [],
    });
    expect(out.action).toBe("wait");
  });

  test("never throws on missing surfaceTail / notification", () => {
    const out = decideAutoContinue({
      plan: plan("active"),
      surfaceTail: [],
    });
    expect(out.action).toBe("continue");
  });

  test("reason text is clipped to a sane length", () => {
    const long = "x".repeat(500);
    const out = decideAutoContinue({
      plan: plan("done", "active"),
      surfaceTail: [],
      notificationText: `error: ${long}`,
    });
    expect(out.action).toBe("wait");
    expect(out.reason.length).toBeLessThan(120);
  });

  test("blank lines between question and tail are skipped over", () => {
    const out = decideAutoContinue({
      plan: plan("done", "active"),
      surfaceTail: ["are you ready?", "", "", ""],
    });
    expect(out.action).toBe("wait");
    expect(out.reason.toLowerCase()).toContain("question");
  });
});
