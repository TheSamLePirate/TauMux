import { describe, test, expect } from "bun:test";
import { PaneLayout } from "../src/views/terminal/pane-layout";

describe("PaneLayout", () => {
  test("starts as a single leaf", () => {
    const layout = new PaneLayout("s1");
    expect(layout.getAllSurfaceIds()).toEqual(["s1"]);
  });

  test("splitSurface creates a split node", () => {
    const layout = new PaneLayout("s1");
    layout.splitSurface("s1", "horizontal", "s2");

    const ids = layout.getAllSurfaceIds();
    expect(ids).toContain("s1");
    expect(ids).toContain("s2");
    expect(ids.length).toBe(2);
  });

  test("nested splits work", () => {
    const layout = new PaneLayout("s1");
    layout.splitSurface("s1", "horizontal", "s2");
    layout.splitSurface("s2", "vertical", "s3");

    const ids = layout.getAllSurfaceIds();
    expect(ids).toEqual(["s1", "s2", "s3"]);
  });

  test("removeSurface collapses the parent split", () => {
    const layout = new PaneLayout("s1");
    layout.splitSurface("s1", "horizontal", "s2");

    layout.removeSurface("s2");
    expect(layout.getAllSurfaceIds()).toEqual(["s1"]);
    expect(layout.root.type).toBe("leaf");
  });

  test("removeSurface keeps sibling subtree intact", () => {
    const layout = new PaneLayout("s1");
    layout.splitSurface("s1", "horizontal", "s2");
    layout.splitSurface("s2", "vertical", "s3");

    // Remove s1 — the right subtree (s2/s3 split) should become root
    layout.removeSurface("s1");
    const ids = layout.getAllSurfaceIds();
    expect(ids).toContain("s2");
    expect(ids).toContain("s3");
    expect(ids.length).toBe(2);
  });

  test("cannot remove the last surface", () => {
    const layout = new PaneLayout("s1");
    layout.removeSurface("s1");
    expect(layout.getAllSurfaceIds()).toEqual(["s1"]);
  });

  test("computeRects for single leaf fills bounds", () => {
    const layout = new PaneLayout("s1");
    const rects = layout.computeRects({ x: 0, y: 0, w: 800, h: 600 });

    expect(rects.get("s1")).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  test("computeRects for horizontal split divides width", () => {
    const layout = new PaneLayout("s1");
    layout.splitSurface("s1", "horizontal", "s2");

    const rects = layout.computeRects({ x: 0, y: 0, w: 800, h: 600 });
    const r1 = rects.get("s1")!;
    const r2 = rects.get("s2")!;

    // Left pane should be roughly half width
    expect(r1.x).toBe(0);
    expect(r1.w).toBeGreaterThan(350);
    expect(r1.w).toBeLessThan(410);
    expect(r1.h).toBe(600);

    // Right pane should fill the rest
    expect(r2.x).toBeGreaterThan(390);
    expect(r2.w).toBeGreaterThan(350);
    expect(r2.h).toBe(600);
  });

  test("computeRects for vertical split divides height", () => {
    const layout = new PaneLayout("s1");
    layout.splitSurface("s1", "vertical", "s2");

    const rects = layout.computeRects({ x: 0, y: 0, w: 800, h: 600 });
    const r1 = rects.get("s1")!;
    const r2 = rects.get("s2")!;

    expect(r1.y).toBe(0);
    expect(r1.h).toBeGreaterThan(250);
    expect(r1.h).toBeLessThan(310);
    expect(r1.w).toBe(800);

    expect(r2.y).toBeGreaterThan(290);
    expect(r2.h).toBeGreaterThan(250);
    expect(r2.w).toBe(800);
  });

  test("findNeighbor returns adjacent surface", () => {
    const layout = new PaneLayout("s1");
    layout.splitSurface("s1", "horizontal", "s2");

    expect(layout.findNeighbor("s1", "right")).toBe("s2");
    expect(layout.findNeighbor("s2", "left")).toBe("s1");
    expect(layout.findNeighbor("s1", "left")).toBeNull();
    expect(layout.findNeighbor("s2", "right")).toBeNull();
  });

  test("findNeighbor works with vertical split", () => {
    const layout = new PaneLayout("s1");
    layout.splitSurface("s1", "vertical", "s2");

    expect(layout.findNeighbor("s1", "down")).toBe("s2");
    expect(layout.findNeighbor("s2", "up")).toBe("s1");
  });

  test("getDividers returns divider for each split", () => {
    const layout = new PaneLayout("s1");
    layout.splitSurface("s1", "horizontal", "s2");

    const dividers = layout.getDividers({ x: 0, y: 0, w: 800, h: 600 });
    expect(dividers.length).toBe(1);
    expect(dividers[0].direction).toBe("horizontal");
  });

  test("getDividers returns multiple for nested splits", () => {
    const layout = new PaneLayout("s1");
    layout.splitSurface("s1", "horizontal", "s2");
    layout.splitSurface("s2", "vertical", "s3");

    const dividers = layout.getDividers({ x: 0, y: 0, w: 800, h: 600 });
    expect(dividers.length).toBe(2);
  });
});
