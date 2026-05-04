import { describe, expect, mock, test } from "bun:test";
import {
  createSocketActionDispatcher,
  SOCKET_ACTION_NAMES,
  type SocketActionContext,
} from "../src/views/terminal/socket-actions";

function makeCtx(): {
  ctx: SocketActionContext;
  rpc: ReturnType<typeof mock>;
  sm: Record<string, ReturnType<typeof mock>>;
  onComplete: ReturnType<typeof mock>;
} {
  const sm: Record<string, ReturnType<typeof mock>> = {};
  const methods = [
    "focusWorkspaceById",
    "closeWorkspaceById",
    "renameWorkspace",
    "renameSurface",
    "setWorkspaceColor",
    "nextWorkspace",
    "prevWorkspace",
    "focusSurface",
    "getSurfaceTitle",
    "getActiveSurfaceId",
    "setStatus",
    "clearStatus",
    "setProgress",
    "clearProgress",
    "addLog",
    "getSidebar",
    "clearGlow",
    "notifyGlow",
    "readScreen",
    "browserNavigateTo",
    "browserGoBack",
    "browserGoForward",
    "browserReload",
    "browserEvalJs",
    "browserFindInPage",
    "browserStopFind",
    "browserToggleDevTools",
    "browserGetCookies",
    "addAgentSurfaceAsSplit",
    "addAgentSurface",
    "handleAgentEvent",
    "removeAgentSurface",
  ];
  for (const m of methods) sm[m] = mock(() => "");
  // readScreen returns a string; getSidebar returns a small stub
  sm["readScreen"] = mock(() => "<screen content>");
  const setNotifications = mock(() => {});
  sm["getSidebar"] = mock(() => ({ setNotifications }));

  const rpc = mock(() => {});
  const onComplete = mock(() => {});
  const ctx = {
    surfaceManager: sm as unknown as SocketActionContext["surfaceManager"],
    rpc: { send: rpc },
    toggleSidebar: mock(() => {}),
    openCommandPalette: mock(() => {}),
    toggleProcessManager: mock(() => {}),
    openSettings: mock(() => {}),
    copySelection: mock(() => {}),
    pasteClipboard: mock(() => {}),
    selectAll: mock(() => {}),
    promptRenameWorkspace: mock(() => {}),
    promptRenameSurface: mock(() => {}),
    setSidebarVisibleProgrammatic: mock(() => {}),
    onActionComplete: onComplete,
  } as SocketActionContext;
  return { ctx, rpc, sm, onComplete };
}

describe("SOCKET_ACTION_NAMES", () => {
  test("includes the core workspace + surface actions", () => {
    const names = new Set(SOCKET_ACTION_NAMES);
    expect(names.has("selectWorkspace")).toBe(true);
    expect(names.has("closeWorkspace")).toBe(true);
    expect(names.has("renameWorkspace")).toBe(true);
    expect(names.has("focusSurface")).toBe(true);
    expect(names.has("showToast")).toBe(true);
  });

  test("includes browser.* namespaced actions", () => {
    const names = SOCKET_ACTION_NAMES.filter((n) => n.startsWith("browser."));
    expect(names).toContain("browser.navigateTo");
    expect(names).toContain("browser.goBack");
    expect(names).toContain("browser.evalJs");
  });

  test("includes agent surface lifecycle actions", () => {
    expect(SOCKET_ACTION_NAMES).toContain("agentSurfaceCreated");
    expect(SOCKET_ACTION_NAMES).toContain("agentEvent");
    expect(SOCKET_ACTION_NAMES).toContain("agentSurfaceClosed");
  });
});

