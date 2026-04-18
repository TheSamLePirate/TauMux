import { describe, expect, test } from "bun:test";
import { evaluateGate } from "../../src/design-report/gate";
import type { ReportShot, ShotStatus } from "../../src/design-report/types";

function shot(id: string, status: ShotStatus): ReportShot {
  return {
    id,
    suite: "web",
    spec: "s",
    test: "t",
    step: "p",
    timestamp: "2024-01-01T00:00:00Z",
    shotRel: "",
    baselineRel: null,
    diffRel: null,
    diffFraction: null,
    diffPixels: null,
    totalPixels: null,
    width: 0,
    height: 0,
    state: {},
    annotations: [],
    terminal: "",
    status,
  };
}

describe("evaluateGate", () => {
  test("all ok → pass", () => {
    const res = evaluateGate({
      shots: [shot("a", "ok"), shot("b", "ok")],
      allowedNew: new Set(),
    });
    expect(res.failed).toBe(false);
    expect(res.failingStatuses).toEqual([]);
  });

  test.each<ShotStatus>([
    "over",
    "dim-mismatch",
    "missing",
    "baseline-only",
    "corrupt",
  ])("hard-fail status %s → fail", (status) => {
    const res = evaluateGate({
      shots: [shot("a", "ok"), shot("b", status)],
      allowedNew: new Set(),
    });
    expect(res.failed).toBe(true);
    expect(res.failingStatuses).toContain(status);
  });

  test("unknown new shot → fail", () => {
    const res = evaluateGate({
      shots: [shot("a", "new")],
      allowedNew: new Set(),
    });
    expect(res.failed).toBe(true);
    expect(res.failingStatuses).toContain("new");
  });

  test("allowlisted new shot → pass", () => {
    const res = evaluateGate({
      shots: [shot("a", "new")],
      allowedNew: new Set(["a"]),
    });
    expect(res.failed).toBe(false);
  });

  test("mixed: one allowed new + one unallowed over → fail on over only", () => {
    const res = evaluateGate({
      shots: [shot("allowed", "new"), shot("b", "over")],
      allowedNew: new Set(["allowed"]),
    });
    expect(res.failed).toBe(true);
    expect(res.failingStatuses).toEqual(["over"]);
  });

  test("failingStatuses is deduped + sorted", () => {
    const res = evaluateGate({
      shots: [
        shot("a", "over"),
        shot("b", "over"),
        shot("c", "dim-mismatch"),
        shot("d", "missing"),
      ],
      allowedNew: new Set(),
    });
    expect(res.failingStatuses).toEqual(["dim-mismatch", "missing", "over"]);
  });
});
