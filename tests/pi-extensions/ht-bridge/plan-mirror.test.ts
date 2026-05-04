/**
 * plan-mirror — `findPlanInText` parser tests.
 *
 * The detector intentionally accepts loose shapes (title aliases,
 * state-name aliases) so models that emit todos in different styles
 * still register. These tests pin the contract.
 */

import { describe, expect, test } from "bun:test";
import { findPlanInText } from "../../../pi-extensions/ht-bridge/observe/plan-mirror";

describe("findPlanInText", () => {
  test("parses a fenced ```json plan", () => {
    const text =
      'Here\'s the plan:\n\n```json\n[{"id":"M1","title":"Explore","state":"active"}]\n```\n';
    expect(findPlanInText(text)).toEqual([
      { id: "M1", title: "Explore", state: "active" },
    ]);
  });

  test("normalizes state aliases (in_progress, todo, complete, blocked)", () => {
    const text =
      "```json\n[" +
      '{"id":"a","title":"A","state":"in_progress"},' +
      '{"id":"b","title":"B","state":"todo"},' +
      '{"id":"c","title":"C","state":"complete"},' +
      '{"id":"d","title":"D","state":"blocked"}' +
      "]\n```";
    const plan = findPlanInText(text);
    expect(plan?.map((s) => s.state)).toEqual([
      "active",
      "waiting",
      "done",
      "err",
    ]);
  });

  test("falls back to label/description/name when title is absent", () => {
    const text =
      '```json\n[{"id":"x","label":"Implement"},{"description":"Test"},{"name":"Commit"}]\n```';
    const plan = findPlanInText(text);
    expect(plan?.map((s) => s.title)).toEqual(["Implement", "Test", "Commit"]);
  });

  test("synthesizes ids when missing", () => {
    const text = '```json\n[{"title":"A"},{"title":"B"}]\n```';
    const plan = findPlanInText(text);
    expect(plan?.map((s) => s.id)).toEqual(["step-0", "step-1"]);
  });

  test("returns null when no fenced block parses as a plan", () => {
    expect(findPlanInText("just prose, no plans here")).toBeNull();
    expect(findPlanInText('```json\n{"not":"an array"}\n```')).toBeNull();
    expect(findPlanInText("```json\n[1,2,3]\n```")).toBeNull();
    expect(findPlanInText('```json\n[{"no_title":1}]\n```')).toBeNull();
  });

  test("picks the LAST fenced plan when multiple are present", () => {
    const text =
      '```json\n[{"id":"old","title":"Old"}]\n```\n' +
      "and later\n" +
      '```json\n[{"id":"new","title":"New","state":"done"}]\n```';
    const plan = findPlanInText(text);
    expect(plan).toEqual([{ id: "new", title: "New", state: "done" }]);
  });

  test("defaults state to waiting when missing", () => {
    const text = '```json\n[{"id":"a","title":"A"}]\n```';
    expect(findPlanInText(text)?.[0]?.state).toBe("waiting");
  });

  test("returns null on empty array", () => {
    expect(findPlanInText("```json\n[]\n```")).toBeNull();
  });
});
