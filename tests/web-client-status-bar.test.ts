import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Scope happy-dom to this file only. A global preload would clobber
// the bun:test runs for `tests/web-server*` which need Bun's native
// fetch + WebSocket.
beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

import { createStore, reducer, initialState } from "../src/web-client/store";
import type { AppState, Action } from "../src/web-client/store";
import { createStatusBarView } from "../src/web-client/status-bar";
import { pickWebSettings, DEFAULT_SETTINGS } from "../src/shared/settings";
import type { SurfaceMetadata } from "../src/shared/types";
import type { Snapshot } from "../src/shared/web-protocol";

function metadata(overrides: Partial<SurfaceMetadata> = {}): SurfaceMetadata {
  return {
    pid: 1,
    foregroundPid: 1,
    cwd: "/tmp",
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
    settings: pickWebSettings(DEFAULT_SETTINGS),
    htKeysSeen: [],
    ...overrides,
  };
}

function dispatchAll(actions: Action[]): AppState {
  let s = initialState();
  for (const a of actions) s = reducer(s, a);
  return s;
}

function makeHostStore(seed?: AppState) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const store = createStore(seed ?? dispatchAll([]));
  return { host, store };
}

describe("web-client status bar", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test("renders empty zones when no workspaces are present", () => {
    const { host, store } = makeHostStore();
    const view = createStatusBarView({ store, hostEl: host });
    view.render();
    expect(host.classList.contains("tau-status-bar")).toBe(true);
    const zones = host.querySelectorAll(".tau-status-zone");
    expect(zones.length).toBe(3);
    // Workspace key uses the "no workspace" fallback so identity zone
    // still has a child even when the snapshot is empty.
    expect(zones[0]!.textContent).toContain("no workspace");
    view.dispose();
  });

  test("identity zone shows workspace name + dot + pane count", () => {
    const seeded = dispatchAll([
      {
        kind: "snapshot/apply",
        snapshot: snapshotWith({
          surfaces: [
            { id: "s1", title: "zsh", cols: 80, rows: 24 },
            { id: "s2", title: "bun", cols: 80, rows: 24 },
          ],
          workspaces: [
            {
              id: "w1",
              name: "alpha",
              color: "#89b4fa",
              surfaceIds: ["s1", "s2"],
              focusedSurfaceId: "s1",
              layout: { type: "leaf", surfaceId: "s1" },
            },
          ],
          activeWorkspaceId: "w1",
          focusedSurfaceId: "s1",
        }),
      },
    ]);
    const { host, store } = makeHostStore(seeded);
    const view = createStatusBarView({ store, hostEl: host });
    view.render();
    const identity = host.querySelector(".tau-status-zone-identity");
    expect(identity).not.toBeNull();
    expect(identity!.textContent).toContain("alpha");
    expect(identity!.textContent).toContain("2"); // pane count
    expect(identity!.querySelector(".tau-status-dot")).not.toBeNull();
    view.dispose();
  });

  test("meters zone aggregates CPU + RSS across workspace surfaces", () => {
    const seeded = dispatchAll([
      {
        kind: "snapshot/apply",
        snapshot: snapshotWith({
          surfaces: [
            { id: "s1", title: "p1", cols: 80, rows: 24 },
            { id: "s2", title: "p2", cols: 80, rows: 24 },
          ],
          workspaces: [
            {
              id: "w",
              name: "build",
              color: "#a1a1aa",
              surfaceIds: ["s1", "s2"],
              focusedSurfaceId: "s1",
              layout: { type: "leaf", surfaceId: "s1" },
            },
          ],
          activeWorkspaceId: "w",
          focusedSurfaceId: "s1",
          metadata: {
            s1: metadata({
              tree: [
                {
                  pid: 1,
                  ppid: 0,
                  command: "/bin/zsh",
                  cpu: 25,
                  rssKb: 1024 * 200,
                },
              ],
            }),
            s2: metadata({
              tree: [
                {
                  pid: 2,
                  ppid: 0,
                  command: "node",
                  cpu: 10,
                  rssKb: 1024 * 100,
                },
              ],
            }),
          },
        }),
      },
    ]);
    const { host, store } = makeHostStore(seeded);
    const view = createStatusBarView({ store, hostEl: host });
    view.render();
    const meters = host.querySelector(".tau-status-zone-meters")!;
    const meterEls = meters.querySelectorAll(".tau-meter-wrap");
    expect(meterEls.length).toBe(2); // cpu + mem
    // CPU aggregates 25 + 10 = 35%; the meter value text shows the
    // rounded percent. mem 200 + 100 = 300 MiB shown as "300M".
    expect(meters.textContent).toContain("35%");
    expect(meters.textContent).toContain("300M");
    view.dispose();
  });

  test("focus zone hides when no surface is focused", () => {
    const seeded = dispatchAll([
      {
        kind: "snapshot/apply",
        snapshot: snapshotWith({
          surfaces: [{ id: "s1", title: "zsh", cols: 80, rows: 24 }],
          workspaces: [
            {
              id: "w",
              name: "ws",
              color: "#aaa",
              surfaceIds: ["s1"],
              focusedSurfaceId: null,
              layout: { type: "leaf", surfaceId: "s1" },
            },
          ],
          activeWorkspaceId: "w",
          focusedSurfaceId: null,
        }),
      },
    ]);
    const { host, store } = makeHostStore(seeded);
    const view = createStatusBarView({ store, hostEl: host });
    view.render();
    const focus = host.querySelector(".tau-status-zone-focus")!;
    // fg + cwd render their "—" placeholder when no focus; branch
    // returns null so it's silently skipped. Confirm "—" appears at
    // least once and the zone has the kv elements.
    expect(focus.textContent).toContain("—");
    view.dispose();
  });

  test("ht-all key respects htStatusKeyOrder", () => {
    const seeded = dispatchAll([
      {
        kind: "snapshot/apply",
        snapshot: snapshotWith({
          surfaces: [{ id: "s1", title: "zsh", cols: 80, rows: 24 }],
          workspaces: [
            {
              id: "w",
              name: "ws",
              color: "#aaa",
              surfaceIds: ["s1"],
              focusedSurfaceId: "s1",
              layout: { type: "leaf", surfaceId: "s1" },
            },
          ],
          activeWorkspaceId: "w",
          focusedSurfaceId: "s1",
          status: {
            w: {
              build: { value: "passing" },
              deploy: { value: "ready" },
            },
          },
          settings: pickWebSettings({
            ...DEFAULT_SETTINGS,
            // User pinned `deploy` first, then `build`.
            htStatusKeyOrder: ["deploy", "build"],
          }),
        }),
      },
    ]);
    const { host, store } = makeHostStore(seeded);
    // Override the focus zone so we render `ht-all` directly — the
    // default zones don't include it; this exercises the `zones`
    // override path while testing the registry.
    const view = createStatusBarView({
      store,
      hostEl: host,
      zones: { identity: ["workspace"], meters: [], focus: ["ht-all"] },
    });
    view.render();
    const focus = host.querySelector(".tau-status-zone-focus")!;
    const text = focus.textContent ?? "";
    const dIdx = text.indexOf("deploy");
    const bIdx = text.indexOf("build");
    expect(dIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThan(dIdx);
    view.dispose();
  });

  test("dispose tears down clock + subscription, removes class + children", () => {
    const { host, store } = makeHostStore();
    const view = createStatusBarView({ store, hostEl: host });
    view.render();
    expect(host.classList.contains("tau-status-bar")).toBe(true);
    expect(host.children.length).toBeGreaterThan(0);
    view.dispose();
    expect(host.classList.contains("tau-status-bar")).toBe(false);
    expect(host.children.length).toBe(0);
    // Subsequent store dispatches must NOT cause the bar to repaint.
    store.dispatch({
      kind: "ht-keys-seen",
      keys: ["after-dispose"],
    });
    expect(host.children.length).toBe(0);
  });
});
