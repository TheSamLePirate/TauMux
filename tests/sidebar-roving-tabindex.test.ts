// Phase 1 / U12 — sidebar workspace list roving-tabindex.
//
// Before this change every workspace card was tabindex="-1", making
// the entire workspace list keyboard-invisible. The roving-tabindex
// fix puts exactly one card at tabindex="0" (the active one, or the
// keyboard-walked one) so Tab from outside the sidebar lands inside.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function loadSidebar() {
  return await import("../src/views/terminal/sidebar");
}

interface WsSeed {
  id: string;
  active?: boolean;
}

function ws(
  seed: WsSeed,
): import("../src/views/terminal/sidebar").WorkspaceInfo {
  return {
    id: seed.id,
    name: seed.id,
    color: "#89b4fa",
    active: seed.active ?? false,
    surfaceTitles: ["zsh"],
    focusedSurfaceTitle: "zsh",
    focusedSurfaceCommand: null,
    statusPills: [],
    progress: null,
    listeningPorts: [],
    packageJson: null,
    runningScripts: [],
    erroredScripts: [],
    cargoToml: null,
    runningCargoActions: [],
    erroredCargoActions: [],
    cwds: [],
    selectedCwd: null,
    cpuPercent: 0,
    memRssKb: 0,
    processCount: 0,
    cpuHistory: [],
  };
}

async function makeSidebar() {
  document.body.innerHTML = `<div id="sidebar"></div>`;
  const container = document.getElementById("sidebar") as HTMLElement;
  const { Sidebar } = await loadSidebar();
  const sidebar = new Sidebar(container, {
    onSelectWorkspace: () => {},
    onNewWorkspace: () => {},
    onCloseWorkspace: () => {},
  });
  return { sidebar, container };
}

function card(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector(`[data-workspace-id="${id}"]`);
  if (!el) throw new Error(`no card for ${id}`);
  return el as HTMLElement;
}

describe("[U12] Sidebar — workspace roving-tabindex", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("the active workspace card carries tabindex=0; others -1", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([
      ws({ id: "ws:1" }),
      ws({ id: "ws:2", active: true }),
      ws({ id: "ws:3" }),
    ]);
    expect(card(container, "ws:1").getAttribute("tabindex")).toBe("-1");
    expect(card(container, "ws:2").getAttribute("tabindex")).toBe("0");
    expect(card(container, "ws:3").getAttribute("tabindex")).toBe("-1");
  });

  test("when no workspace is active, every card stays tabindex=-1", async () => {
    // Defensive — production always marks exactly one active, but the
    // sidebar must not crash or pick a random card to expose.
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([ws({ id: "ws:1" }), ws({ id: "ws:2" })]);
    expect(card(container, "ws:1").getAttribute("tabindex")).toBe("-1");
    expect(card(container, "ws:2").getAttribute("tabindex")).toBe("-1");
  });

  test("ArrowDown from the container moves the tabindex=0 to the next card", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([
      ws({ id: "ws:1", active: true }),
      ws({ id: "ws:2" }),
      ws({ id: "ws:3" }),
    ]);
    expect(card(container, "ws:1").getAttribute("tabindex")).toBe("0");
    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    // Roving tabindex moves with the highlight; only one card has "0".
    const tabbables = [
      card(container, "ws:1"),
      card(container, "ws:2"),
      card(container, "ws:3"),
    ].filter((c) => c.getAttribute("tabindex") === "0");
    expect(tabbables.length).toBe(1);
    expect(tabbables[0].dataset["workspaceId"]).toBe("ws:1");
    // The next ArrowDown should move to ws:2.
    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    const after2 = [
      card(container, "ws:1"),
      card(container, "ws:2"),
      card(container, "ws:3"),
    ].filter((c) => c.getAttribute("tabindex") === "0");
    expect(after2.length).toBe(1);
    expect(after2[0].dataset["workspaceId"]).toBe("ws:2");
  });

  test("re-rendering preserves the active card's tabindex assignment", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([
      ws({ id: "ws:1", active: true }),
      ws({ id: "ws:2" }),
    ]);
    // Mutate state and re-render.
    sidebar.setWorkspaces([
      ws({ id: "ws:1" }),
      ws({ id: "ws:2", active: true }),
    ]);
    expect(card(container, "ws:1").getAttribute("tabindex")).toBe("-1");
    expect(card(container, "ws:2").getAttribute("tabindex")).toBe("0");
  });
});
