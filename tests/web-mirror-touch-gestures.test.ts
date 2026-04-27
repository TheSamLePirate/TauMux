// Plan #13 — pure-function tests for the web-mirror touch-gesture
// router. The DOM-bound `attachTouchGestures` is exercised
// implicitly through the decision helpers it composes; we test
// the helpers directly so we don't need JSDOM.

import { describe, expect, test } from "bun:test";
import {
  applyPinchStep,
  pickWorkspaceStep,
  resolveEdgeIntent,
  resolvePinchStep,
  resolveSwipeIntent,
} from "../src/web-client/touch-gestures";

// ── resolveSwipeIntent ────────────────────────────────────────

describe("resolveSwipeIntent", () => {
  test("clear left swipe at desktop width = next workspace", () => {
    expect(resolveSwipeIntent(-200, 4, 1280)).toBe("next");
  });

  test("clear right swipe at desktop width = prev workspace", () => {
    expect(resolveSwipeIntent(200, -4, 1280)).toBe("prev");
  });

  test("below threshold returns none", () => {
    // 60 px floor regardless of viewport.
    expect(resolveSwipeIntent(40, 0, 1280)).toBe("none");
  });

  test("vertical-dominant swipes are rejected (would be a scroll)", () => {
    expect(resolveSwipeIntent(80, 200, 800)).toBe("none");
  });

  test("threshold scales down on narrow viewports (30% of vw)", () => {
    // 100 px viewport → 30 px threshold → 50 px swipe still counts
    expect(resolveSwipeIntent(50, 0, 100)).toBe("prev");
  });

  test("zero delta is safely ignored", () => {
    expect(resolveSwipeIntent(0, 0, 800)).toBe("none");
  });
});

// ── resolveEdgeIntent ────────────────────────────────────────

describe("resolveEdgeIntent", () => {
  test("right-swipe from left gutter opens drawer", () => {
    expect(resolveEdgeIntent(10, 80, false)).toBe("open");
  });

  test("right-swipe from middle of viewport does NOT open drawer", () => {
    expect(resolveEdgeIntent(200, 80, false)).toBe("none");
  });

  test("left-swipe with drawer open closes it", () => {
    expect(resolveEdgeIntent(150, -80, true)).toBe("close");
  });

  test("left-swipe with drawer closed is no-op", () => {
    expect(resolveEdgeIntent(150, -80, false)).toBe("none");
  });

  test("right-swipe with drawer open is no-op (already open)", () => {
    expect(resolveEdgeIntent(10, 80, true)).toBe("none");
  });

  test("below 40 px delta is no-op even from the edge", () => {
    expect(resolveEdgeIntent(5, 30, false)).toBe("none");
  });
});

// ── resolvePinchStep / applyPinchStep ────────────────────────

describe("resolvePinchStep", () => {
  test("identical distance = zero step", () => {
    expect(resolvePinchStep(200, 200)).toBe(0);
  });

  test("12% spread = +1 step", () => {
    expect(resolvePinchStep(200, 200 * 1.12)).toBe(1);
  });

  test("12% pinch = -1 step", () => {
    expect(resolvePinchStep(200, 200 / 1.12)).toBe(-1);
  });

  test("cap at +/-4 even on extreme pinches", () => {
    expect(resolvePinchStep(200, 50000)).toBe(4);
    expect(resolvePinchStep(200, 0.0001)).toBe(-4);
  });

  test("zero / negative distances are safely ignored", () => {
    expect(resolvePinchStep(0, 200)).toBe(0);
    expect(resolvePinchStep(200, 0)).toBe(0);
    expect(resolvePinchStep(200, -10)).toBe(0);
  });
});

describe("applyPinchStep", () => {
  test("step is added to base size", () => {
    expect(applyPinchStep(13, 2)).toBe(15);
  });

  test("clamped to upper bound (default 22)", () => {
    expect(applyPinchStep(20, 5)).toBe(22);
  });

  test("clamped to lower bound (default 10)", () => {
    expect(applyPinchStep(11, -5)).toBe(10);
  });

  test("custom bounds honored", () => {
    expect(applyPinchStep(8, 5, 6, 12)).toBe(12);
    expect(applyPinchStep(8, -5, 6, 12)).toBe(6);
  });
});

// ── pickWorkspaceStep ────────────────────────────────────────

describe("pickWorkspaceStep", () => {
  const ws = [{ id: "a" }, { id: "b" }, { id: "c" }];

  test("next from middle picks the next id", () => {
    expect(pickWorkspaceStep(ws, "b", "next")).toBe("c");
  });

  test("prev from middle picks the previous id", () => {
    expect(pickWorkspaceStep(ws, "b", "prev")).toBe("a");
  });

  test("next at the end wraps to the first", () => {
    expect(pickWorkspaceStep(ws, "c", "next")).toBe("a");
  });

  test("prev at the start wraps to the last", () => {
    expect(pickWorkspaceStep(ws, "a", "prev")).toBe("c");
  });

  test("unknown current id starts at index 0", () => {
    expect(pickWorkspaceStep(ws, "missing", "next")).toBe("b");
  });

  test("single workspace returns its own id", () => {
    expect(pickWorkspaceStep([{ id: "only" }], "only", "next")).toBe("only");
  });

  test("empty list returns null", () => {
    expect(pickWorkspaceStep([], null, "next")).toBeNull();
  });
});
