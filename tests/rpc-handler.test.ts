import { describe, test, expect, afterEach } from "bun:test";
import { SessionManager } from "../src/bun/session-manager";
import {
  createRpcHandler,
  type AppState,
  type WorkspaceSnapshot,
} from "../src/bun/rpc-handler";

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    focusedSurfaceId: "surface:1",
    workspaces: [
      {
        id: "ws:1",
        name: "Test",
        color: "#89b4fa",
        surfaceIds: ["surface:1"],
        focusedSurfaceId: "surface:1",
        layout: { type: "leaf", surfaceId: "surface:1" },
      },
    ],
    activeWorkspaceId: "ws:1",
    ...overrides,
  };
}

describe("RPC Handler", () => {
  let sessions: SessionManager;
  let dispatched: { action: string; payload: Record<string, unknown> }[];

  afterEach(() => {
    sessions?.destroy();
  });

  function setup(stateOverrides: Partial<AppState> = {}) {
    sessions = new SessionManager("/bin/sh");
    dispatched = [];
    const state = makeState(stateOverrides);
    const handler = createRpcHandler(
      sessions,
      () => state,
      (action, payload) => dispatched.push({ action, payload }),
    );
    return handler;
  }

  // ── System ──

  test("system.ping returns PONG", () => {
    const handler = setup();
    expect(handler("system.ping", {})).toBe("PONG");
  });

  test("system.version returns version string", () => {
    const handler = setup();
    const result = handler("system.version", {}) as string;
    expect(result).toContain("tau-mux");
  });

  test("system.identify returns focused state", () => {
    const handler = setup();
    const result = handler("system.identify", {}) as Record<string, unknown>;
    expect(result["focused_surface"]).toBe("surface:1");
    expect(result["active_workspace"]).toBe("ws:1");
    // Default fallback when no socketPath option is wired (test fixtures
    // commonly omit it). Production callers must always pass the bound
    // path; that branch is covered by the next test.
    expect(result["socket_path"]).toBe("/tmp/hyperterm.sock");
    expect(result["log_path"]).toBeNull();
  });

  test("system.identify reports the socket_path passed via options", () => {
    sessions = new SessionManager("/bin/sh");
    const state = makeState();
    const handler = createRpcHandler(
      sessions,
      () => state,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        socketPath: "/var/run/custom.sock",
        logPath: "/var/log/custom.log",
      },
    );
    const result = handler("system.identify", {}) as Record<string, unknown>;
    expect(result["socket_path"]).toBe("/var/run/custom.sock");
    expect(result["log_path"]).toBe("/var/log/custom.log");
  });

  test("system.capabilities returns method list", () => {
    const handler = setup();
    const result = handler("system.capabilities", {}) as {
      methods: string[];
    };
    expect(result.methods).toContain("system.ping");
    expect(result.methods).toContain("workspace.list");
    expect(result.methods).toContain("surface.list");
    expect(result.methods).toContain("surface.screenshot");
    expect(result.methods).toContain("notification.create");
    expect(result.methods).toContain("notification.dismiss");
    expect(result.methods.length).toBeGreaterThan(20);
  });

  test("system.tree returns workspace tree", () => {
    const handler = setup();
    sessions.createSurface(80, 24);
    const result = handler("system.tree", {}) as unknown[];
    expect(result.length).toBe(1);
  });

  // ── Workspaces ──

  test("workspace.list returns workspaces", () => {
    const handler = setup();
    const result = handler("workspace.list", {}) as unknown[];
    expect(result.length).toBe(1);
    expect((result[0] as Record<string, unknown>)["name"]).toBe("Test");
    expect((result[0] as Record<string, unknown>)["active"]).toBe(true);
  });

  test("workspace.current returns active workspace", () => {
    const handler = setup();
    const result = handler("workspace.current", {}) as WorkspaceSnapshot;
    expect(result.id).toBe("ws:1");
    expect(result.name).toBe("Test");
  });

  test("workspace.current returns null when no workspaces", () => {
    const handler = setup({ workspaces: [], activeWorkspaceId: null });
    const result = handler("workspace.current", {});
    expect(result).toBeNull();
  });

  test("workspace.create dispatches createSurface", () => {
    const handler = setup();
    handler("workspace.create", { cwd: "/tmp" });
    expect(dispatched.length).toBe(1);
    expect(dispatched[0].action).toBe("createSurface");
    expect(dispatched[0].payload["cwd"]).toBe("/tmp");
  });

  test("workspace.select dispatches selectWorkspace", () => {
    const handler = setup();
    handler("workspace.select", { workspace_id: "ws:2" });
    expect(dispatched[0].action).toBe("selectWorkspace");
    expect(dispatched[0].payload["workspaceId"]).toBe("ws:2");
  });

  test("workspace.close dispatches closeWorkspace", () => {
    const handler = setup();
    handler("workspace.close", { workspace: "ws:1" });
    expect(dispatched[0].action).toBe("closeWorkspace");
  });

  test("workspace.rename dispatches renameWorkspace", () => {
    const handler = setup();
    handler("workspace.rename", { workspace_id: "ws:1", name: "NewName" });
    expect(dispatched[0].action).toBe("renameWorkspace");
    expect(dispatched[0].payload["name"]).toBe("NewName");
  });

  test("workspace.next dispatches nextWorkspace", () => {
    const handler = setup();
    handler("workspace.next", {});
    expect(dispatched[0].action).toBe("nextWorkspace");
  });

  test("workspace.previous dispatches prevWorkspace", () => {
    const handler = setup();
    handler("workspace.previous", {});
    expect(dispatched[0].action).toBe("prevWorkspace");
  });

  // ── Surfaces ──

  test("surface.list returns all surfaces", () => {
    const handler = setup();
    sessions.createSurface(80, 24);
    sessions.createSurface(80, 24);
    const result = handler("surface.list", {}) as unknown[];
    expect(result.length).toBe(2);
  });

  test("surface.split dispatches with correct direction", () => {
    const handler = setup();
    handler("surface.split", { direction: "right" });
    expect(dispatched[0].action).toBe("splitSurface");
    expect(dispatched[0].payload["direction"]).toBe("horizontal");

    handler("surface.split", { direction: "down" });
    expect(dispatched[1].payload["direction"]).toBe("vertical");
  });

  test("surface.close closes the surface", () => {
    const handler = setup();
    const id = sessions.createSurface(80, 24);
    expect(sessions.getSurface(id)).toBeDefined();
    handler("surface.close", { surface_id: id });
    expect(sessions.getSurface(id)).toBeUndefined();
  });

  test("surface.focus dispatches focusSurface", () => {
    const handler = setup();
    handler("surface.focus", { surface_id: "surface:5" });
    expect(dispatched[0].action).toBe("focusSurface");
    expect(dispatched[0].payload["surfaceId"]).toBe("surface:5");
  });

  test("surface.rename dispatches renameSurface", () => {
    const handler = setup();
    handler("surface.rename", { surface_id: "surface:5", name: "Server" });
    expect(dispatched[0].action).toBe("renameSurface");
    expect(dispatched[0].payload["surfaceId"]).toBe("surface:5");
    expect(dispatched[0].payload["title"]).toBe("Server");
  });

  test("surface.send_text writes to PTY", async () => {
    const handler = setup();
    let received = "";
    sessions.onStdout = (_, data) => {
      received += data;
    };
    const id = sessions.createSurface(80, 24);

    handler("surface.send_text", { surface_id: id, text: "echo HI\r" });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (received.includes("HI")) {
          clearInterval(check);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 3000);
    });

    expect(received).toContain("HI");
  });

  test("surface.send_key sends key sequences", () => {
    const handler = setup();
    const id = sessions.createSurface(80, 24);
    // Should not throw for valid keys
    expect(() =>
      handler("surface.send_key", { surface_id: id, key: "enter" }),
    ).not.toThrow();
    expect(() =>
      handler("surface.send_key", { surface_id: id, key: "tab" }),
    ).not.toThrow();
    expect(() =>
      handler("surface.send_key", { surface_id: id, key: "escape" }),
    ).not.toThrow();
  });

  // ── Sidebar ──

  test("sidebar.set_status dispatches setStatus", () => {
    const handler = setup();
    handler("sidebar.set_status", {
      key: "build",
      value: "ok",
      color: "#a6e3a1",
    });
    expect(dispatched[0].action).toBe("setStatus");
    expect(dispatched[0].payload["key"]).toBe("build");
    expect(dispatched[0].payload["value"]).toBe("ok");
  });

  test("sidebar.clear_status dispatches clearStatus", () => {
    const handler = setup();
    handler("sidebar.clear_status", { key: "build" });
    expect(dispatched[0].action).toBe("clearStatus");
  });

  test("sidebar.set_progress dispatches setProgress", () => {
    const handler = setup();
    handler("sidebar.set_progress", { value: 0.5, label: "Building" });
    expect(dispatched[0].action).toBe("setProgress");
    expect(dispatched[0].payload["value"]).toBe(0.5);
  });

  test("sidebar.clear_progress dispatches clearProgress", () => {
    const handler = setup();
    handler("sidebar.clear_progress", {});
    expect(dispatched[0].action).toBe("clearProgress");
  });

  test("sidebar.log dispatches log", () => {
    const handler = setup();
    handler("sidebar.log", {
      level: "error",
      message: "fail",
      source: "build",
    });
    expect(dispatched[0].action).toBe("log");
    expect(dispatched[0].payload["level"]).toBe("error");
    expect(dispatched[0].payload["message"]).toBe("fail");
  });

  test("sidebar.set_status resolves workspaceId from surface_id when missing", () => {
    const handler = setup({
      workspaces: [
        {
          id: "ws:A",
          name: "A",
          color: "#89b4fa",
          surfaceIds: ["surface:1"],
          focusedSurfaceId: "surface:1",
          layout: { type: "leaf", surfaceId: "surface:1" },
        },
        {
          id: "ws:B",
          name: "B",
          color: "#f5c2e7",
          surfaceIds: ["surface:2"],
          focusedSurfaceId: "surface:2",
          layout: { type: "leaf", surfaceId: "surface:2" },
        },
      ],
      activeWorkspaceId: "ws:A",
    });
    // Script running in ws:B calls ht set-status; only HT_SURFACE=surface:2
    // is available.
    handler("sidebar.set_status", {
      surface_id: "surface:2",
      key: "build",
      value: "ok",
    });
    expect(dispatched[0].payload["workspaceId"]).toBe("ws:B");
  });

  test("sidebar.set_status leaves workspaceId undefined when neither hint is present", () => {
    const handler = setup();
    handler("sidebar.set_status", { key: "build", value: "ok" });
    expect(dispatched[0].payload["workspaceId"]).toBeUndefined();
  });

  // ── Notifications ──

  test("notification.create stores and returns OK", () => {
    const handler = setup();
    const result = handler("notification.create", {
      title: "Build",
      body: "Done",
    });
    expect(result).toBe("OK");
    expect(dispatched.length).toBe(1);
    expect(dispatched[0].action).toBe("notification");
  });

  test("notification.list returns stored notifications", () => {
    const handler = setup();
    handler("notification.create", { title: "A", body: "1" });
    handler("notification.create", { title: "B", body: "2" });

    const result = handler("notification.list", {}) as unknown[];
    expect(result.length).toBe(2);
    expect((result[0] as Record<string, unknown>)["title"]).toBe("A");
    expect((result[1] as Record<string, unknown>)["title"]).toBe("B");
  });

  test("notification.clear empties notifications", () => {
    const handler = setup();
    handler("notification.create", { title: "X", body: "Y" });
    handler("notification.clear", {});

    const result = handler("notification.list", {}) as unknown[];
    expect(result.length).toBe(0);
  });

  test("notification.dismiss removes a single entry by id", () => {
    const handler = setup();
    handler("notification.create", { title: "A", body: "1" });
    handler("notification.create", { title: "B", body: "2" });
    handler("notification.create", { title: "C", body: "3" });

    const listed = handler("notification.list", {}) as Record<
      string,
      unknown
    >[];
    expect(listed.length).toBe(3);

    const middleId = listed[1]["id"] as string;
    const result = handler("notification.dismiss", { id: middleId });
    expect(result).toBe("OK");

    const after = handler("notification.list", {}) as Record<string, unknown>[];
    expect(after.length).toBe(2);
    expect(after.map((n) => n["title"])).toEqual(["A", "C"]);
  });

  test("notification.dismiss broadcasts the updated list", () => {
    const handler = setup();
    handler("notification.create", { title: "A", body: "1" });
    handler("notification.create", { title: "B", body: "2" });
    dispatched.length = 0; // drop the creates; keep only dismiss dispatch

    const listed = handler("notification.list", {}) as Record<
      string,
      unknown
    >[];
    handler("notification.dismiss", { id: listed[0]["id"] });

    expect(dispatched.length).toBe(1);
    expect(dispatched[0].action).toBe("notification");
    const remaining = dispatched[0].payload["notifications"] as unknown[];
    expect(remaining.length).toBe(1);
  });

  test("notification.dismiss is a no-op for unknown id", () => {
    const handler = setup();
    handler("notification.create", { title: "A", body: "1" });
    dispatched.length = 0;

    const result = handler("notification.dismiss", {
      id: "notif:does-not-exist",
    });
    expect(result).toBe("OK");
    // No rebroadcast when nothing changed — we don't want the webview
    // to rerender the whole notification list on misses.
    expect(dispatched.length).toBe(0);

    const listed = handler("notification.list", {}) as unknown[];
    expect(listed.length).toBe(1);
  });

  test("notification.dismiss with missing id is a no-op", () => {
    const handler = setup();
    handler("notification.create", { title: "A", body: "1" });
    dispatched.length = 0;

    expect(handler("notification.dismiss", {})).toBe("OK");
    expect(dispatched.length).toBe(0);
    expect((handler("notification.list", {}) as unknown[]).length).toBe(1);
  });

  // ── Panes ──

  test("pane.list returns surfaces in active workspace", () => {
    const handler = setup();
    const result = handler("pane.list", {}) as unknown[];
    expect(result.length).toBe(1);
    expect((result[0] as Record<string, unknown>)["surface_id"]).toBe(
      "surface:1",
    );
  });

  // ── Error handling ──

  test("unknown method throws error", () => {
    const handler = setup();
    expect(() => handler("nonexistent.method", {})).toThrow("Unknown method");
  });
});
