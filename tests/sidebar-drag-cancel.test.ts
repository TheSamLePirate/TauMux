// P7 S8 — sidebar mouse-drag Escape cancel + indicator hygiene.
//
// Mouse drag's commit path is already covered indirectly by the
// keyboard reorder suite; this file exercises the cancellation seam:
//
//   1. Escape during a drag clears `dragState` so any subsequent
//      drop event becomes a no-op.
//   2. Visual indicators (.drop-before / .drop-after / .dragging)
//      are stripped immediately on cancel.
//   3. `dragleave` only clears the indicator when the pointer truly
//      left the card rect — moving over a child element keeps it.

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

/** happy-dom doesn't ship DragEvent; fabricate something close enough
 *  that the sidebar's handlers see what they need (`dataTransfer`,
 *  `clientX/Y`). Bubbles + cancelable so preventDefault has effect. */
function dispatchDragEvent(
  el: Element,
  type: string,
  opts: { clientX?: number; clientY?: number } = {},
): Event {
  const ev = new Event(type, {
    bubbles: true,
    cancelable: true,
  }) as unknown as Record<string, unknown>;
  // Minimal DataTransfer surrogate — setData / dropEffect / effectAllowed.
  ev["dataTransfer"] = {
    setData: () => {},
    getData: () => "",
    effectAllowed: "move",
    dropEffect: "none",
  };
  if (opts.clientX !== undefined) ev["clientX"] = opts.clientX;
  if (opts.clientY !== undefined) ev["clientY"] = opts.clientY;
  el.dispatchEvent(ev as unknown as Event);
  return ev as unknown as Event;
}

describe("Sidebar — mouse-drag Escape cancel (P7 S8)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  test("dragstart marks the source .dragging and installs an Escape handler", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([
      ws({ id: "ws:1", active: true }),
      ws({ id: "ws:2" }),
    ]);
    const a = card(container, "ws:1");
    dispatchDragEvent(a, "dragstart");
    expect(a.classList.contains("dragging")).toBe(true);
  });

  test("Escape during a drag clears state + .dragging + indicators", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([
      ws({ id: "ws:1", active: true }),
      ws({ id: "ws:2" }),
      ws({ id: "ws:3" }),
    ]);
    const a = card(container, "ws:1");
    const b = card(container, "ws:2");
    dispatchDragEvent(a, "dragstart");
    // Force a stable rect on b — happy-dom returns zeros otherwise.
    b.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 140,
        left: 0,
        right: 200,
        height: 40,
        width: 200,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    dispatchDragEvent(b, "dragover", { clientX: 50, clientY: 110 });
    expect(
      b.classList.contains("drop-before") || b.classList.contains("drop-after"),
    ).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(a.classList.contains("dragging")).toBe(false);
    expect(b.classList.contains("drop-before")).toBe(false);
    expect(b.classList.contains("drop-after")).toBe(false);
  });

  test("drop after Escape is a no-op (reorder does not fire)", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([
      ws({ id: "ws:1", active: true }),
      ws({ id: "ws:2" }),
    ]);
    const orders: string[][] = [];
    const listener = (e: Event) =>
      orders.push(((e as CustomEvent).detail as { order: string[] }).order);
    window.addEventListener("ht-reorder-workspaces", listener);

    const a = card(container, "ws:1");
    const b = card(container, "ws:2");
    dispatchDragEvent(a, "dragstart");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    b.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 140,
        left: 0,
        right: 200,
        height: 40,
        width: 200,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    // A drop after the cancel should bail out at the dragState check.
    dispatchDragEvent(b, "drop", { clientX: 50, clientY: 130 });

    window.removeEventListener("ht-reorder-workspaces", listener);
    expect(orders).toEqual([]);
  });

  test("dragover on a fresh card clears the indicator on the previous target", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([
      ws({ id: "ws:1", active: true }),
      ws({ id: "ws:2" }),
      ws({ id: "ws:3" }),
    ]);
    const a = card(container, "ws:1");
    const b = card(container, "ws:2");
    const c = card(container, "ws:3");
    dispatchDragEvent(a, "dragstart");
    for (const el of [b, c]) {
      el.getBoundingClientRect = () =>
        ({
          top: 0,
          bottom: 40,
          left: 0,
          right: 200,
          height: 40,
          width: 200,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    }
    dispatchDragEvent(b, "dragover", { clientX: 50, clientY: 10 });
    expect(b.classList.contains("drop-before")).toBe(true);
    dispatchDragEvent(c, "dragover", { clientX: 50, clientY: 10 });
    // After moving to c, b's indicator should be gone, c's should be lit.
    expect(b.classList.contains("drop-before")).toBe(false);
    expect(b.classList.contains("drop-after")).toBe(false);
    expect(c.classList.contains("drop-before")).toBe(true);
  });

  test("dragleave inside the card rect (pointer over a child) keeps the indicator", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setWorkspaces([
      ws({ id: "ws:1", active: true }),
      ws({ id: "ws:2" }),
    ]);
    const a = card(container, "ws:1");
    const b = card(container, "ws:2");
    b.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 140,
        left: 0,
        right: 200,
        height: 40,
        width: 200,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    dispatchDragEvent(a, "dragstart");
    dispatchDragEvent(b, "dragover", { clientX: 50, clientY: 110 });
    expect(b.classList.contains("drop-before")).toBe(true);
    // dragleave with clientX/Y still inside the rect — pointer moved
    // over a child element, not off the card.
    dispatchDragEvent(b, "dragleave", { clientX: 50, clientY: 130 });
    expect(b.classList.contains("drop-before")).toBe(true);
    // dragleave with coords outside → indicator clears.
    dispatchDragEvent(b, "dragleave", { clientX: 50, clientY: 200 });
    expect(b.classList.contains("drop-before")).toBe(false);
  });
});
