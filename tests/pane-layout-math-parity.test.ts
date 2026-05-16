// Phase 2 / F.2 / A5 — native + mirror pane-layout math now share a
// single pure function in `src/shared/pane-layout-math.ts`. This test
// pins the invariant: for every fixed tree+gap, both consumers produce
// the same rect set.

import { describe, expect, test } from "bun:test";
import { computeRects as sharedComputeRects } from "../src/shared/pane-layout-math";
import { computeRects as mirrorComputeRects } from "../src/web-client/layout";
import { PaneLayout } from "../src/views/terminal/pane-layout";
import type { PaneNode, PaneRect } from "../src/shared/types";

const bounds: PaneRect = { x: 0, y: 0, w: 1000, h: 600 };

describe("[F.2 / A5] pane-layout-math — parity across consumers", () => {
  test("leaf-only tree yields a single full-bounds rect", () => {
    const tree: PaneNode = { type: "leaf", surfaceId: "s1" };
    const r = sharedComputeRects(tree, bounds, 0);
    expect(r.size).toBe(1);
    expect(r.get("s1")).toEqual(bounds);
  });

  test("horizontal split with gap=0 partitions cleanly at ratio", () => {
    const tree: PaneNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.4,
      children: [
        { type: "leaf", surfaceId: "left" },
        { type: "leaf", surfaceId: "right" },
      ],
    };
    const r = sharedComputeRects(tree, bounds, 0);
    expect(r.get("left")).toEqual({ x: 0, y: 0, w: 400, h: 600 });
    expect(r.get("right")).toEqual({ x: 400, y: 0, w: 600, h: 600 });
  });

  test("gap splits half-each across the divider", () => {
    const tree: PaneNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", surfaceId: "left" },
        { type: "leaf", surfaceId: "right" },
      ],
    };
    const r = sharedComputeRects(tree, bounds, 10);
    expect(r.get("left")).toEqual({ x: 0, y: 0, w: 495, h: 600 });
    expect(r.get("right")).toEqual({ x: 505, y: 0, w: 495, h: 600 });
  });

  test("nested tree distributes rects without overlap", () => {
    // Two horizontal splits nested in a vertical: top-left, top-right,
    // and a full-width bottom.
    const tree: PaneNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        {
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          children: [
            { type: "leaf", surfaceId: "tl" },
            { type: "leaf", surfaceId: "tr" },
          ],
        },
        { type: "leaf", surfaceId: "bottom" },
      ],
    };
    const r = sharedComputeRects(tree, bounds, 0);
    expect(r.get("tl")).toEqual({ x: 0, y: 0, w: 500, h: 300 });
    expect(r.get("tr")).toEqual({ x: 500, y: 0, w: 500, h: 300 });
    expect(r.get("bottom")).toEqual({ x: 0, y: 300, w: 1000, h: 300 });
  });
});

describe("[F.2 / A5] PaneLayout class wraps the shared math", () => {
  test("PaneLayout.computeRects matches sharedComputeRects with paneGap=2 default", () => {
    const layout = PaneLayout.fromNode({
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", surfaceId: "a" },
        { type: "leaf", surfaceId: "b" },
      ],
    });
    const fromClass = layout.computeRects(bounds);
    const fromShared = sharedComputeRects(layout.root, bounds, 2);
    expect(fromClass.get("a")).toEqual(fromShared.get("a"));
    expect(fromClass.get("b")).toEqual(fromShared.get("b"));
  });
});

describe("[F.2 / A5] mirror layout wraps the shared math", () => {
  test("mirror computeRects yields the same rects as sharedComputeRects", () => {
    const tree = {
      type: "split" as const,
      direction: "horizontal" as const,
      ratio: 0.6,
      children: [
        { type: "leaf" as const, surfaceId: "a" },
        { type: "leaf" as const, surfaceId: "b" },
      ],
    };
    const mirror = mirrorComputeRects(tree, bounds, 4);
    const shared = sharedComputeRects(tree as unknown as PaneNode, bounds, 4);
    for (const id of ["a", "b"] as const) {
      expect(mirror[id]).toEqual(shared.get(id)!);
    }
  });

  test("mirror returns {} for null / undefined / leaf-without-id", () => {
    expect(mirrorComputeRects(null, bounds, 0)).toEqual({});
    expect(mirrorComputeRects(undefined, bounds, 0)).toEqual({});
    expect(mirrorComputeRects({ type: "leaf" }, bounds, 0)).toEqual({});
  });
});
