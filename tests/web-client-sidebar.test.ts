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
    workspaces: (opts.workspaces ?? []).map((w) => ({
      id: w.id,
      name: w.name ?? w.id,
      color: w.color ?? "#89b4fa",
      surfaceIds: w.surfaceIds ?? [],
      focusedSurfaceId: null,
      layout: { type: "leaf" as const, surfaceId: w.surfaceIds?.[0] ?? "x" },
    })),
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

  test("renders a workspace row with dot + meta", async () => {
    const { view, sidebarEl, store } = await setup({
      workspaces: [{ id: "ws1", name: "Alpha", surfaceIds: ["s1", "s2"] }],
      activeWorkspaceId: "ws1",
    });
    view.render(store.getState());
    const row = sidebarEl.querySelector(".sb-ws");
    expect(row?.classList.contains("active")).toBe(true);
    expect(row?.querySelector(".sb-ws-name")?.textContent).toContain("Alpha");
    expect(row?.querySelector(".sb-ws-meta")?.textContent).toContain("2 panes");
  });

  test("pluralizes single pane correctly", async () => {
    const { view, sidebarEl, store } = await setup({
      workspaces: [{ id: "ws1", name: "Alpha", surfaceIds: ["s1"] }],
      activeWorkspaceId: "ws1",
    });
    view.render(store.getState());
    expect(sidebarEl.querySelector(".sb-ws-meta")?.textContent).toContain(
      "1 pane",
    );
  });

  test("renders status pills and escapes values", async () => {
    const { view, sidebarEl, store } = await setup({
      workspaces: [{ id: "ws1" }],
      activeWorkspaceId: "ws1",
      status: { ws1: { build: { value: "<fail>" } } },
    });
    view.render(store.getState());
    const pill = sidebarEl.querySelector(".sb-pill");
    expect(pill?.textContent).toBe("build: <fail>");
    expect(sidebarEl.innerHTML).toContain("&lt;fail&gt;");
  });

  test("renders progress bar clamped to 0–100", async () => {
    const { view, sidebarEl, store } = await setup({
      workspaces: [{ id: "ws1" }],
      activeWorkspaceId: "ws1",
      progress: { ws1: { value: 250 } },
    });
    view.render(store.getState());
    const bar = sidebarEl.querySelector(".sb-progress-bar") as HTMLElement;
    expect(bar?.style.width).toBe("100%");
  });

  test("negative progress clamps to 0", async () => {
    const { view, sidebarEl, store } = await setup({
      workspaces: [{ id: "ws1" }],
      activeWorkspaceId: "ws1",
      progress: { ws1: { value: -50 } },
    });
    view.render(store.getState());
    const bar = sidebarEl.querySelector(".sb-progress-bar") as HTMLElement;
    expect(bar?.style.width).toBe("0%");
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

  test("clear-logs data-action is client-side only", async () => {
    const { sendMsg, sidebarEl, view, store } = await setup({
      logs: [{ level: "info", message: "hi" }],
    });
    view.render(store.getState());
    const btn = sidebarEl.querySelector(
      "[data-action='clear-logs']",
    ) as HTMLElement;
    btn.dispatchEvent(new Event("click", { bubbles: true }));
    // no network call for logs
    const clearNetworkCalls = sendMsg.mock.calls.filter(
      ([type]: [unknown]) => type === "clearLogs",
    );
    expect(clearNetworkCalls.length).toBe(0);
  });
});
