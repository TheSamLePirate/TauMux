import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Scope happy-dom to this file so parser-level tests that rely on a
// Node global environment are unaffected.
beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

// Importing after happy-dom is registered ensures the DOM globals are
// present when the module defines any page-bound helpers.
async function loadSidebar() {
  return await import("../src/web-client/sidebar");
}

async function loadStore() {
  return await import("../src/web-client/store");
}

type SetupOpts = {
  sidebarVisible?: boolean;
  workspaces?: {
    id: string;
    name?: string;
    color?: string;
    surfaceIds?: string[];
  }[];
  activeWorkspaceId?: string | null;
  notifications?: { id: string; title: string; body?: string }[];
  logs?: { level?: string; message: string }[];
  status?: Record<string, Record<string, { value: string }>>;
  progress?: Record<string, { value: number }>;
};

async function setup(opts: SetupOpts = {}) {
  document.body.innerHTML = `
    <div id="sidebar"></div>
    <button id="sidebar-toggle"></button>
    <select id="workspace-select"></select>
  `;
  const sidebarEl = document.getElementById("sidebar") as HTMLElement;
  const sidebarToggleBtn = document.getElementById(
    "sidebar-toggle",
  ) as HTMLElement;
  const workspaceSelectEl = document.getElementById(
    "workspace-select",
  ) as HTMLSelectElement;

  const { createStore, initialState } = await loadStore();
  const seed = {
    ...initialState(),
    sidebarVisible: opts.sidebarVisible ?? true,
    workspaces: (opts.workspaces ?? []).map((w) => {
      const ids = w.surfaceIds ?? [];
      // Build a layout tree that contains every surfaceId so the
      // shared `buildSidebarWorkspaces` (and the M13 card builder
      // that consumes its output) reports the right pane count.
      const layout =
        ids.length === 0
          ? { type: "leaf" as const, surfaceId: "x" }
          : ids.length === 1
            ? { type: "leaf" as const, surfaceId: ids[0]! }
            : {
                type: "split" as const,
                direction: "horizontal" as const,
                children: ids.map((sid) => ({
                  type: "leaf" as const,
                  surfaceId: sid,
                })),
              };
      return {
        id: w.id,
        name: w.name ?? w.id,
        color: w.color ?? "#89b4fa",
        surfaceIds: ids,
        focusedSurfaceId: null,
        layout,
      };
    }),
    activeWorkspaceId: opts.activeWorkspaceId ?? null,
    sidebar: {
      notifications: (opts.notifications ?? []).map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body ?? "",
        time: 0,
      })),
      logs: (opts.logs ?? []).map((l, i) => ({
        id: String(i),
        level: l.level ?? "info",
        message: l.message,
        time: 0,
      })),
      status: opts.status ?? {},
      progress: opts.progress ?? {},
    },
  };
  const store = createStore(seed as any);
  const sendMsg = mock(() => {});
  const { createSidebarView } = await loadSidebar();
  const view = createSidebarView({
    store,
    sendMsg,
    sidebarEl,
    sidebarToggleBtn,
    workspaceSelectEl,
  });
  return {
    store,
    view,
    sendMsg,
    sidebarEl,
    sidebarToggleBtn,
    workspaceSelectEl,
  };
}

describe("escapeHtml", () => {
  test("escapes the five HTML-dangerous characters", async () => {
    const { escapeHtml } = await loadSidebar();
    expect(escapeHtml(`<a href="/">'hi'</a>&`)).toBe(
      "&lt;a href=&quot;/&quot;&gt;&#39;hi&#39;&lt;/a&gt;&amp;",
    );
  });
  test("passes plain text through unchanged", async () => {
    const { escapeHtml } = await loadSidebar();
    expect(escapeHtml("plain text 123")).toBe("plain text 123");
  });
});

