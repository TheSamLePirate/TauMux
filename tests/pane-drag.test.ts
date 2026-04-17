import { describe, expect, test } from "bun:test";
import {
  getPaneDropOverlayBounds,
  getPaneDropOverlayLabel,
  resolvePaneDropPosition,
} from "../src/views/terminal/pane-drag";

// ------------------------------------------------------------------
// resolvePaneDropPosition
// ------------------------------------------------------------------

describe("resolvePaneDropPosition", () => {
  // Standard 400×300 target for most cases. Threshold = min(max(size*0.24, 24), max(16, size/2 - 16))
  //   For 400: min(max(96, 24), max(16, 184)) = min(96, 184) = 96
  //   For 300: min(max(72, 24), max(16, 134)) = min(72, 134) = 72

  test("center of a sizeable pane is 'swap'", () => {
    expect(resolvePaneDropPosition(200, 150, 400, 300)).toBe("swap");
  });

  test("pointer near the left edge is 'left'", () => {
    expect(resolvePaneDropPosition(10, 150, 400, 300)).toBe("left");
  });

  test("pointer near the right edge is 'right'", () => {
    expect(resolvePaneDropPosition(390, 150, 400, 300)).toBe("right");
  });

  test("pointer near the top is 'top'", () => {
    expect(resolvePaneDropPosition(200, 10, 400, 300)).toBe("top");
  });

  test("pointer near the bottom is 'bottom'", () => {
    expect(resolvePaneDropPosition(200, 290, 400, 300)).toBe("bottom");
  });

  test("pointer in a corner picks the closer edge by distance", () => {
    // Top-left corner: localX=5 (distance 5 from left), localY=20 (distance 20 from top).
    // Both within threshold; left is closer.
    expect(resolvePaneDropPosition(5, 20, 400, 300)).toBe("left");
    // Flipped: localX=20, localY=5 — top closer.
    expect(resolvePaneDropPosition(20, 5, 400, 300)).toBe("top");
  });

  test("very small panes still yield usable zones (threshold floor of 16)", () => {
    // 60×60 pane — threshold = min(max(14.4, 24), max(16, 14)) = min(24, 16) = 16.
    expect(resolvePaneDropPosition(5, 30, 60, 60)).toBe("left");
    expect(resolvePaneDropPosition(30, 30, 60, 60)).toBe("swap");
  });

  test("giant panes cap the split band so center stays usable", () => {
    // 2000×1000: threshold_x = min(max(480, 24), max(16, 984)) = 480
    // At x=500 (far from any edge in a 2000-wide pane), still 'swap'.
    expect(resolvePaneDropPosition(1000, 500, 2000, 1000)).toBe("swap");
    // At x=479, just inside the 480 threshold, 'left'.
    expect(resolvePaneDropPosition(479, 500, 2000, 1000)).toBe("left");
  });
});

// ------------------------------------------------------------------
// getPaneDropOverlayBounds
// ------------------------------------------------------------------

describe("getPaneDropOverlayBounds", () => {
  const rect = { x: 100, y: 50, w: 400, h: 300 };
  // padding = 12 → inner = {112, 62, 376, 276}

  test("swap fills the full inner-inset rect", () => {
    const b = getPaneDropOverlayBounds(rect, "swap");
    expect(b).toEqual({ x: 112, y: 62, w: 376, h: 276 });
  });

  test("left drop carves the inner rect's left 38% (clamped)", () => {
    const b = getPaneDropOverlayBounds(rect, "left");
    // splitWidth = min(376, max(24, 376*0.38)) = min(376, 142.88) = 142.88
    expect(b.x).toBe(112);
    expect(b.y).toBe(62);
    expect(b.w).toBeCloseTo(142.88);
    expect(b.h).toBe(276);
  });

  test("right drop anchors to inner rect's right edge", () => {
    const b = getPaneDropOverlayBounds(rect, "right");
    // inner.x + inner.w - splitWidth = 112 + 376 - 142.88 = 345.12
    expect(b.x).toBeCloseTo(345.12);
    expect(b.w).toBeCloseTo(142.88);
  });

  test("top drop carves the inner rect's top 38%", () => {
    const b = getPaneDropOverlayBounds(rect, "top");
    // splitHeight = min(276, max(24, 276*0.38)) = min(276, 104.88) = 104.88
    expect(b.x).toBe(112);
    expect(b.y).toBe(62);
    expect(b.w).toBe(376);
    expect(b.h).toBeCloseTo(104.88);
  });

  test("bottom drop anchors to inner rect's bottom edge", () => {
    const b = getPaneDropOverlayBounds(rect, "bottom");
    expect(b.y).toBeCloseTo(62 + 276 - 104.88);
    expect(b.h).toBeCloseTo(104.88);
  });

  test("inner-rect has minimum 28px dimensions even on tiny targets", () => {
    const b = getPaneDropOverlayBounds({ x: 0, y: 0, w: 20, h: 20 }, "swap");
    expect(b.w).toBe(28);
    expect(b.h).toBe(28);
  });

  test("split-band has minimum 24px so overlay stays clickable on narrow panes", () => {
    const b = getPaneDropOverlayBounds({ x: 0, y: 0, w: 80, h: 80 }, "left");
    // inner = {12, 12, 56, 56}; splitWidth = min(56, max(24, 21.28)) = min(56, 24) = 24
    expect(b.w).toBe(24);
  });
});

// ------------------------------------------------------------------
// getPaneDropOverlayLabel
// ------------------------------------------------------------------

describe("getPaneDropOverlayLabel", () => {
  test("each position has a user-facing label", () => {
    expect(getPaneDropOverlayLabel("left")).toBe("Split left");
    expect(getPaneDropOverlayLabel("right")).toBe("Split right");
    expect(getPaneDropOverlayLabel("top")).toBe("Split up");
    expect(getPaneDropOverlayLabel("bottom")).toBe("Split down");
    expect(getPaneDropOverlayLabel("swap")).toBe("Move here");
  });
});
