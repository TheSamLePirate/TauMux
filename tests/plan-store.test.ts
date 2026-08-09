// Pure-data coverage for the Plan #09 PlanStore.

import { describe, expect, test } from "bun:test";
import { PlanStore } from "../src/bun/plan-store";

describe("PlanStore", () => {
  test("set then list returns the registered plan", () => {
    const store = new PlanStore({ now: () => 100 });
    store.set({ workspaceId: "ws:1", agentId: "claude:1" }, [
      { id: "M1", title: "Explore", state: "done" },
      { id: "M2", title: "Code", state: "active" },
    ]);
    const plans = store.list();
    expect(plans.length).toBe(1);
    expect(plans[0]).toEqual({
      workspaceId: "ws:1",
      agentId: "claude:1",
      updatedAt: 100,
      steps: [
        // Stamped on the transition out of `waiting`; a step that
        // arrives already `done` gets the same start and end, which
        // draws a tick on CHRONO's axis rather than a lie about
        // duration.
        { id: "M1", title: "Explore", state: "done", startedAt: 100, endedAt: 100 },
        { id: "M2", title: "Code", state: "active", startedAt: 100 },
      ],
    });
  });

  test("set normalises bad step states to waiting and skips empty ids", () => {
    const store = new PlanStore({ now: () => 0 });
    store.set({ workspaceId: "ws:1" }, [
      // unknown state coerced to waiting
      // @ts-expect-error — testing runtime fallback
      { id: "M1", title: "ok", state: "garbage" },
      // empty id dropped
      { id: "", title: "skip", state: "active" } as never,
      // duplicate id — last wins
      { id: "M2", title: "first", state: "waiting" },
      { id: "M2", title: "second", state: "active" },
    ]);
    const plan = store.get({ workspaceId: "ws:1" });
    expect(plan!.steps).toEqual([
      // `waiting` carries no stamps at all — a step that has not started
      // has no history to claim.
      { id: "M1", title: "ok", state: "waiting" },
      { id: "M2", title: "second", state: "active", startedAt: 0 },
    ]);
  });

  test("set trims whitespace in titles", () => {
    const store = new PlanStore({ now: () => 0 });
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "  hello  ", state: "active" },
    ]);
    expect(store.get({ workspaceId: "ws:1" })!.steps[0]!.title).toBe("hello");
  });

  test("update mutates a single step in place", () => {
    const store = new PlanStore({ now: () => 0 });
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "Explore", state: "done" },
      { id: "M2", title: "Code", state: "active" },
      { id: "M3", title: "Test", state: "waiting" },
    ]);
    const after = store.update({ workspaceId: "ws:1" }, "M2", {
      state: "done",
    });
    expect(after).not.toBeNull();
    expect(after!.steps[1]!.state).toBe("done");
    // Other steps untouched.
    expect(after!.steps[0]!.state).toBe("done");
    expect(after!.steps[2]!.state).toBe("waiting");
  });

  test("update can change just the title", () => {
    const store = new PlanStore({ now: () => 0 });
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "old", state: "active" },
    ]);
    const after = store.update({ workspaceId: "ws:1" }, "M1", {
      title: "  new title  ",
    });
    expect(after!.steps[0]!.title).toBe("new title");
    expect(after!.steps[0]!.state).toBe("active");
  });

  test("update returns null when the plan doesn't exist", () => {
    const store = new PlanStore({ now: () => 0 });
    expect(
      store.update({ workspaceId: "ws:none" }, "M1", { state: "done" }),
    ).toBeNull();
  });

  test("update returns null when the step id doesn't match", () => {
    const store = new PlanStore({ now: () => 0 });
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "x", state: "waiting" },
    ]);
    expect(
      store.update({ workspaceId: "ws:1" }, "ghost", { state: "done" }),
    ).toBeNull();
  });

  test("complete marks every step as done", () => {
    const store = new PlanStore({ now: () => 5 });
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "x", state: "active" },
      { id: "M2", title: "y", state: "waiting" },
      { id: "M3", title: "z", state: "err" },
    ]);
    const after = store.complete({ workspaceId: "ws:1" });
    expect(after!.steps.every((s) => s.state === "done")).toBe(true);
    expect(after!.updatedAt).toBe(5);
  });

  test("complete returns null when no plan is registered", () => {
    const store = new PlanStore({ now: () => 0 });
    expect(store.complete({ workspaceId: "ws:none" })).toBeNull();
  });

  test("clear removes the plan and is idempotent", () => {
    const store = new PlanStore({ now: () => 0 });
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "x", state: "active" },
    ]);
    expect(store.clear({ workspaceId: "ws:1" })).toBe(true);
    expect(store.list()).toEqual([]);
    expect(store.clear({ workspaceId: "ws:1" })).toBe(false);
  });

  test("workspace-level vs agent-scoped plans are independent rows", () => {
    const store = new PlanStore({ now: () => 0 });
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "ws", state: "active" },
    ]);
    store.set({ workspaceId: "ws:1", agentId: "claude:1" }, [
      { id: "M1", title: "claude", state: "active" },
    ]);
    expect(store.list().length).toBe(2);
    expect(store.get({ workspaceId: "ws:1" })!.steps[0]!.title).toBe("ws");
    expect(
      store.get({ workspaceId: "ws:1", agentId: "claude:1" })!.steps[0]!.title,
    ).toBe("claude");
  });

  test("subscribers are notified on every mutation", () => {
    const store = new PlanStore({ now: () => 0 });
    const seen: number[] = [];
    store.subscribe((plans) => seen.push(plans.length));
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "x", state: "active" },
    ]);
    store.update({ workspaceId: "ws:1" }, "M1", { state: "done" });
    store.complete({ workspaceId: "ws:1" });
    store.clear({ workspaceId: "ws:1" });
    // 4 events — all 1 plan deep until clear → 0.
    expect(seen).toEqual([1, 1, 1, 0]);
  });

  test("a throwing subscriber doesn't break the store", () => {
    const store = new PlanStore({ now: () => 0 });
    store.subscribe(() => {
      throw new Error("oops");
    });
    let calls = 0;
    store.subscribe(() => calls++);
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "x", state: "active" },
    ]);
    expect(calls).toBe(1);
  });

  test("unsubscribe stops further notifications", () => {
    const store = new PlanStore({ now: () => 0 });
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "x", state: "active" },
    ]);
    expect(calls).toBe(1);
    off();
    store.update({ workspaceId: "ws:1" }, "M1", { state: "done" });
    expect(calls).toBe(1);
  });

  test("clear of a non-existent key does not notify subscribers", () => {
    const store = new PlanStore({ now: () => 0 });
    let calls = 0;
    store.subscribe(() => calls++);
    expect(store.clear({ workspaceId: "ws:none" })).toBe(false);
    expect(calls).toBe(0);
  });
});