describe("createSidebarView.applyVisibility", () => {
  test("adds .collapsed when hidden and toggles body class", async () => {
    const { view, sidebarEl, store } = await setup({ sidebarVisible: false });
    view.applyVisibility(store.getState());
    expect(sidebarEl.classList.contains("collapsed")).toBe(true);
    expect(document.body.classList.contains("sidebar-open")).toBe(false);
  });
  test("removes .collapsed when shown", async () => {
    const { view, sidebarEl, store } = await setup({ sidebarVisible: true });
    view.applyVisibility(store.getState());
    expect(sidebarEl.classList.contains("collapsed")).toBe(false);
    expect(document.body.classList.contains("sidebar-open")).toBe(true);
  });
});

describe("createSidebarView.updateWorkspaceSelect", () => {
  test("renders each workspace as an option", async () => {
    const { view, workspaceSelectEl, store } = await setup({
      workspaces: [
        { id: "ws1", name: "Alpha" },
        { id: "ws2", name: "Beta" },
      ],
      activeWorkspaceId: "ws2",
    });
    view.updateWorkspaceSelect(store.getState());
    const opts = Array.from(workspaceSelectEl.options);
    expect(opts.map((o) => o.value)).toEqual(["ws1", "ws2"]);
    expect(opts.map((o) => o.textContent)).toEqual(["Alpha", "Beta"]);
    expect(opts[1]!.selected).toBe(true);
  });
  test("clears previous options on re-render", async () => {
    const { view, workspaceSelectEl, store } = await setup({
      workspaces: [{ id: "ws1", name: "Alpha" }],
    });
    view.updateWorkspaceSelect(store.getState());
    view.updateWorkspaceSelect(store.getState());
    expect(workspaceSelectEl.options.length).toBe(1);
  });
});

