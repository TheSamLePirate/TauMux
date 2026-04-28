// Plan #09 commit C — status-key → PlanStore bridge.
//
// Covers `parsePlanValue` (pure JSON shape detection) and the higher-
// level bridge that decides whether to write into the typed
// PlanStore. Anything outside the contract must pass through silently
// so the regular smart-key renderer keeps working unchanged.

import { describe, expect, test } from "bun:test";
import {
  createPlanStatusBridge,
  parsePlanValue,
} from "../src/bun/plan-status-bridge";
import { PlanStore } from "../src/bun/plan-store";

describe("parsePlanValue", () => {
  test("parses a JSON string array of {id,title,state}", () => {
    const out = parsePlanValue(
      '[{"id":"M1","title":"Explore","state":"done"},{"id":"M2","title":"Implement","state":"active"}]',
    );
    expect(out).not.toBeNull();
    expect(out!.length).toBe(2);
    expect(out![0]).toEqual({ id: "M1", title: "Explore", state: "done" });
    expect(out![1]).toEqual({
      id: "M2",
      title: "Implement",
      state: "active",
    });
  });

  test("accepts a raw array (programmatic caller)", () => {
    const out = parsePlanValue([{ id: "x", title: "X", state: "waiting" }]);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(1);
  });

  test("falls back to 'waiting' for unknown / missing state", () => {
    const out = parsePlanValue('[{"id":"M1","title":"x"}]');
    expect(out).not.toBeNull();
    expect(out![0]?.state).toBe("waiting");
  });

  test("falls back to id for missing title", () => {
    const out = parsePlanValue('[{"id":"M1"}]');
    expect(out![0]?.title).toBe("M1");
  });

  test("rejects non-array, non-string values", () => {
    expect(parsePlanValue(123)).toBeNull();
    expect(parsePlanValue({ id: "M1" })).toBeNull();
    expect(parsePlanValue(null)).toBeNull();
    expect(parsePlanValue(undefined)).toBeNull();
  });

  test("rejects malformed JSON strings", () => {
    expect(parsePlanValue("[not-json")).toBeNull();
    expect(parsePlanValue("hello")).toBeNull();
  });

  test("rejects empty arrays", () => {
    expect(parsePlanValue("[]")).toBeNull();
    expect(parsePlanValue([])).toBeNull();
  });

  test("rejects items missing an id", () => {
    expect(parsePlanValue('[{"title":"x"}]')).toBeNull();
  });
});

describe("createPlanStatusBridge.handle", () => {
  test("writes plan-shaped status into PlanStore.set", () => {
    const plans = new PlanStore();
    const bridge = createPlanStatusBridge({ plans });
    const ok = bridge.handle({
      workspaceId: "ws-1",
      surfaceId: "s1",
      key: "build_plan",
      value: '[{"id":"M1","title":"Build","state":"active"}]',
    });
    expect(ok).toBe(true);
    const list = plans.list();
    expect(list.length).toBe(1);
    expect(list[0]?.workspaceId).toBe("ws-1");
    expect(list[0]?.agentId).toBe("status:s1");
    expect(list[0]?.steps[0]?.title).toBe("Build");
  });

  test("falls back to 'status:<key>' when surfaceId is missing", () => {
    const plans = new PlanStore();
    const bridge = createPlanStatusBridge({ plans });
    bridge.handle({
      workspaceId: "ws-1",
      key: "deploy_plan",
      value: '[{"id":"M1","title":"x","state":"waiting"}]',
    });
    expect(plans.list()[0]?.agentId).toBe("status:deploy_plan");
  });

  test("does nothing when key does not contain 'plan'", () => {
    const plans = new PlanStore();
    const bridge = createPlanStatusBridge({ plans });
    const ok = bridge.handle({
      workspaceId: "ws-1",
      key: "tasks_array",
      value: '[{"id":"M1","title":"x","state":"waiting"}]',
    });
    expect(ok).toBe(false);
    expect(plans.list().length).toBe(0);
  });

  test("does nothing when workspaceId is missing", () => {
    const plans = new PlanStore();
    const bridge = createPlanStatusBridge({ plans });
    const ok = bridge.handle({
      key: "build_plan",
      value: '[{"id":"M1","title":"x","state":"waiting"}]',
    });
    expect(ok).toBe(false);
    expect(plans.list().length).toBe(0);
  });

  test("does nothing when value is not plan-shaped", () => {
    const plans = new PlanStore();
    const bridge = createPlanStatusBridge({ plans });
    const ok = bridge.handle({
      workspaceId: "ws-1",
      key: "build_plan",
      value: "42",
    });
    expect(ok).toBe(false);
  });

  test("re-emitting the same payload is idempotent (PlanStore.set replaces)", () => {
    const plans = new PlanStore();
    const bridge = createPlanStatusBridge({ plans });
    const payload = {
      workspaceId: "ws-1",
      surfaceId: "s1",
      key: "build_plan",
      value: '[{"id":"M1","title":"x","state":"waiting"}]',
    };
    bridge.handle(payload);
    bridge.handle(payload);
    expect(plans.list().length).toBe(1);
  });

  test("matches case-insensitively (Plan / PLAN)", () => {
    const plans = new PlanStore();
    const bridge = createPlanStatusBridge({ plans });
    expect(
      bridge.handle({
        workspaceId: "ws-1",
        key: "Build_Plan",
        value: '[{"id":"M1","title":"x"}]',
      }),
    ).toBe(true);
    expect(
      bridge.handle({
        workspaceId: "ws-1",
        key: "DEPLOY_PLAN",
        value: '[{"id":"M2","title":"y"}]',
      }),
    ).toBe(true);
  });
});
