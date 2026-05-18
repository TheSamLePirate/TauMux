// P9 — strict validator for PersistedLayout shape.
//
// Previously `loadLayout` did `JSON.parse(...) as PersistedLayout` and
// only checked `workspaces.length > 0`. A truncated layout.json would
// fall through with a malformed PaneNode tree and crash boot at
// `collectLeafIds` / `remapPaneNode`. The new validator rejects every
// structural mismatch so a partial file boots to a clean slate.

import { describe, expect, test } from "bun:test";
import {
  parsePersistedLayout,
  validatePersistedLayout,
} from "../src/shared/layout-persistence";

function minimalLayout() {
  return {
    activeWorkspaceIndex: 0,
    sidebarVisible: true,
    workspaces: [
      {
        name: "ws-1",
        color: "#6fe9ff",
        layout: { type: "leaf", surfaceId: "s1" },
        focusedSurfaceId: "s1",
      },
    ],
  };
}

describe("parsePersistedLayout — happy path", () => {
  test("accepts a minimal valid layout", () => {
    const json = JSON.stringify(minimalLayout());
    expect(parsePersistedLayout(json)).not.toBeNull();
  });

  test("accepts a nested split layout with terminal + browser leaves", () => {
    const layout = {
      activeWorkspaceIndex: 0,
      sidebarVisible: false,
      workspaces: [
        {
          name: "ws",
          color: "#abc",
          focusedSurfaceId: null,
          layout: {
            type: "split",
            direction: "horizontal",
            ratio: 0.5,
            children: [
              { type: "leaf", surfaceId: "s1", surfaceType: "terminal" },
              {
                type: "split",
                direction: "vertical",
                ratio: 0.33,
                children: [
                  { type: "leaf", surfaceId: "s2", surfaceType: "browser" },
                  { type: "leaf", surfaceId: "s3", surfaceType: "agent" },
                ],
              },
            ],
          },
        },
      ],
    };
    expect(parsePersistedLayout(JSON.stringify(layout))).not.toBeNull();
  });

  test("accepts activeWorkspaceIndex = -1 (no-active sentinel)", () => {
    const l = minimalLayout();
    l.activeWorkspaceIndex = -1;
    expect(parsePersistedLayout(JSON.stringify(l))).not.toBeNull();
  });

  test("accepts optional surfaceTitles / surfaceCwds / surfaceUrls / surfaceTypes records", () => {
    const layout = {
      ...minimalLayout(),
      workspaces: [
        {
          name: "ws",
          color: "#abc",
          focusedSurfaceId: "s1",
          layout: { type: "leaf", surfaceId: "s1" },
          surfaceTitles: { s1: "Title" },
          surfaceCwds: { s1: "/home/me" },
          surfaceUrls: {},
          surfaceTypes: { s1: "terminal" },
        },
      ],
    };
    expect(parsePersistedLayout(JSON.stringify(layout))).not.toBeNull();
  });
});

describe("parsePersistedLayout — parse failures return null", () => {
  test("totally invalid JSON", () => {
    expect(parsePersistedLayout("{garbage")).toBeNull();
  });

  test("truncated JSON (object cut mid-string)", () => {
    const full = JSON.stringify(minimalLayout());
    const cut = full.slice(0, Math.floor(full.length / 2));
    expect(parsePersistedLayout(cut)).toBeNull();
  });

  test("empty string", () => {
    expect(parsePersistedLayout("")).toBeNull();
  });

  test("whitespace only", () => {
    expect(parsePersistedLayout("   \n\n")).toBeNull();
  });

  test("JSON null", () => {
    expect(parsePersistedLayout("null")).toBeNull();
  });

  test("JSON array at top level", () => {
    expect(parsePersistedLayout("[]")).toBeNull();
  });
});