describe("createSidebarView.render", () => {
  test("empty workspaces show an 'empty' marker", async () => {
    const { view, sidebarEl, store } = await setup({});
    view.render(store.getState());
    expect(sidebarEl.querySelector(".sb-empty")).not.toBeNull();
  });

  test("renders a workspace card with dot + name + pane-count badge", async () => {
    const { view, sidebarEl, store } = await setup({
      workspaces: [{ id: "ws1", name: "Alpha", surfaceIds: ["s1", "s2"] }],
      activeWorkspaceId: "ws1",
    });
    view.render(store.getState());
    const card = sidebarEl.querySelector(".workspace-item");
    expect(card?.classList.contains("active")).toBe(true);
    expect(card?.querySelector(".workspace-name")?.textContent).toContain(
      "Alpha",
    );
    expect(card?.querySelector(".workspace-pane-count")?.textContent).toContain(
      "2 panes",
    );
  });

  test("pluralizes single pane correctly", async () => {
    const { view, sidebarEl, store } = await setup({
      workspaces: [{ id: "ws1", name: "Alpha", surfaceIds: ["s1"] }],
      activeWorkspaceId: "ws1",
    });
    view.render(store.getState());
    expect(
      sidebarEl.querySelector(".workspace-pane-count")?.textContent,
    ).toContain("1 pane");
  });

  test("stripe paints with the workspace's accent colour", async () => {
    const { view, sidebarEl, store } = await setup({
      workspaces: [
        { id: "ws1", name: "Alpha", color: "#eab308", surfaceIds: ["s1"] },
      ],
      activeWorkspaceId: "ws1",
    });
    view.render(store.getState());
    const card = sidebarEl.querySelector(".workspace-item") as HTMLElement;
    // The card sets the stripe colour via a CSS custom property.
    expect(card?.style.getPropertyValue("--workspace-color")).toBe("#eab308");
    expect(card?.querySelector(".workspace-stripe")).not.toBeNull();
  });

  test("renders status pills via the shared renderStatusEntry dispatcher", async () => {
    const { view, sidebarEl, store } = await setup({
      workspaces: [{ id: "ws1" }],
      activeWorkspaceId: "ws1",
      status: { ws1: { build: { value: "<fail>" } } },
    });
    view.render(store.getState());
    const status = sidebarEl.querySelector(".workspace-status");
    expect(status).not.toBeNull();
    // The shared renderer escapes the value text.
    expect(status?.textContent).toContain("<fail>");
    expect(status?.innerHTML).toContain("&lt;fail&gt;");
  });

  test("renders progress bar clamped to 0–100", async () => {
    const { view, sidebarEl, store } = await setup({
      workspaces: [{ id: "ws1" }],
      activeWorkspaceId: "ws1",
      progress: { ws1: { value: 250 } },
    });
    view.render(store.getState());
    const bar = sidebarEl.querySelector(
      ".workspace-progress-fill",
    ) as HTMLElement;
    expect(bar?.style.width).toBe("100%");
  });

  test("negative progress clamps to 0", async () => {
    const { view, sidebarEl, store } = await setup({
      workspaces: [{ id: "ws1" }],
      activeWorkspaceId: "ws1",
      progress: { ws1: { value: -50 } },
    });
    view.render(store.getState());
    const bar = sidebarEl.querySelector(
      ".workspace-progress-fill",
    ) as HTMLElement;
    expect(bar?.style.width).toBe("0%");
  });

  test("manifest section is hidden when no package.json or Cargo.toml is present", async () => {
    const { view, sidebarEl, store } = await setup({
      workspaces: [{ id: "ws1", surfaceIds: ["s1"] }],
      activeWorkspaceId: "ws1",
    });
    view.render(store.getState());
    const section = sidebarEl.querySelector(".workspace-manifests");
    expect(section?.classList.contains("empty")).toBe(true);
    // No package card rendered.
    expect(sidebarEl.querySelector(".workspace-package")).toBeNull();
  });

  test("sparkline renders for the active card once a CPU sample lands", async () => {
    const { view, sidebarEl, store } = await setup({
      workspaces: [{ id: "ws1", surfaceIds: ["s1"] }],
      activeWorkspaceId: "ws1",
    });
    view.render(store.getState());
    // First render — flat baseline (only one sample).
    expect(
      sidebarEl.querySelector(".workspace-sparkline-flat") ??
        sidebarEl.querySelector(".workspace-sparkline-line"),
    ).not.toBeNull();
    // A second render with the same workspace bumps the history to 2
    // samples — the line variant takes over.
    view.render(store.getState());
    expect(sidebarEl.querySelector(".workspace-sparkline-line")).not.toBeNull();
  });

  test("ports row collapses to +N pill past 3 entries", async () => {
    const { view, sidebarEl, store } = await setup({
      workspaces: [{ id: "ws1", surfaceIds: ["s1"] }],
      activeWorkspaceId: "ws1",
    });
    // Dispatch metadata with 5 listening ports so the card's
    // `WorkspaceInfo.listeningPorts` lands at length 5.
    store.dispatch({
      kind: "surface/metadata",
      surfaceId: "s1",
      metadata: {
        pid: 1,
        foregroundPid: 1,
        cwd: "/tmp",
        tree: [],
        listeningPorts: [3000, 3001, 3002, 8080, 9000].map((port) => ({
          pid: 1,
          port,
          proto: "tcp" as const,
          address: "127.0.0.1",
        })),
        git: null,
        packageJson: null,
        updatedAt: 0,
      },
    });
    view.render(store.getState());
    const chips = sidebarEl.querySelectorAll(".workspace-port-chip");
    // 3 visible port chips + 1 "+N" overflow chip.
    expect(chips.length).toBe(4);
    const more = sidebarEl.querySelector(".workspace-port-chip.more");
    expect(more?.textContent).toBe("+2");
  });

  test("cwd chip click pins the cwd locally and emits selectWorkspaceCwd", async () => {
    const { view, sidebarEl, store, sendMsg } = await setup({
      workspaces: [{ id: "ws1", surfaceIds: ["s1", "s2"] }],
      activeWorkspaceId: "ws1",
    });
    // Two cwds across the workspace's surfaces.
    store.dispatch({
      kind: "surface/metadata",
      surfaceId: "s1",
      metadata: {
        pid: 1,
        foregroundPid: 1,
        cwd: "/home/alice/proj-a",
        tree: [],
        listeningPorts: [],
        git: null,
        packageJson: null,
        updatedAt: 0,
      },
    });
    store.dispatch({
      kind: "surface/metadata",
      surfaceId: "s2",
      metadata: {
        pid: 2,
        foregroundPid: 2,
        cwd: "/home/alice/proj-b",
        tree: [],
        listeningPorts: [],
        git: null,
        packageJson: null,
        updatedAt: 0,
      },
    });
    view.render(store.getState());
    const chips = sidebarEl.querySelectorAll(".workspace-cwd-chip");
    expect(chips.length).toBe(2);
    // Click the second chip — it becomes active, the first deactivates,
    // and the client emits the selectWorkspaceCwd envelope.
    (chips[1] as HTMLElement).dispatchEvent(
      new Event("click", { bubbles: true }),
    );
    const refreshed = sidebarEl.querySelectorAll(".workspace-cwd-chip");
    expect(refreshed[1]!.classList.contains("active")).toBe(true);
    expect(refreshed[0]!.classList.contains("active")).toBe(false);
    expect(sendMsg).toHaveBeenCalledWith("selectWorkspaceCwd", {
      workspaceId: "ws1",
      cwd: "/home/alice/proj-b",
    });
  });

  test("notifications section shows the last five in reverse", async () => {
    const notes = Array.from({ length: 7 }, (_, i) => ({
      id: `n${i}`,
      title: `note ${i}`,
    }));
    const { view, sidebarEl, store } = await setup({
      notifications: notes,
    });
    view.render(store.getState());
    const notifEls = sidebarEl.querySelectorAll(".sb-notif-title");
    expect(notifEls.length).toBe(5);
    expect(notifEls[0]?.textContent).toBe("note 6");
  });

  test("logs section renders last ten in reverse with level class", async () => {
    const logs = [
      { level: "error", message: "boom" },
      { level: "info", message: "ok" },
    ];
    const { view, sidebarEl, store } = await setup({ logs });
    view.render(store.getState());
    const logEls = sidebarEl.querySelectorAll(".sb-log");
    expect(logEls.length).toBe(2);
    expect(logEls[0]?.textContent).toBe("ok");
    expect(logEls[1]?.classList.contains("error")).toBe(true);
  });

  test("escapes log messages", async () => {
    const { view, sidebarEl, store } = await setup({
      logs: [{ level: "info", message: "<script>alert(1)</script>" }],
    });
    view.render(store.getState());
    expect(sidebarEl.innerHTML).toContain("&lt;script&gt;");
    expect(sidebarEl.innerHTML).not.toContain("<script>alert");
  });
});