describe("update() field preservation", () => {
  test("a state-only patch keeps the step's description", () => {
    const store = new PlanStore({ now: () => 1 });
    store.set(
      { workspaceId: "ws-1", agentId: "claude:1" },
      [{ id: "M1", title: "Explore", state: "active", description: "why" }],
    );
    const next = store.update(
      { workspaceId: "ws-1", agentId: "claude:1" },
      "M1",
      { state: "done" },
    );
    // `ht plan update --state done` used to silently delete the
    // description, blanking the panel's detail row for that step.
    expect(next!.steps[0]!.description).toBe("why");
    expect(next!.steps[0]!.state).toBe("done");
  });

  test("a title patch keeps it too", () => {
    const store = new PlanStore({ now: () => 1 });
    store.set({ workspaceId: "ws-1" }, [
      { id: "M1", title: "Explore", state: "active", description: "why" },
    ]);
    const next = store.update({ workspaceId: "ws-1" }, "M1", {
      title: "Explore more",
    });
    expect(next!.steps[0]!.description).toBe("why");
    expect(next!.steps[0]!.title).toBe("Explore more");
  });
});

describe("PlanStep timestamps", () => {
  test("a re-publish preserves a step's history", () => {
    // THE one that matters. Agents call `ht plan set` with the whole
    // list on every change, so re-deriving stamps would reset a plan's
    // entire history every time one box was ticked.
    let clock = 1_000;
    const store = new PlanStore({ now: () => clock });
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "Explore", state: "active" },
      { id: "M2", title: "Code", state: "waiting" },
    ]);

    clock = 9_000;
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "Explore", state: "done" },
      { id: "M2", title: "Code", state: "active" },
    ]);

    const steps = store.get({ workspaceId: "ws:1" })!.steps;
    expect(steps[0]).toMatchObject({ startedAt: 1_000, endedAt: 9_000 });
    expect(steps[1]).toMatchObject({ startedAt: 9_000 });
    expect(steps[1]!.endedAt).toBeUndefined();
  });

  test("a supplied timestamp beats the store's clock", () => {
    // Claude's task list knows when it created and completed each task;
    // τ-mux only knows when it next looked.
    const store = new PlanStore({ now: () => 5_000 });
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "Explore", state: "done", startedAt: 10, endedAt: 20 },
    ]);
    expect(store.get({ workspaceId: "ws:1" })!.steps[0]).toMatchObject({
      startedAt: 10,
      endedAt: 20,
    });
  });

  test("waiting carries no stamps at all", () => {
    // A step reset to waiting has no history left to claim, and a
    // startedAt on it would draw a bar for work nobody did.
    let clock = 1_000;
    const store = new PlanStore({ now: () => clock });
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "Explore", state: "done" },
    ]);
    clock = 2_000;
    store.update({ workspaceId: "ws:1" }, "M1", { state: "waiting" });

    const step = store.get({ workspaceId: "ws:1" })!.steps[0]!;
    expect(step.startedAt).toBeUndefined();
    expect(step.endedAt).toBeUndefined();
  });

  test("re-opening a finished step clears its end", () => {
    let clock = 1_000;
    const store = new PlanStore({ now: () => clock });
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "Explore", state: "done" },
    ]);
    clock = 2_000;
    store.update({ workspaceId: "ws:1" }, "M1", { state: "active" });

    const step = store.get({ workspaceId: "ws:1" })!.steps[0]!;
    expect(step.startedAt).toBe(1_000);
    expect(step.endedAt).toBeUndefined();
  });

  test("a step that jumps straight to done is a tick, not a duration", () => {
    const store = new PlanStore({ now: () => 7_000 });
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "Explore", state: "done" },
    ]);
    const step = store.get({ workspaceId: "ws:1" })!.steps[0]!;
    expect(step.startedAt).toBe(7_000);
    expect(step.endedAt).toBe(7_000);
  });

  test("complete() stamps an end without moving the starts", () => {
    let clock = 1_000;
    const store = new PlanStore({ now: () => clock });
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "Explore", state: "active" },
      { id: "M2", title: "Code", state: "waiting" },
    ]);
    clock = 4_000;
    store.complete({ workspaceId: "ws:1" });

    const steps = store.get({ workspaceId: "ws:1" })!.steps;
    expect(steps[0]).toMatchObject({ startedAt: 1_000, endedAt: 4_000 });
    // M2 never ran; completing the plan starts and ends it in one moment.
    expect(steps[1]).toMatchObject({ startedAt: 4_000, endedAt: 4_000 });
  });

  test("a step added to an existing plan starts when it appears", () => {
    let clock = 1_000;
    const store = new PlanStore({ now: () => clock });
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "Explore", state: "active" },
    ]);
    clock = 6_000;
    store.set({ workspaceId: "ws:1" }, [
      { id: "M1", title: "Explore", state: "active" },
      { id: "M2", title: "New", state: "active" },
    ]);
    const steps = store.get({ workspaceId: "ws:1" })!.steps;
    expect(steps[0]!.startedAt).toBe(1_000);
    expect(steps[1]!.startedAt).toBe(6_000);
  });
});