describe("parsePersistedLayout — shape mismatches return null", () => {
  test("missing workspaces", () => {
    expect(
      parsePersistedLayout(
        JSON.stringify({ activeWorkspaceIndex: 0, sidebarVisible: true }),
      ),
    ).toBeNull();
  });

  test("workspaces is a string instead of array", () => {
    expect(
      parsePersistedLayout(
        JSON.stringify({
          activeWorkspaceIndex: 0,
          sidebarVisible: true,
          workspaces: "oops",
        }),
      ),
    ).toBeNull();
  });

  test("workspaces is empty", () => {
    const l = minimalLayout();
    l.workspaces = [];
    expect(parsePersistedLayout(JSON.stringify(l))).toBeNull();
  });

  test("sidebarVisible is a string instead of boolean", () => {
    const l = minimalLayout() as unknown as Record<string, unknown>;
    l["sidebarVisible"] = "yes";
    expect(parsePersistedLayout(JSON.stringify(l))).toBeNull();
  });

  test("activeWorkspaceIndex out of range", () => {
    const l = minimalLayout();
    l.activeWorkspaceIndex = 5; // only 1 workspace
    expect(parsePersistedLayout(JSON.stringify(l))).toBeNull();
  });

  test("activeWorkspaceIndex is a float", () => {
    const l = minimalLayout();
    l.activeWorkspaceIndex = 0.5;
    expect(parsePersistedLayout(JSON.stringify(l))).toBeNull();
  });

  test("PaneNode with type='leaf' but missing surfaceId", () => {
    const l = minimalLayout();
    (l.workspaces[0]!.layout as unknown as Record<string, unknown>) = {
      type: "leaf",
    };
    expect(parsePersistedLayout(JSON.stringify(l))).toBeNull();
  });

  test("PaneNode with surfaceType='nonsense'", () => {
    const l = minimalLayout();
    (l.workspaces[0]!.layout as unknown as Record<string, unknown>) = {
      type: "leaf",
      surfaceId: "s1",
      surfaceType: "nonsense",
    };
    expect(parsePersistedLayout(JSON.stringify(l))).toBeNull();
  });

  test("PaneNode split with ratio > 1", () => {
    const l = minimalLayout();
    (l.workspaces[0]!.layout as unknown as Record<string, unknown>) = {
      type: "split",
      direction: "horizontal",
      ratio: 1.7,
      children: [
        { type: "leaf", surfaceId: "a" },
        { type: "leaf", surfaceId: "b" },
      ],
    };
    expect(parsePersistedLayout(JSON.stringify(l))).toBeNull();
  });

  test("PaneNode split with one child instead of two", () => {
    const l = minimalLayout();
    (l.workspaces[0]!.layout as unknown as Record<string, unknown>) = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [{ type: "leaf", surfaceId: "a" }],
    };
    expect(parsePersistedLayout(JSON.stringify(l))).toBeNull();
  });

  test("PaneNode split with non-finite ratio (NaN)", () => {
    const l = minimalLayout();
    (l.workspaces[0]!.layout as unknown as Record<string, unknown>) = {
      type: "split",
      direction: "horizontal",
      ratio: NaN,
      children: [
        { type: "leaf", surfaceId: "a" },
        { type: "leaf", surfaceId: "b" },
      ],
    };
    // NaN doesn't survive JSON.stringify (becomes null), but the
    // validator's typeof check catches the null too.
    expect(parsePersistedLayout(JSON.stringify(l))).toBeNull();
  });

  test("workspace.surfaceCwds with non-string value", () => {
    const l = minimalLayout() as unknown as Record<string, unknown>;
    (l["workspaces"] as unknown[])[0] = {
      name: "ws",
      color: "#abc",
      focusedSurfaceId: "s1",
      layout: { type: "leaf", surfaceId: "s1" },
      surfaceCwds: { s1: 42 },
    };
    expect(parsePersistedLayout(JSON.stringify(l))).toBeNull();
  });

  test("one valid workspace + one malformed → whole layout rejected", () => {
    const l = minimalLayout();
    l.workspaces.push({
      name: "ws-2",
      color: "#000",
      // Missing layout — should fail.
      focusedSurfaceId: null,
    } as unknown as (typeof l.workspaces)[number]);
    l.activeWorkspaceIndex = 0;
    expect(parsePersistedLayout(JSON.stringify(l))).toBeNull();
  });

  test("workspace missing required `name` field", () => {
    const l = minimalLayout() as unknown as Record<string, unknown>;
    (l["workspaces"] as unknown[])[0] = {
      color: "#abc",
      focusedSurfaceId: "s1",
      layout: { type: "leaf", surfaceId: "s1" },
    };
    expect(parsePersistedLayout(JSON.stringify(l))).toBeNull();
  });

  test("workspace.focusedSurfaceId is a number instead of string|null", () => {
    const l = minimalLayout() as unknown as Record<string, unknown>;
    (l["workspaces"] as Array<Record<string, unknown>>)[0]![
      "focusedSurfaceId"
    ] = 7;
    expect(parsePersistedLayout(JSON.stringify(l))).toBeNull();
  });
});

describe("validatePersistedLayout — boolean variant", () => {
  test("returns boolean (not throw)", () => {
    expect(validatePersistedLayout({ foo: "bar" })).toBe(false);
    expect(validatePersistedLayout(minimalLayout())).toBe(true);
  });
});
