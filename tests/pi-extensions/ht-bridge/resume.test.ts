/**
 * Resume restoration — `findLastPlanSet` walks session entries
 * newest-to-oldest, finding the most recent ht_plan_set toolResult.
 * The pi-glue (`registerResumeRestoration`) is too tightly coupled
 * to pi's runtime to test directly; the picker is the interesting
 * part.
 */

import { describe, expect, test } from "bun:test";
import { findLastPlanSet } from "../../../pi-extensions/ht-bridge/lifecycle/resume";

const planA = [{ id: "M1", title: "First", state: "active" }];
const planB = [
  { id: "M1", title: "First", state: "done" },
  { id: "M2", title: "Second", state: "active" },
];

function entryToolResult(toolName: string, details: any): any {
  return {
    type: "message",
    message: { role: "toolResult", toolName, details },
  };
}

describe("findLastPlanSet", () => {
  test("returns null on empty session", () => {
    expect(findLastPlanSet([])).toBeNull();
  });

  test("returns null when no ht_plan_set toolResult exists", () => {
    const entries = [
      { type: "message", message: { role: "user", content: "hi" } },
      entryToolResult("read", { path: "foo" }),
    ];
    expect(findLastPlanSet(entries)).toBeNull();
  });

  test("returns the steps from the most recent ht_plan_set", () => {
    const entries = [
      entryToolResult("ht_plan_set", { steps: planA }),
      entryToolResult("read", { path: "foo" }),
      entryToolResult("ht_plan_set", { steps: planB }),
    ];
    expect(findLastPlanSet(entries)).toEqual(planB);
  });

  test("ignores ht_plan_set entries that lack a steps array", () => {
    const entries = [
      entryToolResult("ht_plan_set", { steps: planA }),
      entryToolResult("ht_plan_set", { other: "no steps here" }),
    ];
    expect(findLastPlanSet(entries)).toEqual(planA);
  });

  test("ignores non-message entry types", () => {
    const entries = [
      { type: "summary", summary: "compacted" },
      entryToolResult("ht_plan_set", { steps: planA }),
    ];
    expect(findLastPlanSet(entries)).toEqual(planA);
  });

  test("ignores assistant/user messages even if they contain plan-shaped data", () => {
    const entries = [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "see plan" }],
          toolName: "ht_plan_set",
          details: { steps: planB },
        },
      },
    ];
    // Only `role: "toolResult"` qualifies; assistant messages with a
    // matching toolName don't (they're text replies, not results).
    expect(findLastPlanSet(entries)).toBeNull();
  });

  test("returns null on empty steps array", () => {
    const entries = [entryToolResult("ht_plan_set", { steps: [] })];
    expect(findLastPlanSet(entries)).toBeNull();
  });

  test("ignores declined or discussion-only plan proposals", () => {
    const entries = [
      entryToolResult("ht_plan_set", {
        steps: planA,
        approval: { action: "decline" },
        published: false,
      }),
      entryToolResult("ht_plan_set", {
        steps: planB,
        approval: { action: "discuss", feedback: "revise" },
        published: false,
      }),
    ];
    expect(findLastPlanSet(entries)).toBeNull();
  });

  test("skips declined newer proposals and restores last published plan", () => {
    const entries = [
      entryToolResult("ht_plan_set", {
        steps: planA,
        approval: { action: "accept" },
        published: true,
      }),
      entryToolResult("ht_plan_set", {
        steps: planB,
        approval: { action: "decline" },
        published: false,
      }),
    ];
    expect(findLastPlanSet(entries)).toEqual(planA);
  });
});
