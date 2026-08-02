/**
 * WS4 — Claude Code task list → plan panel mirror.
 */
import { describe, test, expect } from "bun:test";
import {
  ClaudePlanMirror,
  mirrorAgentId,
  tasksToSteps,
} from "../src/bun/claude-plan-mirror";
import { ClaudeSessionRegistry } from "../src/bun/claude-session-registry";
import { PlanStore } from "../src/bun/plan-store";
import type { ClaudeBridgeEvent, ClaudeTask } from "../src/shared/claude-types";

const T0 = 1_754_000_000_000;

function task(over: Partial<ClaudeTask>): ClaudeTask {
  return { id: "t1", name: "Task", state: "pending", createdAt: T0, ...over };
}

describe("tasksToSteps", () => {
  test("completed → done; first open → active; rest → waiting", () => {
    const steps = tasksToSteps([
      task({ id: "a", name: "A", state: "completed" }),
      task({ id: "b", name: "B" }),
      task({ id: "c", name: "C" }),
    ]);
    expect(steps).toEqual([
      { id: "a", title: "A", state: "done" },
      { id: "b", title: "B", state: "active" },
      { id: "c", title: "C", state: "waiting" },
    ]);
  });

  test("title fallbacks: subject → description clause → task <id>", () => {
    expect(
      tasksToSteps([
        task({
          name: "",
          description: "Capture the payload. Then delete it.",
        }),
      ]),
    ).toEqual([
      {
        id: "t1",
        title: "Capture the payload",
        state: "active",
        description: "Capture the payload. Then delete it.",
      },
    ]);
    expect(tasksToSteps([task({ state: "completed", name: "" })])).toEqual([
      { id: "t1", title: "task t1", state: "done" },
    ]);
    const long = tasksToSteps([task({ name: "x".repeat(120) })]);
    expect(long[0]!.title.length).toBeLessThanOrEqual(80);
  });
});

describe("ClaudePlanMirror", () => {
  function setup(resolve: (s: string) => string | null = () => "ws:1") {
    const registry = new ClaudeSessionRegistry(() => T0);
    const plans = new PlanStore({ now: () => T0 });
    new ClaudePlanMirror({ plans, resolveWorkspaceId: resolve }).attach(
      registry,
    );
    const send = (e: Partial<ClaudeBridgeEvent>) =>
      registry.applyEvent({
        sessionId: "sess-abc-123",
        surfaceId: "surface:1",
        ...e,
      } as ClaudeBridgeEvent);
    return { registry, plans, send };
  }
  const KEY = { workspaceId: "ws:1", agentId: mirrorAgentId("sess-abc-123") };

  test("task events publish a plan under claude:<short-session>", () => {
    const { plans, send } = setup();
    send({ type: "task-created", taskId: "t1", taskName: "Write tests" });
    send({ type: "task-created", taskId: "t2", taskName: "Run them" });
    const plan = plans.get(KEY);
    expect(plan).not.toBeNull();
    expect(plan!.steps.map((s) => [s.id, s.state])).toEqual([
      ["t1", "active"],
      ["t2", "waiting"],
    ]);
    send({ type: "task-completed", taskId: "t1" });
    expect(plans.get(KEY)!.steps.map((s) => s.state)).toEqual([
      "done",
      "active",
    ]);
  });

  test("no-op registry emissions do not republish", () => {
    const { plans, send, registry } = setup();
    send({ type: "task-created", taskId: "t1", taskName: "A" });
    const before = plans.get(KEY)!.updatedAt;
    let sets = 0;
    plans.subscribe(() => {
      sets += 1;
    });
    // Statusline tee changes cost only — tasks unchanged.
    registry.applyStatusline({ sessionId: "sess-abc-123", costUsd: 0.5 });
    send({ type: "notify-idle" });
    expect(sets).toBe(0);
    expect(plans.get(KEY)!.updatedAt).toBe(before);
  });

  test("session end clears the mirrored plan", () => {
    const { plans, send } = setup();
    send({ type: "task-created", taskId: "t1", taskName: "A" });
    expect(plans.get(KEY)).not.toBeNull();
    send({ type: "session-end" });
    expect(plans.get(KEY)).toBeNull();
  });

  test("unresolvable workspace → nothing published, nothing thrown", () => {
    const { plans, send } = setup(() => null);
    send({ type: "task-created", taskId: "t1", taskName: "A" });
    expect(plans.list()).toEqual([]);
  });

  test("workspace move retracts the old panel entry", () => {
    let ws = "ws:1";
    const { plans, send } = setup(() => ws);
    send({ type: "task-created", taskId: "t1", taskName: "A" });
    expect(plans.get(KEY)).not.toBeNull();
    ws = "ws:2";
    send({ type: "task-created", taskId: "t2", taskName: "B" });
    expect(plans.get(KEY)).toBeNull();
    expect(
      plans.get({ workspaceId: "ws:2", agentId: KEY.agentId })!.steps,
    ).toHaveLength(2);
  });

  test("does not clobber other producers' plans (distinct agentId)", () => {
    const { plans, send } = setup();
    plans.set({ workspaceId: "ws:1", agentId: "pi:1" }, [
      { id: "M1", title: "pi step", state: "active" },
    ]);
    send({ type: "task-created", taskId: "t1", taskName: "A" });
    expect(plans.list()).toHaveLength(2);
    expect(
      plans.get({ workspaceId: "ws:1", agentId: "pi:1" })!.steps[0]!.title,
    ).toBe("pi step");
  });
});
