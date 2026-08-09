// Restoring a layout re-spawns every PTY, so every surface id in
// `layout.json` is stale. Each per-surface map has to be re-keyed in
// lockstep with the pane tree — miss one and the restored workspace
// silently loses that facet (a title, a cwd, an editor's file).

import { describe, expect, test } from "bun:test";
import { remapPersistedLayout } from "../src/shared/layout-remap";
import type { PaneNode, PersistedLayout } from "../src/shared/types";

const identityPane = (node: PaneNode, m: Record<string, string>): PaneNode =>
  node.type === "leaf"
    ? { ...node, surfaceId: m[node.surfaceId] ?? node.surfaceId }
    : node;

function layout(over: Partial<PersistedLayout["workspaces"][0]> = {}) {
  return {
    activeWorkspaceIndex: 0,
    sidebarVisible: true,
    workspaces: [
      {
        name: "ws",
        color: "#fff",
        layout: { type: "leaf", surfaceId: "old:1" } as PaneNode,
        focusedSurfaceId: "old:1",
        ...over,
      },
    ],
  } satisfies PersistedLayout;
}

const MAP = { "old:1": "new:1", "old:2": "new:2" };

describe("remapPersistedLayout", () => {
  test("re-keys every per-surface map together", () => {
    const out = remapPersistedLayout(
      layout({
        surfaceTitles: { "old:1": "a", "old:2": "b" },
        surfaceCwds: { "old:1": "/x" },
        surfaceEditorFiles: { "old:2": "/f.ts" },
        surfaceExtensionIds: { "old:1": "ext" },
      }),
      MAP,
      identityPane,
    );
    const ws = out.workspaces[0]!;
    expect(ws.surfaceTitles).toEqual({ "new:1": "a", "new:2": "b" });
    expect(ws.surfaceCwds).toEqual({ "new:1": "/x" });
    expect(ws.surfaceEditorFiles).toEqual({ "new:2": "/f.ts" });
    expect(ws.surfaceExtensionIds).toEqual({ "new:1": "ext" });
    expect(ws.layout).toEqual({ type: "leaf", surfaceId: "new:1" });
    expect(ws.focusedSurfaceId).toBe("new:1");
  });

  test("the user's title locks are re-keyed, not dropped", () => {
    const out = remapPersistedLayout(
      layout({ surfaceTitlesLocked: ["old:2"] }),
      MAP,
      identityPane,
    );
    expect(out.workspaces[0]!.surfaceTitlesLocked).toEqual(["new:2"]);
  });

  test("a surface that did not come back is dropped, not dangling", () => {
    const out = remapPersistedLayout(
      layout({
        surfaceTitles: { "old:1": "a", "gone": "b" },
        surfaceTitlesLocked: ["gone"],
      }),
      MAP,
      identityPane,
    );
    const ws = out.workspaces[0]!;
    expect(ws.surfaceTitles).toEqual({ "new:1": "a" });
    // Empty collapses to undefined rather than an empty object/array, so
    // the persisted file stays clean.
    expect(ws.surfaceTitlesLocked).toBeUndefined();
  });

  test("selectedCwd is a path and carries through untouched", () => {
    const out = remapPersistedLayout(
      layout({ selectedCwd: "/Users/dev/repo" }),
      MAP,
      identityPane,
    );
    expect(out.workspaces[0]!.selectedCwd).toBe("/Users/dev/repo");
  });

  test("absent maps stay absent", () => {
    const ws = remapPersistedLayout(layout(), MAP, identityPane).workspaces[0]!;
    expect(ws.surfaceTitles).toBeUndefined();
    expect(ws.surfaceCwds).toBeUndefined();
    expect(ws.surfaceTitlesLocked).toBeUndefined();
  });

  test("a focused surface that vanished becomes null", () => {
    const out = remapPersistedLayout(
      layout({ focusedSurfaceId: "gone" }),
      MAP,
      identityPane,
    );
    expect(out.workspaces[0]!.focusedSurfaceId).toBeNull();
  });
});
