import { describe, test, expect } from "bun:test";
import {
  createStore,
  initialState,
  reducer,
  type Action,
  type AppState,
} from "../src/web-client/store";
import type { Snapshot } from "../src/shared/web-protocol";
import type { SurfaceMetadata } from "../src/shared/types";

function metadata(overrides: Partial<SurfaceMetadata> = {}): SurfaceMetadata {
  return {
    pid: 1,
    foregroundPid: 1,
    cwd: "/",
    tree: [],
    listeningPorts: [],
    git: null,
    packageJson: null,
    updatedAt: 0,
    ...overrides,
  };
}

function snapshotWith(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    nativeViewport: null,
    surfaces: [],
    workspaces: [],
    activeWorkspaceId: null,
    focusedSurfaceId: null,
    sidebarVisible: false,
    metadata: {},
    panels: {},
    notifications: [],
    logs: [],
    status: {},
    progress: {},
    ...overrides,
  };
}

function dispatchAll(actions: Action[]): AppState {
  let state = initialState();
  for (const a of actions) state = reducer(state, a);
  return state;
}

describe("web-client store / reducer", () => {
  test("snapshot/apply hydrates surfaces, panels, workspaces, sidebar", () => {
    const state = reducer(initialState(), {
      kind: "snapshot/apply",
      snapshot: snapshotWith({
        surfaces: [
          { id: "s1", title: "zsh", cols: 120, rows: 32 },
          { id: "s2", title: "bun", cols: 80, rows: 24 },
        ],
        workspaces: [
          {
            id: "w1",
            name: "alpha",
            color: "#89b4fa",
            surfaceIds: ["s1"],
            focusedSurfaceId: "s1",
            layout: { type: "leaf", surfaceId: "s1" },
          },
        ],
        activeWorkspaceId: "w1",
        focusedSurfaceId: "s1",
        sidebarVisible: true,
        metadata: { s1: metadata({ cwd: "/home/alice" }) },
        panels: {
          p1: {
            surfaceId: "s1",
            meta: { id: "p1", type: "image", format: "png" },
          },
        },
        notifications: [
          { id: "n1", title: "hi", body: "", surfaceId: "s1", at: 0 },
        ],
        logs: [{ level: "info", message: "boot", at: 0 }],
      }),
    });

    expect(state.surfaces["s1"]!.cols).toBe(120);
    expect(state.surfaces["s1"]!.metadata?.cwd).toBe("/home/alice");
    expect(state.surfaces["s2"]).toBeDefined();
    expect(state.workspaces.length).toBe(1);
    expect(state.activeWorkspaceId).toBe("w1");
    expect(state.focusedSurfaceId).toBe("s1");
    expect(state.sidebarVisible).toBe(true);
    expect(state.panels["p1"]!.surfaceId).toBe("s1");
    expect(state.sidebar.notifications.length).toBe(1);
    expect(state.sidebar.logs.length).toBe(1);
  });

  test("surface lifecycle: created -> renamed -> resized -> closed", () => {
    const state = dispatchAll([
      { kind: "surface/created", surfaceId: "s1", title: "zsh" },
      { kind: "surface/renamed", surfaceId: "s1", title: "build" },
      { kind: "surface/resized", surfaceId: "s1", cols: 200, rows: 60 },
      { kind: "surface/closed", surfaceId: "s1" },
    ]);
    expect(state.surfaces["s1"]).toBeUndefined();
  });

  test("surface/closed also clears panels belonging to that surface and focus/fullscreen", () => {
    let state = dispatchAll([
      { kind: "surface/created", surfaceId: "s1", title: "zsh" },
      { kind: "surface/created", surfaceId: "s2", title: "bun" },
      {
        kind: "panel/meta",
        surfaceId: "s1",
        meta: { id: "pa", type: "image" },
      },
      {
        kind: "panel/meta",
        surfaceId: "s2",
        meta: { id: "pb", type: "image" },
      },
      { kind: "focus/set", surfaceId: "s1" },
      { kind: "fullscreen/enter", surfaceId: "s1" },
    ]);
    expect(state.focusedSurfaceId).toBe("s1");
    expect(state.fullscreenSurfaceId).toBe("s1");
    state = reducer(state, { kind: "surface/closed", surfaceId: "s1" });
    expect(state.panels["pa"]).toBeUndefined();
    expect(state.panels["pb"]).toBeDefined();
    expect(state.focusedSurfaceId).toBeNull();
    expect(state.fullscreenSurfaceId).toBeNull();
  });

  test("surface/metadata stubs a surface if hello has not arrived yet", () => {
    const state = reducer(initialState(), {
      kind: "surface/metadata",
      surfaceId: "s1",
      metadata: metadata({ cwd: "/tmp" }),
    });
    expect(state.surfaces["s1"]).toBeDefined();
    expect(state.surfaces["s1"]!.metadata?.cwd).toBe("/tmp");
  });

  test("focus/set clears the per-surface glow", () => {
    let state = dispatchAll([
      { kind: "surface/created", surfaceId: "s1", title: "zsh" },
      {
        kind: "notification/add",
        entry: {
          id: "n1",
          title: "x",
          body: "",
          surfaceId: "s1",
          at: 0,
        },
      },
    ]);
    expect(state.glowingSurfaceIds).toContain("s1");
    state = reducer(state, { kind: "focus/set", surfaceId: "s1" });
    expect(state.glowingSurfaceIds).not.toContain("s1");
  });

  test("notification/clear wipes both notifications and glow", () => {
    let state = dispatchAll([
      {
        kind: "notification/add",
        entry: { id: "n1", title: "a", body: "", surfaceId: "s1", at: 0 },
      },
      {
        kind: "notification/add",
        entry: { id: "n2", title: "b", body: "", surfaceId: "s2", at: 0 },
      },
    ]);
    expect(state.sidebar.notifications.length).toBe(2);
    expect(state.glowingSurfaceIds.length).toBe(2);
    state = reducer(state, { kind: "notification/clear" });
    expect(state.sidebar.notifications.length).toBe(0);
    expect(state.glowingSurfaceIds.length).toBe(0);
  });

  test("sidebar/action routes log, status, progress", () => {
    let state = reducer(
      dispatchAll([{ kind: "workspace/active", workspaceId: "w1" }]),
      {
        kind: "sidebar/action",
        action: "log",
        payload: { level: "error", message: "oops" },
      },
    );
    expect(state.sidebar.logs.length).toBe(1);
    expect(state.sidebar.logs[0]!.level).toBe("error");

    state = reducer(state, {
      kind: "sidebar/action",
      action: "setStatus",
      payload: { workspaceId: "w1", key: "build", value: "running" },
    });
    expect(state.sidebar.status["w1"]!["build"]!.value).toBe("running");

    state = reducer(state, {
      kind: "sidebar/action",
      action: "setProgress",
      payload: { workspaceId: "w1", value: 42, label: "compiling" },
    });
    expect(state.sidebar.progress["w1"]!.value).toBe(42);

    state = reducer(state, {
      kind: "sidebar/action",
      action: "clearStatus",
      payload: { workspaceId: "w1", key: "build" },
    });
    expect(state.sidebar.status["w1"]!["build"]).toBeUndefined();

    state = reducer(state, {
      kind: "sidebar/action",
      action: "clearProgress",
      payload: { workspaceId: "w1" },
    });
    expect(state.sidebar.progress["w1"]).toBeUndefined();
  });

  test("panel/meta supports create, update, and clear", () => {
    let state = reducer(initialState(), {
      kind: "panel/meta",
      surfaceId: "s1",
      meta: { id: "p1", type: "image", x: 10, y: 20 },
    });
    expect(state.panels["p1"]!.meta.x).toBe(10);

    state = reducer(state, {
      kind: "panel/meta",
      surfaceId: "s1",
      meta: { id: "p1", type: "update", x: 99 },
    });
    expect(state.panels["p1"]!.meta.x).toBe(99);
    // The original type is preserved on update.
    expect(state.panels["p1"]!.meta.type).toBe("update");

    state = reducer(state, {
      kind: "panel/meta",
      surfaceId: "s1",
      meta: { id: "p1", type: "clear" },
    });
    expect(state.panels["p1"]).toBeUndefined();
  });

  test("panel/event close removes, dragend / resize update coords", () => {
    let state = reducer(initialState(), {
      kind: "panel/meta",
      surfaceId: "s1",
      meta: { id: "p1", type: "image", x: 0, y: 0 },
    });
    state = reducer(state, {
      kind: "panel/event",
      panelId: "p1",
      event: "dragend",
      x: 50,
      y: 60,
    });
    expect(state.panels["p1"]!.meta.x).toBe(50);
    expect(state.panels["p1"]!.meta.y).toBe(60);
    state = reducer(state, {
      kind: "panel/event",
      panelId: "p1",
      event: "resize",
      width: 400,
      height: 300,
    });
    expect(state.panels["p1"]!.meta.width).toBe(400);
    state = reducer(state, {
      kind: "panel/event",
      panelId: "p1",
      event: "close",
    });
    expect(state.panels["p1"]).toBeUndefined();
  });

  test("connection/seq never goes backwards", () => {
    let state = reducer(initialState(), { kind: "connection/seq", seq: 5 });
    expect(state.connection.lastSeenSeq).toBe(5);
    state = reducer(state, { kind: "connection/seq", seq: 3 });
    expect(state.connection.lastSeenSeq).toBe(5);
    state = reducer(state, { kind: "connection/seq", seq: 9 });
    expect(state.connection.lastSeenSeq).toBe(9);
  });

  test("connection/reset clears surfaces / panels / workspaces / connection", () => {
    let state = dispatchAll([
      { kind: "surface/created", surfaceId: "s1", title: "zsh" },
      {
        kind: "connection/hello",
        sessionId: "abc",
        serverInstanceId: "srv",
        lastSeenSeq: 4,
      },
    ]);
    state = reducer(state, { kind: "connection/reset" });
    expect(state.surfaces).toEqual({});
    expect(state.connection.sessionId).toBeNull();
    expect(state.connection.lastSeenSeq).toBe(-1);
  });

  test("createStore fires listeners on dispatch, not on no-op reduction", () => {
    const store = createStore();
    let fires = 0;
    const unsub = store.subscribe(() => {
      fires++;
    });
    // Subscribing fires once immediately.
    expect(fires).toBe(1);
    store.dispatch({ kind: "connection/seq", seq: 2 });
    expect(fires).toBe(2);
    // Lower seq — reducer returns the same state, no listener call.
    store.dispatch({ kind: "connection/seq", seq: 1 });
    expect(fires).toBe(2);
    unsub();
    store.dispatch({ kind: "connection/seq", seq: 3 });
    expect(fires).toBe(2);
  });
});
