import { describe, expect, test } from "bun:test";
import { computeRects, type LayoutNode } from "../src/web-client/layout";

const BOUNDS = { x: 0, y: 0, w: 800, h: 600 };

describe("computeRects", () => {
  test("single leaf fills the bounds", () => {
    const node: LayoutNode = { type: "leaf", surfaceId: "s1" };
    const rects = computeRects(node, BOUNDS, 0);
    expect(rects["s1"]).toEqual(BOUNDS);
  });

  test("horizontal split with gap 0 divides at ratio", () => {
    const node: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", surfaceId: "a" },
        { type: "leaf", surfaceId: "b" },
      ],
    };
    const rects = computeRects(node, BOUNDS, 0);
    expect(rects["a"]).toEqual({ x: 0, y: 0, w: 400, h: 600 });
    expect(rects["b"]).toEqual({ x: 400, y: 0, w: 400, h: 600 });
  });

  test("horizontal split with gap inserts half-gap on each side", () => {
    const node: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", surfaceId: "a" },
        { type: "leaf", surfaceId: "b" },
      ],
    };
    const rects = computeRects(node, BOUNDS, 8);
    expect(rects["a"]).toEqual({ x: 0, y: 0, w: 396, h: 600 });
    expect(rects["b"]).toEqual({ x: 404, y: 0, w: 396, h: 600 });
  });

  test("vertical split with gap 0 divides at ratio", () => {
    const node: LayoutNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { type: "leaf", surfaceId: "top" },
        { type: "leaf", surfaceId: "bot" },
      ],
    };
    const rects = computeRects(node, BOUNDS, 0);
    expect(rects["top"]).toEqual({ x: 0, y: 0, w: 800, h: 300 });
    expect(rects["bot"]).toEqual({ x: 0, y: 300, w: 800, h: 300 });
  });

  test("nested split: horizontal with a vertical right child", () => {
    const node: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "leaf", surfaceId: "left" },
        {
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { type: "leaf", surfaceId: "tr" },
            { type: "leaf", surfaceId: "br" },
          ],
        },
      ],
    };
    const rects = computeRects(node, BOUNDS, 0);
    expect(rects["left"]).toEqual({ x: 0, y: 0, w: 400, h: 600 });
    expect(rects["tr"]).toEqual({ x: 400, y: 0, w: 400, h: 300 });
    expect(rects["br"]).toEqual({ x: 400, y: 300, w: 400, h: 300 });
  });

  test("asymmetric ratio is honored", () => {
    const node: LayoutNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.25,
      children: [
        { type: "leaf", surfaceId: "a" },
        { type: "leaf", surfaceId: "b" },
      ],
    };
    const rects = computeRects(node, BOUNDS, 0);
    expect(rects["a"]).toEqual({ x: 0, y: 0, w: 200, h: 600 });
    expect(rects["b"]).toEqual({ x: 200, y: 0, w: 600, h: 600 });
  });

  test("null node returns empty record", () => {
    const rects = computeRects(null, BOUNDS, 0);
    expect(rects).toEqual({});
  });

  test("leaf without surfaceId is ignored", () => {
    const node: LayoutNode = { type: "leaf" };
    const rects = computeRects(node, BOUNDS, 0);
    expect(rects).toEqual({});
  });

  test("split with missing ratio defaults to 0.5", () => {
    const node: LayoutNode = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "leaf", surfaceId: "a" },
        { type: "leaf", surfaceId: "b" },
      ],
    };
    const rects = computeRects(node, BOUNDS, 0);
    expect(rects["a"]?.w).toBe(400);
    expect(rects["b"]?.w).toBe(400);
  });
});
