// P7 S7 — sidebar drag-reorder a11y polish.
//
// Mouse drag already worked; this exercises the keyboard equivalent
// (Alt+ArrowUp / Alt+ArrowDown) plus the polite live-region
// announcement and the aria-roledescription that advertises the
// option to screen readers.

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

function workspaceIdOrder(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-workspace-id]"),
  ).map((el) => el.dataset["workspaceId"]!);
}

describe("Sidebar — keyboard reorder (P7 S7)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // Manual reorder persists to localStorage between sidebar
    // instances; clear it so each test starts from the natural order.
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  test("every workspace card advertises the keyboard option via aria-roledescription", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([
      ws({ id: "ws:1", active: true }),
      ws({ id: "ws:2" }),
    ]);
    const cards = container.querySelectorAll<HTMLElement>(
      "[data-workspace-id]",
    );
    for (const c of cards) {
      const desc = c.getAttribute("aria-roledescription") ?? "";
      expect(desc).toContain("Alt+Up");
      expect(desc).toContain("Alt+Down");
    }
  });

  test("Alt+ArrowDown moves the highlighted workspace one slot down", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([
      ws({ id: "ws:1", active: true }),
      ws({ id: "ws:2" }),
      ws({ id: "ws:3" }),
    ]);
    // First ArrowDown selects ws:1 (active). Then Alt+ArrowDown moves
    // it one slot down so the order becomes [ws:2, ws:1, ws:3].
    expect(workspaceIdOrder(container)).toEqual(["ws:1", "ws:2", "ws:3"]);
    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(workspaceIdOrder(container)).toEqual(["ws:2", "ws:1", "ws:3"]);
  });

  test("Alt+ArrowUp moves the highlighted workspace one slot up", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([
      ws({ id: "ws:1" }),
      ws({ id: "ws:2", active: true }),
      ws({ id: "ws:3" }),
    ]);
    // ArrowDown twice → highlight on ws:2; Alt+ArrowUp swaps it past
    // ws:1 to produce [ws:2, ws:1, ws:3].
    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(workspaceIdOrder(container)).toEqual(["ws:2", "ws:1", "ws:3"]);
  });

  test("Alt+ArrowUp at index 0 is a no-op (no wrap-around)", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([
      ws({ id: "ws:1", active: true }),
      ws({ id: "ws:2" }),
    ]);
    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(workspaceIdOrder(container)).toEqual(["ws:1", "ws:2"]);
  });

  test("a keyboard reorder dispatches ht-reorder-workspaces with the new order", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([
      ws({ id: "ws:1", active: true }),
      ws({ id: "ws:2" }),
    ]);
    const orders: string[][] = [];
    const listener = (e: Event) => {
      orders.push(((e as CustomEvent).detail as { order: string[] }).order);
    };
    window.addEventListener("ht-reorder-workspaces", listener);

    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    window.removeEventListener("ht-reorder-workspaces", listener);
    expect(orders).toEqual([["ws:2", "ws:1"]]);
  });

  test("a keyboard reorder writes a polite announcement into the live region", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([
      ws({ id: "ws:1", active: true }),
      ws({ id: "ws:2" }),
      ws({ id: "ws:3" }),
    ]);
    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    const region = container.querySelector<HTMLElement>(".sidebar-live-region");
    expect(region).not.toBeNull();
    expect(region!.getAttribute("aria-live")).toBe("polite");
    expect(region!.textContent ?? "").toContain("Moved ws:1");
    expect(region!.textContent ?? "").toContain("position 2 of 3");
  });

  // ── P7 S23 — mouse drag-drop also announces ──────────────────

  test("mouse drag-drop announces the move through the same live region", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([
      ws({ id: "ws:1", active: true }),
      ws({ id: "ws:2" }),
      ws({ id: "ws:3" }),
    ]);

    // Simulate dragstart on ws:1.
    const cards = container.querySelectorAll<HTMLElement>(
      "[data-workspace-id]",
    );
    const source = cards[0]!;
    const target = cards[2]!;

    // happy-dom supplies a stub DataTransfer; pass undefined-safe.
    const dt = { effectAllowed: "", setData: () => {}, getData: () => "" };
    source.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        // @ts-expect-error happy-dom accepts a partial DataTransfer mock
        dataTransfer: dt,
      }),
    );

    // dragover on the target — simulate dropping AFTER ws:3 (positive
    // pointer offset).
    const targetRect = target.getBoundingClientRect();
    target.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        clientY: targetRect.bottom - 1,
        // @ts-expect-error see above
        dataTransfer: dt,
      }),
    );
    target.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        clientY: targetRect.bottom - 1,
        // @ts-expect-error see above
        dataTransfer: dt,
      }),
    );

    const region = container.querySelector<HTMLElement>(".sidebar-live-region");
    expect(region).not.toBeNull();
    expect(region!.textContent ?? "").toContain("Moved ws:1");
    // ws:1 moved to the end → position 3 of 3.
    expect(region!.textContent ?? "").toContain("position 3 of 3");
  });
});