describe("createSidebarView event wiring", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("toggle button flips sidebarVisible + emits sidebarToggle", async () => {
    const { store, sendMsg, sidebarToggleBtn } = await setup({
      sidebarVisible: true,
    });
    sidebarToggleBtn.dispatchEvent(new Event("click", { bubbles: true }));
    expect(store.getState().sidebarVisible).toBe(false);
    expect(sendMsg).toHaveBeenCalledWith("sidebarToggle", { visible: false });
  });

  test("clear-notifs data-action dispatches notification/clear", async () => {
    const { store, sendMsg, sidebarEl, view } = await setup({
      notifications: [{ id: "n1", title: "hi" }],
    });
    view.render(store.getState());
    const btn = sidebarEl.querySelector(
      "[data-action='clear-notifs']",
    ) as HTMLElement;
    btn.dispatchEvent(new Event("click", { bubbles: true }));
    expect(store.getState().sidebar.notifications.length).toBe(0);
    expect(sendMsg).toHaveBeenCalledWith("clearNotifications", {});
  });

  test("workspace row switches workspace and requests selection + history", async () => {
    const { store, sendMsg, sidebarEl, view } = await setup({
      workspaces: [
        { id: "ws1", name: "Alpha", surfaceIds: ["s1"] },
        { id: "ws2", name: "Beta", surfaceIds: ["s2"] },
      ],
      activeWorkspaceId: "ws1",
    });
    view.render(store.getState());

    const row = sidebarEl.querySelector(
      "[data-action='select-workspace'][data-workspace-id='ws2']",
    ) as HTMLElement;
    row.dispatchEvent(new Event("click", { bubbles: true }));

    expect(store.getState().activeWorkspaceId).toBe("ws2");
    expect(sendMsg).toHaveBeenCalledWith("selectWorkspace", {
      workspaceId: "ws2",
    });
    expect(sendMsg).toHaveBeenCalledWith("subscribeWorkspace", {
      workspaceId: "ws2",
    });
  });

  test("clear-logs data-action is client-side only", async () => {
    const { sendMsg, sidebarEl, view, store } = await setup({
      logs: [{ level: "info", message: "hi" }],
    });
    view.render(store.getState());
    expect(store.getState().sidebar.logs.length).toBe(1);
    const btn = sidebarEl.querySelector(
      "[data-action='clear-logs']",
    ) as HTMLElement;
    btn.dispatchEvent(new Event("click", { bubbles: true }));
    // no network call for logs
    const clearNetworkCalls = sendMsg.mock.calls.filter(
      ([type]: [unknown]) => type === "clearLogs",
    );
    expect(clearNetworkCalls.length).toBe(0);
    // … but the reducer must actually empty the buffered logs.
    expect(store.getState().sidebar.logs).toEqual([]);
  });

  test("dismiss button removes the entry + emits dismissNotification", async () => {
    const { store, sendMsg, sidebarEl, view } = await setup({
      notifications: [
        { id: "n1", title: "alpha" },
        { id: "n2", title: "beta" },
      ],
    });
    view.render(store.getState());

    const dismissBtn = sidebarEl.querySelector(
      "[data-action='dismiss-notif'][data-id='n2']",
    ) as HTMLElement;
    dismissBtn.dispatchEvent(new Event("click", { bubbles: true }));

    expect(store.getState().sidebar.notifications.map((n) => n.id)).toEqual([
      "n1",
    ]);
    expect(sendMsg).toHaveBeenCalledWith("dismissNotification", { id: "n2" });
  });

  test("body click emits focusSurface + clears glow immediately", async () => {
    const { sendMsg, sidebarEl, view, store } = await setup({
      workspaces: [{ id: "ws1", surfaceIds: ["s1"] }],
      activeWorkspaceId: "ws1",
    });
    // Manually seed a notification whose surfaceId matches a pane.
    store.dispatch({
      kind: "notification/add",
      entry: {
        id: "n7",
        title: "hi",
        body: "",
        surfaceId: "s1",
        at: 0,
      },
    });
    view.render(store.getState());

    const row = sidebarEl.querySelector(
      ".sb-notif[data-id='n7']",
    ) as HTMLElement;
    expect(row.classList.contains("glow")).toBe(true);

    const body = row.querySelector(
      "[data-action='focus-notif']",
    ) as HTMLElement;
    body.dispatchEvent(new Event("click", { bubbles: true }));

    expect(sendMsg).toHaveBeenCalledWith("focusSurface", { surfaceId: "s1" });
    expect(row.classList.contains("glow")).toBe(false);
  });

  test("row element is reused across renders (preserves the glow animation)", async () => {
    const { sidebarEl, view, store } = await setup({
      notifications: [{ id: "n1", title: "alpha" }],
    });
    view.render(store.getState());
    const before = sidebarEl.querySelector(".sb-notif[data-id='n1']");
    expect(before).not.toBeNull();

    // Second notification arrives — the existing `n1` row must be the
    // SAME DOM node so its CSS animation keeps running.
    store.dispatch({
      kind: "notification/add",
      entry: {
        id: "n2",
        title: "beta",
        body: "",
        surfaceId: undefined,
        at: 0,
      },
    });
    view.render(store.getState());
    const after = sidebarEl.querySelector(".sb-notif[data-id='n1']");
    expect(after).toBe(before);
  });

  test("focused surfaceId auto-acks its notifications (glow stops)", async () => {
    const { sidebarEl, view, store } = await setup({
      workspaces: [{ id: "ws1", surfaceIds: ["s1"] }],
      activeWorkspaceId: "ws1",
    });
    store.dispatch({
      kind: "notification/add",
      entry: { id: "n1", title: "x", body: "", surfaceId: "s1", at: 0 },
    });
    store.dispatch({ kind: "focus/set", surfaceId: "s1" });
    view.render(store.getState());

    expect(
      sidebarEl
        .querySelector(".sb-notif[data-id='n1']")
        ?.classList.contains("glow"),
    ).toBe(false);
  });
});
