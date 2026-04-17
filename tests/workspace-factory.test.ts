import { describe, expect, test } from "bun:test";
import { createWorkspaceRecord } from "../src/views/terminal/workspace-factory";
import { WORKSPACE_COLORS } from "../src/shared/workspace-colors";

describe("createWorkspaceRecord", () => {
  test("id is derived from counter, not surfaceId", () => {
    const ws = createWorkspaceRecord({
      surfaceId: "surf-A",
      name: "first",
      counter: 5,
    });
    expect(ws.id).toBe("ws:5");
  });

  test("the first surface is seeded into surfaceIds + the layout root", () => {
    const ws = createWorkspaceRecord({
      surfaceId: "s1",
      name: "x",
      counter: 1,
    });
    expect(ws.surfaceIds.has("s1")).toBe(true);
    expect(ws.surfaceIds.size).toBe(1);
    expect(ws.layout.getAllSurfaceIds()).toEqual(["s1"]);
  });

  test("color cycles WORKSPACE_COLORS using (counter - 1) mod length", () => {
    for (let n = 1; n <= WORKSPACE_COLORS.length + 2; n++) {
      const ws = createWorkspaceRecord({
        surfaceId: "s",
        name: "n",
        counter: n,
      });
      expect(ws.color).toBe(
        WORKSPACE_COLORS[(n - 1) % WORKSPACE_COLORS.length],
      );
    }
  });

  test("status / progress / logs start empty", () => {
    const ws = createWorkspaceRecord({
      surfaceId: "s",
      name: "n",
      counter: 1,
    });
    expect(ws.status.size).toBe(0);
    expect(ws.progress).toBeNull();
    expect(ws.logs).toEqual([]);
  });

  test("name is preserved verbatim — no defaulting, no transformation", () => {
    const ws = createWorkspaceRecord({
      surfaceId: "s",
      name: "  Custom name with spaces  ",
      counter: 1,
    });
    expect(ws.name).toBe("  Custom name with spaces  ");
  });

  test("each call produces an independent status Map (no shared reference)", () => {
    const a = createWorkspaceRecord({ surfaceId: "a", name: "a", counter: 1 });
    const b = createWorkspaceRecord({ surfaceId: "b", name: "b", counter: 2 });
    a.status.set("k", { value: "v" });
    expect(b.status.has("k")).toBe(false);
  });
});
