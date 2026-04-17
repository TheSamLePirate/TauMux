import { describe, expect, test } from "bun:test";
import {
  buildSidebarWorkspaces,
  extractScriptName,
  samePortSet,
  type SidebarStateInput,
} from "../src/views/terminal/sidebar-state";
import type { Workspace } from "../src/views/terminal/surface-manager";
import { PaneLayout } from "../src/views/terminal/pane-layout";
import type { SurfaceMetadata } from "../src/shared/types";

// ------------------------------------------------------------------
// Factories
// ------------------------------------------------------------------

function mkWorkspace(
  id: string,
  name: string,
  surfaceIds: string[],
  overrides: Partial<Workspace> = {},
): Workspace {
  return {
    id,
    name,
    color: "#89b4fa",
    surfaceIds: new Set(surfaceIds),
    layout: new PaneLayout(surfaceIds[0]),
    status: new Map(),
    progress: null,
    logs: [],
    ...overrides,
  };
}

function mkMeta(overrides: Partial<SurfaceMetadata> = {}): SurfaceMetadata {
  return {
    pid: 100,
    foregroundPid: 100,
    cwd: "/home/user",
    tree: [],
    listeningPorts: [],
    git: null,
    packageJson: null,
    updatedAt: 0,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<SidebarStateInput> = {},
): SidebarStateInput {
  return {
    workspaces: [],
    surfaces: new Map(),
    focusedSurfaceId: null,
    activeWorkspaceIndex: 0,
    metadata: new Map(),
    selectedCwds: new Map(),
    scriptErrors: new Map(),
    ...overrides,
  };
}

// ------------------------------------------------------------------
// extractScriptName
// ------------------------------------------------------------------

describe("extractScriptName", () => {
  test("recognises bun/npm/pnpm/yarn run prefixes", () => {
    expect(extractScriptName("bun run build")).toBe("build");
    expect(extractScriptName("npm run dev")).toBe("dev");
    expect(extractScriptName("pnpm run test")).toBe("test");
    expect(extractScriptName("yarn run start")).toBe("start");
  });

  test("allows the implicit form (bun <script>, pnpm <script>)", () => {
    expect(extractScriptName("bun test")).toBe("test");
    expect(extractScriptName("pnpm build")).toBe("build");
  });

  test("returns null for unrelated commands", () => {
    expect(extractScriptName("ls -la")).toBeNull();
    expect(extractScriptName("vim src/x.ts")).toBeNull();
    expect(extractScriptName("cargo run")).toBeNull();
  });

  test("handles run-script form (npm run-script foo)", () => {
    expect(extractScriptName("npm run-script ci")).toBe("ci");
  });
});

// ------------------------------------------------------------------
// samePortSet
// ------------------------------------------------------------------

describe("samePortSet", () => {
  test("same port set regardless of order returns true", () => {
    expect(
      samePortSet(
        [{ port: 3000 }, { port: 8080 }],
        [{ port: 8080 }, { port: 3000 }],
      ),
    ).toBe(true);
  });

  test("different lengths return false", () => {
    expect(
      samePortSet([{ port: 3000 }], [{ port: 3000 }, { port: 8080 }]),
    ).toBe(false);
  });

  test("duplicate ports within one side do not affect equality when the other side has them too", () => {
    // Both sides collapse to {3000} — but samePortSet doesn't dedupe;
    // it compares lengths first. Dupes on one side fail the length
    // check even if the distinct set matches.
    expect(
      samePortSet([{ port: 3000 }], [{ port: 3000 }, { port: 3000 }]),
    ).toBe(false);
  });

  test("both empty arrays are equal", () => {
    expect(samePortSet([], [])).toBe(true);
  });
});

// ------------------------------------------------------------------
// buildSidebarWorkspaces
// ------------------------------------------------------------------

describe("buildSidebarWorkspaces", () => {
  test("returns one WorkspaceInfo per workspace, in order", () => {
    const input = baseInput({
      workspaces: [
        mkWorkspace("ws:1", "first", ["s1"]),
        mkWorkspace("ws:2", "second", ["s2"]),
      ],
      surfaces: new Map([
        ["s1", { title: "S1" }],
        ["s2", { title: "S2" }],
      ]),
      activeWorkspaceIndex: 1,
    });
    const result = buildSidebarWorkspaces(input);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("ws:1");
    expect(result[1].id).toBe("ws:2");
    // active flag matches activeWorkspaceIndex.
    expect(result[0].active).toBe(false);
    expect(result[1].active).toBe(true);
  });

  test("surfaceTitles come from the surfaces map; unknown ids fall back to the id", () => {
    const input = baseInput({
      workspaces: [mkWorkspace("ws:1", "w", ["s1", "s2"])],
      surfaces: new Map([["s1", { title: "Named" }]]),
    });
    input.workspaces[0].layout.splitSurface("s1", "horizontal", "s2");
    const [row] = buildSidebarWorkspaces(input);
    expect(row.surfaceTitles).toEqual(["Named", "s2"]);
  });

  test("focusedSurfaceTitle uses the focused surface when it belongs to the workspace", () => {
    const input = baseInput({
      workspaces: [mkWorkspace("ws:1", "w", ["s1", "s2"])],
      surfaces: new Map([
        ["s1", { title: "S1" }],
        ["s2", { title: "S2" }],
      ]),
      focusedSurfaceId: "s2",
    });
    input.workspaces[0].layout.splitSurface("s1", "horizontal", "s2");
    const [row] = buildSidebarWorkspaces(input);
    expect(row.focusedSurfaceTitle).toBe("S2");
  });

  test("focusedSurfaceTitle falls back to the first pane when focus belongs to another workspace", () => {
    const input = baseInput({
      workspaces: [mkWorkspace("ws:1", "w", ["s1"])],
      surfaces: new Map([
        ["s1", { title: "S1" }],
        ["s99", { title: "Other" }],
      ]),
      focusedSurfaceId: "s99",
    });
    const [row] = buildSidebarWorkspaces(input);
    expect(row.focusedSurfaceTitle).toBe("S1");
  });

  test("listeningPorts unions across all surfaces and is sorted", () => {
    const input = baseInput({
      workspaces: [mkWorkspace("ws:1", "w", ["s1", "s2"])],
      metadata: new Map([
        [
          "s1",
          mkMeta({
            listeningPorts: [
              { port: 8080, pid: 1, proto: "tcp", address: "127.0.0.1" },
              { port: 3000, pid: 1, proto: "tcp", address: "127.0.0.1" },
            ],
          }),
        ],
        [
          "s2",
          mkMeta({
            listeningPorts: [
              { port: 3000, pid: 2, proto: "tcp", address: "127.0.0.1" },
              { port: 5000, pid: 2, proto: "tcp", address: "127.0.0.1" },
            ],
          }),
        ],
      ]),
    });
    input.workspaces[0].layout.splitSurface("s1", "horizontal", "s2");
    const [row] = buildSidebarWorkspaces(input);
    expect(row.listeningPorts).toEqual([3000, 5000, 8080]);
  });

  test("focusedSurfaceCommand shows foreground command only when it differs from the shell", () => {
    const shellOnly = baseInput({
      workspaces: [mkWorkspace("ws:1", "w", ["s1"])],
      focusedSurfaceId: "s1",
      metadata: new Map([
        [
          "s1",
          mkMeta({
            pid: 100,
            foregroundPid: 100, // same as shell pid → no fg command
            tree: [{ pid: 100, ppid: 1, command: "zsh", cpu: 0, rssKb: 0 }],
          }),
        ],
      ]),
    });
    expect(
      buildSidebarWorkspaces(shellOnly)[0].focusedSurfaceCommand,
    ).toBeNull();

    const withFg = baseInput({
      workspaces: [mkWorkspace("ws:1", "w", ["s1"])],
      focusedSurfaceId: "s1",
      metadata: new Map([
        [
          "s1",
          mkMeta({
            pid: 100,
            foregroundPid: 200,
            tree: [
              { pid: 100, ppid: 1, command: "zsh", cpu: 0, rssKb: 0 },
              {
                pid: 200,
                ppid: 100,
                command: "bun run dev",
                cpu: 0.4,
                rssKb: 0,
              },
            ],
          }),
        ],
      ]),
    });
    expect(buildSidebarWorkspaces(withFg)[0].focusedSurfaceCommand).toBe(
      "bun run dev",
    );
  });

  test("distinct cwds are collected across panes in order; dupes are dropped", () => {
    const input = baseInput({
      workspaces: [mkWorkspace("ws:1", "w", ["s1", "s2", "s3"])],
      metadata: new Map([
        ["s1", mkMeta({ cwd: "/a" })],
        ["s2", mkMeta({ cwd: "/b" })],
        ["s3", mkMeta({ cwd: "/a" })],
      ]),
    });
    input.workspaces[0].layout.splitSurface("s1", "horizontal", "s2");
    input.workspaces[0].layout.splitSurface("s2", "vertical", "s3");
    const [row] = buildSidebarWorkspaces(input);
    expect(row.cwds).toEqual(["/a", "/b"]);
  });

  test("stale selectedCwds pin is pruned when no pane holds that cwd", () => {
    const selectedCwds = new Map([["ws:1", "/stale"]]);
    const input = baseInput({
      workspaces: [mkWorkspace("ws:1", "w", ["s1"])],
      metadata: new Map([["s1", mkMeta({ cwd: "/live" })]]),
      focusedSurfaceId: "s1",
      selectedCwds,
    });
    const [row] = buildSidebarWorkspaces(input);
    expect(row.selectedCwd).toBe("/live");
    expect(selectedCwds.has("ws:1")).toBe(false);
  });

  test("valid selectedCwds pin overrides focused surface's cwd", () => {
    const selectedCwds = new Map([["ws:1", "/pinned"]]);
    const input = baseInput({
      workspaces: [mkWorkspace("ws:1", "w", ["s1", "s2"])],
      metadata: new Map([
        ["s1", mkMeta({ cwd: "/pinned" })],
        ["s2", mkMeta({ cwd: "/live" })],
      ]),
      focusedSurfaceId: "s2",
      selectedCwds,
    });
    input.workspaces[0].layout.splitSurface("s1", "horizontal", "s2");
    const [row] = buildSidebarWorkspaces(input);
    expect(row.selectedCwd).toBe("/pinned");
    expect(selectedCwds.get("ws:1")).toBe("/pinned");
  });

  test("packageJson resolves from the surface whose cwd matches selectedCwd", () => {
    const pkg = {
      name: "demo",
      path: "/live/package.json",
      version: "1.0.0",
      scripts: { build: "echo", test: "echo" },
    };
    const input = baseInput({
      workspaces: [mkWorkspace("ws:1", "w", ["s1"])],
      metadata: new Map([["s1", mkMeta({ cwd: "/live", packageJson: pkg })]]),
      focusedSurfaceId: "s1",
    });
    const [row] = buildSidebarWorkspaces(input);
    expect(row.packageJson).toEqual(pkg);
  });

  test("runningScripts lists scripts detected in any pane's process tree", () => {
    const pkg = {
      name: "demo",
      path: "/live/package.json",
      version: "1.0.0",
      scripts: { build: "tsc", dev: "next", test: "vitest" },
    };
    const input = baseInput({
      workspaces: [mkWorkspace("ws:1", "w", ["s1", "s2"])],
      metadata: new Map([
        [
          "s1",
          mkMeta({
            cwd: "/live",
            packageJson: pkg,
            tree: [
              {
                pid: 1,
                ppid: 0,
                command: "bun run dev",
                cpu: 0,
                rssKb: 0,
              },
            ],
          }),
        ],
        [
          "s2",
          mkMeta({
            cwd: "/live",
            tree: [
              {
                pid: 2,
                ppid: 0,
                command: "npm run build",
                cpu: 0,
                rssKb: 0,
              },
            ],
          }),
        ],
      ]),
      focusedSurfaceId: "s1",
    });
    input.workspaces[0].layout.splitSurface("s1", "horizontal", "s2");
    const [row] = buildSidebarWorkspaces(input);
    expect(row.runningScripts.sort()).toEqual(["build", "dev"]);
  });

  test("erroredScripts fills from scriptErrors for non-running scripts", () => {
    const pkg = {
      name: "demo",
      path: "/live/package.json",
      version: "1.0.0",
      scripts: { build: "tsc", test: "vitest" },
    };
    const scriptErrors = new Map([["ws:1:test", Date.now()]]);
    const input = baseInput({
      workspaces: [mkWorkspace("ws:1", "w", ["s1"])],
      metadata: new Map([["s1", mkMeta({ cwd: "/live", packageJson: pkg })]]),
      focusedSurfaceId: "s1",
      scriptErrors,
    });
    const [row] = buildSidebarWorkspaces(input);
    expect(row.erroredScripts).toEqual(["test"]);
    expect(row.runningScripts).toEqual([]);
  });

  test("status pills + progress pass through unchanged", () => {
    const ws = mkWorkspace("ws:1", "w", ["s1"]);
    ws.status.set("branch", {
      value: "main",
      icon: "git-branch",
      color: "#fff",
    });
    ws.progress = { value: 42, label: "building" };
    const input = baseInput({ workspaces: [ws] });
    const [row] = buildSidebarWorkspaces(input);
    expect(row.statusPills).toEqual([
      { key: "branch", value: "main", icon: "git-branch", color: "#fff" },
    ]);
    expect(row.progress).toEqual({ value: 42, label: "building" });
  });
});
