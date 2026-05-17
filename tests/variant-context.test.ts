// P7 S9 — A7 typed VariantContext.
//
// Covers the singleton accessor: get/set roundtrip, the legacy
// `window.__tau*` shim still fires for any straggling reader, and
// reset() clears every cached handle.

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { variantContext } from "../src/views/terminal/variants/variant-context";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  variantContext.reset();
});

describe("VariantContext (P7 S9 / A7)", () => {
  test("surface manager: set + get round-trip + window shim mirror", () => {
    const fake = { focusSurface: () => {} };
    variantContext.setSurfaceManager(fake);
    expect(variantContext.getSurfaceManager()).toBe(fake);
    expect(
      (window as unknown as Record<string, unknown>)["__tauSurfaceManager"],
    ).toBe(fake);
  });

  test("focused surface id: round-trip + window shim mirror", () => {
    variantContext.setFocusedSurfaceId("surface:7");
    expect(variantContext.getFocusedSurfaceId()).toBe("surface:7");
    expect(
      (window as unknown as Record<string, unknown>)["__tauFocusedSurfaceId"],
    ).toBe("surface:7");
  });

  test("notify workspaces: returns the same set + shim mirror", () => {
    variantContext.setNotifyWorkspaces(new Set(["a", "b"]));
    expect([...variantContext.getNotifyWorkspaces()]).toEqual(["a", "b"]);
    const shim = (window as unknown as Record<string, unknown>)[
      "__tauNotifyWorkspaces"
    ] as Set<string>;
    expect([...shim]).toEqual(["a", "b"]);
  });

  test("notify workspaces: setter copies, not aliases", () => {
    const src = new Set(["a"]);
    variantContext.setNotifyWorkspaces(src);
    src.add("b");
    // Adding to the source after the set must not leak into the
    // cached set — the constructor copies.
    expect([...variantContext.getNotifyWorkspaces()]).toEqual(["a"]);
  });

  test("reset clears every handle + window shim", () => {
    variantContext.setSurfaceManager({ focusSurface: () => {} });
    variantContext.setFocusedSurfaceId("surface:1");
    variantContext.setNotifyWorkspaces(new Set(["w"]));
    variantContext.reset();
    expect(variantContext.getSurfaceManager()).toBeNull();
    expect(variantContext.getFocusedSurfaceId()).toBeNull();
    expect([...variantContext.getNotifyWorkspaces()]).toEqual([]);
    expect(
      (window as unknown as Record<string, unknown>)["__tauSurfaceManager"],
    ).toBeUndefined();
    expect(
      (window as unknown as Record<string, unknown>)["__tauFocusedSurfaceId"],
    ).toBeUndefined();
  });

  test("null surface manager clears the cached handle and the window shim", () => {
    variantContext.setSurfaceManager({ focusSurface: () => {} });
    variantContext.setSurfaceManager(null);
    expect(variantContext.getSurfaceManager()).toBeNull();
    expect(
      (window as unknown as Record<string, unknown>)["__tauSurfaceManager"],
    ).toBeUndefined();
  });
});
