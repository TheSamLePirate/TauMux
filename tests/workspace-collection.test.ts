// P7 S11 — F.11 WorkspaceCollection seam.
//
// The collection is a thin facade over `Workspace[]` exposing typed
// read helpers. These tests pin the contract so future sessions
// migrating mutations onto the collection can't silently regress
// the existing read API.

import { describe, expect, test } from "bun:test";
import { WorkspaceCollection } from "../src/views/terminal/workspace-collection";
import type { Workspace } from "../src/views/terminal/surface-manager";

function ws(id: string, name?: string): Workspace {
  return {
    id,
    name: name ?? id,
    color: "#89b4fa",
    layout: { kind: "leaf", surfaceId: `surface:${id}` } as Workspace["layout"],
    surfaceIds: new Set([`surface:${id}`]),
    status: new Map(),
    progress: null,
    logs: [],
  };
}

describe("WorkspaceCollection (P7 S11 / F.11)", () => {
  test("list returns the underlying array; count matches length", () => {
    const source = { workspaces: [ws("a"), ws("b"), ws("c")] };
    const col = new WorkspaceCollection(source);
    expect(col.list).toBe(source.workspaces);
    expect(col.count).toBe(3);
  });

  test("findById returns the workspace or null", () => {
    const source = { workspaces: [ws("a"), ws("b")] };
    const col = new WorkspaceCollection(source);
    expect(col.findById("a")?.id).toBe("a");
    expect(col.findById("missing")).toBeNull();
  });

  test("findIndexById returns the position or -1", () => {
    const source = { workspaces: [ws("a"), ws("b"), ws("c")] };
    const col = new WorkspaceCollection(source);
    expect(col.findIndexById("b")).toBe(1);
    expect(col.findIndexById("missing")).toBe(-1);
  });

  test("findByName is case-insensitive + trims surrounding whitespace", () => {
    const source = { workspaces: [ws("a", "CrazyShell"), ws("b", "Other")] };
    const col = new WorkspaceCollection(source);
    expect(col.findByName("crazyshell")?.id).toBe("a");
    expect(col.findByName("  CRAZYSHELL  ")?.id).toBe("a");
    expect(col.findByName("missing")).toBeNull();
  });

  test("findByName returns null for an empty / whitespace-only query", () => {
    const source = { workspaces: [ws("a", "Alpha")] };
    const col = new WorkspaceCollection(source);
    expect(col.findByName("")).toBeNull();
    expect(col.findByName("   ")).toBeNull();
  });

  test("findContainingSurface walks every workspace's surfaceIds set", () => {
    const w1 = ws("a");
    w1.surfaceIds = new Set(["surface:1", "surface:2"]);
    const w2 = ws("b");
    w2.surfaceIds = new Set(["surface:3"]);
    const col = new WorkspaceCollection({ workspaces: [w1, w2] });
    expect(col.findContainingSurface("surface:2")?.id).toBe("a");
    expect(col.findContainingSurface("surface:3")?.id).toBe("b");
    expect(col.findContainingSurface("surface:99")).toBeNull();
  });

  test("hasSurface mirrors findContainingSurface as a boolean", () => {
    const w1 = ws("a");
    w1.surfaceIds = new Set(["surface:1"]);
    const col = new WorkspaceCollection({ workspaces: [w1] });
    expect(col.hasSurface("surface:1")).toBe(true);
    expect(col.hasSurface("surface:99")).toBe(false);
  });

  test("map mirrors Array.prototype.map with the same index argument", () => {
    const source = { workspaces: [ws("a"), ws("b"), ws("c")] };
    const col = new WorkspaceCollection(source);
    const out = col.map((w, i) => `${i}:${w.id}`);
    expect(out).toEqual(["0:a", "1:b", "2:c"]);
  });

  test("reads observe live source mutations (back-compat with the array owner)", () => {
    const source = { workspaces: [ws("a")] };
    const col = new WorkspaceCollection(source);
    expect(col.count).toBe(1);
    source.workspaces.push(ws("b"));
    expect(col.count).toBe(2);
    expect(col.findById("b")?.id).toBe("b");
  });

  // ──────────────────────────────────────────────────────────────────
  // P7 S12 — mutation API
  // ──────────────────────────────────────────────────────────────────

  test("push appends and returns the new index", () => {
    const source = { workspaces: [ws("a")] };
    const col = new WorkspaceCollection(source);
    const i = col.push(ws("b"));
    expect(i).toBe(1);
    expect(col.count).toBe(2);
    expect(col.findById("b")?.id).toBe("b");
  });

  test("removeAt drops the entry and returns true", () => {
    const source = { workspaces: [ws("a"), ws("b"), ws("c")] };
    const col = new WorkspaceCollection(source);
    expect(col.removeAt(1)).toBe(true);
    expect(col.map((w) => w.id)).toEqual(["a", "c"]);
  });

  test("removeAt returns false on out-of-bounds + leaves the list intact", () => {
    const source = { workspaces: [ws("a")] };
    const col = new WorkspaceCollection(source);
    expect(col.removeAt(-1)).toBe(false);
    expect(col.removeAt(5)).toBe(false);
    expect(col.count).toBe(1);
  });

  test("removeById returns the removed index", () => {
    const source = { workspaces: [ws("a"), ws("b"), ws("c")] };
    const col = new WorkspaceCollection(source);
    expect(col.removeById("b")).toBe(1);
    expect(col.map((w) => w.id)).toEqual(["a", "c"]);
  });

  test("removeById returns -1 for an unknown id", () => {
    const source = { workspaces: [ws("a")] };
    const col = new WorkspaceCollection(source);
    expect(col.removeById("missing")).toBe(-1);
    expect(col.count).toBe(1);
  });

  test("replaceAll swaps the contents in place (array ref stays stable)", () => {
    const source = { workspaces: [ws("a"), ws("b")] };
    const col = new WorkspaceCollection(source);
    const arrayRef = source.workspaces;
    col.replaceAll([ws("x"), ws("y"), ws("z")]);
    expect(source.workspaces).toBe(arrayRef); // same array, mutated in place
    expect(col.map((w) => w.id)).toEqual(["x", "y", "z"]);
  });

  test("clear empties the list without swapping the array ref", () => {
    const source = { workspaces: [ws("a"), ws("b")] };
    const col = new WorkspaceCollection(source);
    const arrayRef = source.workspaces;
    col.clear();
    expect(source.workspaces).toBe(arrayRef);
    expect(col.count).toBe(0);
  });
});
