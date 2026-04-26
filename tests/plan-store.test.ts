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
        { id: "M1", title: "Explore", state: "done" },
        { id: "M2", title: "Code", state: "active" },
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
      { id: "M1", title: "ok", state: "waiting" },
      { id: "M2", title: "second", state: "active" },
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
