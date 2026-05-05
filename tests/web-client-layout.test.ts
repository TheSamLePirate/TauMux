import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
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

// M16 — `applyLayout` reads paneGap from `state.settings.paneGap`. The
// constructor `gap` is the fallback before the host's first
// `settingsSnapshot` envelope lands.
describe("createLayoutView paneGap from settings", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
  });
  afterAll(async () => {
    await GlobalRegistrator.unregister();
  });

  test("paneGap drift from settings re-distributes panes on next applyLayout", async () => {
    const { createLayoutView } = await import("../src/web-client/layout");
    const { initialState } = await import("../src/web-client/store");
    const { pickWebSettings, mergeSettings, DEFAULT_SETTINGS } =
      await import("../src/shared/settings");

    const container = document.createElement("div");
    Object.defineProperty(container, "offsetWidth", {
      configurable: true,
      get: () => 800,
    });
    Object.defineProperty(container, "offsetHeight", {
      configurable: true,
      get: () => 600,
    });
    document.body.appendChild(container);
    const sidebarEl = document.createElement("div");

    const sidA = document.createElement("div");
    const termA = document.createElement("div");
    const sidB = document.createElement("div");
    const termB = document.createElement("div");

    const view = createLayoutView({
      container,
      sidebarEl,
      terms: {
        a: { el: sidA, termEl: termA },
        b: { el: sidB, termEl: termB },
      },
      gap: 2, // fallback before settings load
      sidebarWidth: 0,
      toolbarHeight: 0,
    });

    const state = {
      ...initialState(),
      workspaces: [
        {
          id: "w",
          name: "w",
          color: "#fff",
          surfaceIds: ["a", "b"],
          focusedSurfaceId: "a",
          layout: {
            type: "split" as const,
            direction: "horizontal" as const,
            ratio: 0.5,
            children: [
              { type: "leaf" as const, surfaceId: "a" },
              { type: "leaf" as const, surfaceId: "b" },
            ],
          },
        },
      ],
      activeWorkspaceId: "w",
      focusedSurfaceId: "a",
      settings: pickWebSettings(
        mergeSettings(DEFAULT_SETTINGS, { paneGap: 2 }),
      ),
    };
    view.applyLayout(state as any);
    // gap=2 → half=1, leftWidth=400-1=399.
    expect(sidA.style.width).toBe("399px");
    expect(sidB.style.left).toBe("401px");

    // Bump paneGap to 12 in settings — next applyLayout pass picks
    // up the new value without reconstructing the view.
    const wider = {
      ...state,
      settings: pickWebSettings(
        mergeSettings(DEFAULT_SETTINGS, { paneGap: 12 }),
      ),
    };
    view.applyLayout(wider as any);
    // gap=12 → half=6, leftWidth=400-6=394.
    expect(sidA.style.width).toBe("394px");
    expect(sidB.style.left).toBe("406px");
  });

  test("null settings falls back to the constructor default gap", async () => {
    const { createLayoutView } = await import("../src/web-client/layout");
    const { initialState } = await import("../src/web-client/store");

    const container = document.createElement("div");
    Object.defineProperty(container, "offsetWidth", {
      configurable: true,
      get: () => 800,
    });
    Object.defineProperty(container, "offsetHeight", {
      configurable: true,
      get: () => 600,
    });
    document.body.appendChild(container);
    const sidebarEl = document.createElement("div");
    const termA = document.createElement("div");
    const termB = document.createElement("div");
    const sidA = document.createElement("div");
    const sidB = document.createElement("div");

    const view = createLayoutView({
      container,
      sidebarEl,
      terms: {
        a: { el: sidA, termEl: termA },
        b: { el: sidB, termEl: termB },
      },
      gap: 8,
      sidebarWidth: 0,
      toolbarHeight: 0,
    });

    const state = {
      ...initialState(),
      workspaces: [
        {
          id: "w",
          name: "w",
          color: "#fff",
          surfaceIds: ["a", "b"],
          focusedSurfaceId: "a",
          layout: {
            type: "split" as const,
            direction: "horizontal" as const,
            ratio: 0.5,
            children: [
              { type: "leaf" as const, surfaceId: "a" },
              { type: "leaf" as const, surfaceId: "b" },
            ],
          },
        },
      ],
      activeWorkspaceId: "w",
      focusedSurfaceId: "a",
      // settings remains null — pre-snapshot path.
    };
    view.applyLayout(state as any);
    // Constructor gap=8 → half=4, leftWidth=400-4=396.
    expect(sidA.style.width).toBe("396px");
    expect(sidB.style.left).toBe("404px");
  });
});