describe("createSocketActionDispatcher", () => {
  test("invokes onActionComplete on every dispatch", () => {
    const { ctx, onComplete } = makeCtx();
    const dispatch = createSocketActionDispatcher(ctx);
    dispatch("selectWorkspace", { workspaceId: "ws1" });
    dispatch("bogusAction", {});
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  test("unknown actions are silently ignored", () => {
    const { ctx, rpc } = makeCtx();
    const dispatch = createSocketActionDispatcher(ctx);
    expect(() => dispatch("no-such-action", { x: 1 })).not.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  test("selectWorkspace routes to focusWorkspaceById", () => {
    const { ctx, sm } = makeCtx();
    const dispatch = createSocketActionDispatcher(ctx);
    dispatch("selectWorkspace", { workspaceId: "ws1" });
    expect(sm["focusWorkspaceById"]).toHaveBeenCalledWith("ws1");
  });

  test("selectWorkspace without id is a no-op", () => {
    const { ctx, sm } = makeCtx();
    const dispatch = createSocketActionDispatcher(ctx);
    dispatch("selectWorkspace", {});
    expect(sm["focusWorkspaceById"]).not.toHaveBeenCalled();
  });

  test("renameWorkspace requires both id and name", () => {
    const { ctx, sm } = makeCtx();
    const dispatch = createSocketActionDispatcher(ctx);
    dispatch("renameWorkspace", { workspaceId: "ws1" });
    expect(sm["renameWorkspace"]).not.toHaveBeenCalled();
    dispatch("renameWorkspace", { workspaceId: "ws1", name: "Hi" });
    expect(sm["renameWorkspace"]).toHaveBeenCalledWith("ws1", "Hi");
  });

  test("toggleSidebar forwards to context", () => {
    const { ctx } = makeCtx();
    const dispatch = createSocketActionDispatcher(ctx);
    dispatch("toggleSidebar", {});
    expect(ctx.toggleSidebar).toHaveBeenCalled();
  });

  test("setSidebar passes visible to programmatic helper", () => {
    const { ctx } = makeCtx();
    const dispatch = createSocketActionDispatcher(ctx);
    dispatch("setSidebar", { visible: true });
    expect(ctx.setSidebarVisibleProgrammatic).toHaveBeenCalledWith(true);
  });

  test("readScreen sends rpc response with content", () => {
    const { ctx, rpc } = makeCtx();
    const dispatch = createSocketActionDispatcher(ctx);
    dispatch("readScreen", { surfaceId: "s1", reqId: "r1", lines: 20 });
    expect(rpc).toHaveBeenCalledWith("readScreenResponse", {
      reqId: "r1",
      content: "<screen content>",
    });
  });

  test("readScreen falls back to active surface id", () => {
    const { ctx, sm } = makeCtx();
    sm["getActiveSurfaceId"] = mock(() => "active-id");
    ctx.surfaceManager = sm as any;
    const dispatch = createSocketActionDispatcher(ctx);
    dispatch("readScreen", { reqId: "r1" });
    expect(sm["readScreen"]).toHaveBeenCalledWith(
      "active-id",
      undefined,
      undefined,
    );
  });

  test("browser.navigateTo forwards to surfaceManager", () => {
    const { ctx, sm } = makeCtx();
    const dispatch = createSocketActionDispatcher(ctx);
    dispatch("browser.navigateTo", {
      surfaceId: "s1",
      url: "https://example.com",
    });
    expect(sm["browserNavigateTo"]).toHaveBeenCalledWith(
      "s1",
      "https://example.com",
    );
  });

  test("browser.navigateTo without url is a no-op", () => {
    const { ctx, sm } = makeCtx();
    const dispatch = createSocketActionDispatcher(ctx);
    dispatch("browser.navigateTo", { surfaceId: "s1" });
    expect(sm["browserNavigateTo"]).not.toHaveBeenCalled();
  });

  test("agentSurfaceCreated without splitFrom uses addAgentSurface", () => {
    const { ctx, sm } = makeCtx();
    const dispatch = createSocketActionDispatcher(ctx);
    dispatch("agentSurfaceCreated", { surfaceId: "s1", agentId: "a1" });
    expect(sm["addAgentSurface"]).toHaveBeenCalledWith("s1", "a1");
    expect(sm["addAgentSurfaceAsSplit"]).not.toHaveBeenCalled();
  });

  test("agentSurfaceCreated with splitFrom + direction uses addAgentSurfaceAsSplit", () => {
    const { ctx, sm } = makeCtx();
    const dispatch = createSocketActionDispatcher(ctx);
    dispatch("agentSurfaceCreated", {
      surfaceId: "s1",
      agentId: "a1",
      splitFrom: "s2",
      direction: "horizontal",
    });
    expect(sm["addAgentSurfaceAsSplit"]).toHaveBeenCalledWith(
      "s1",
      "a1",
      "s2",
      "horizontal",
    );
  });

  test("agentSurfaceCreated ignored when surfaceId or agentId missing", () => {
    const { ctx, sm } = makeCtx();
    const dispatch = createSocketActionDispatcher(ctx);
    dispatch("agentSurfaceCreated", { surfaceId: "s1" });
    expect(sm["addAgentSurface"]).not.toHaveBeenCalled();
  });

  test("notification clears glow when list is empty", () => {
    const { ctx, sm } = makeCtx();
    const dispatch = createSocketActionDispatcher(ctx);
    dispatch("notification", { notifications: [] });
    expect(sm["clearGlow"]).toHaveBeenCalled();
  });

  test("notification with entries triggers glow on source surface", () => {
    const { ctx, sm } = makeCtx();
    const dispatch = createSocketActionDispatcher(ctx);
    dispatch("notification", {
      notifications: [{ id: "n1", title: "Hi", body: "", time: 0 }],
      surfaceId: "s2",
    });
    expect(sm["notifyGlow"]).toHaveBeenCalledWith("s2");
  });

  // Regression — when a single notification is dismissed server-side,
  // the broadcast carries `dismissed` + the dismissed entry's
  // `surfaceId` (it's no longer in the post-dismiss `notifications`
  // list). The dispatcher must route to `notificationOverlay.dismiss`
  // using the top-level `surfaceId`, NOT a list-lookup.
  test("notification with `dismissed` routes overlay.dismiss using payload surfaceId", () => {
    const { ctx, sm } = makeCtx();
    const overlayDismiss = mock(() => {});
    const overlayDismissAll = mock(() => {});
    ctx.notificationOverlay = {
      show: mock(() => {}),
      dismiss: overlayDismiss,
      dismissAll: overlayDismissAll,
      forgetSurface: mock(() => {}),
      setOptions: mock(() => {}),
      destroy: mock(() => {}),
    } as unknown as NonNullable<SocketActionContext["notificationOverlay"]>;

    const dispatch = createSocketActionDispatcher(ctx);
    // Two notifications existed; one (n1, surface:7) was just dismissed.
    // Server's broadcast includes the dismissed id and the source
    // surface, but the dismissed entry is NOT in the list anymore.
    dispatch("notification", {
      dismissed: "n1",
      surfaceId: "s7",
      notifications: [{ id: "n2", title: "kept", body: "", time: 0 }],
    });
    expect(overlayDismiss).toHaveBeenCalledWith("s7", "n1");
    // Stack still has n2 → no global wipe.
    expect(overlayDismissAll).not.toHaveBeenCalled();
    expect(sm["clearGlow"]).not.toHaveBeenCalled();
  });

  test("notification with `dismissed` and surfaceId on the kept entry routes via list match", () => {
    // Edge case — when the same surface still has another live
    // notification in the list, the dispatcher's first-choice path
    // (find dismissed in list) won't match (the dismissed entry was
    // spliced out); it must still fall back to the top-level
    // `surfaceId` to hit the right per-surface stack.
    const { ctx } = makeCtx();
    const overlayDismiss = mock(() => {});
    ctx.notificationOverlay = {
      show: mock(() => {}),
      dismiss: overlayDismiss,
      dismissAll: mock(() => {}),
      forgetSurface: mock(() => {}),
      setOptions: mock(() => {}),
      destroy: mock(() => {}),
    } as unknown as NonNullable<SocketActionContext["notificationOverlay"]>;
    const dispatch = createSocketActionDispatcher(ctx);

    dispatch("notification", {
      dismissed: "n1",
      surfaceId: "s7",
      notifications: [
        { id: "n2", title: "still on s7", body: "", time: 0, surfaceId: "s7" },
      ],
    });
    expect(overlayDismiss).toHaveBeenCalledTimes(1);
    expect(overlayDismiss).toHaveBeenCalledWith("s7", "n1");
  });

  test("empty notifications list dismissAll's the overlay", () => {
    const { ctx, sm } = makeCtx();
    const overlayDismissAll = mock(() => {});
    ctx.notificationOverlay = {
      show: mock(() => {}),
      dismiss: mock(() => {}),
      dismissAll: overlayDismissAll,
      forgetSurface: mock(() => {}),
      setOptions: mock(() => {}),
      destroy: mock(() => {}),
    } as unknown as NonNullable<SocketActionContext["notificationOverlay"]>;
    const dispatch = createSocketActionDispatcher(ctx);

    dispatch("notification", { notifications: [] });
    expect(overlayDismissAll).toHaveBeenCalledTimes(1);
    expect(sm["clearGlow"]).toHaveBeenCalled();
  });
});
