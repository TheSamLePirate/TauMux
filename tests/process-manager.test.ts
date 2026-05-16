// Phase 1 / U1 — ProcessManagerPanel a11y integration with ModalHost.
//
// Until Phase 1, the Process Manager overlay had no unit coverage at
// all (T1 in triple_a_analysis.md). This file lifts process-manager
// from "no tests" to "lifecycle + a11y covered" — enough for the
// B → A grade move after ModalHost lands.

import {
  afterAll,
  afterEach,
  beforeAll,
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
afterEach(() => {
  document.body.innerHTML = "";
});

async function loadProcMgr() {
  return await import("../src/views/terminal/process-manager");
}

function emptyWorkspaces() {
  return [];
}

describe("ProcessManagerPanel — lifecycle", () => {
  test("constructor mounts a hidden overlay onto document.body", async () => {
    const { ProcessManagerPanel } = await loadProcMgr();
    new ProcessManagerPanel({
      getData: emptyWorkspaces,
      onKill: () => {},
    });
    const overlay = document.body.querySelector(".process-manager-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.classList.contains("visible")).toBe(false);
  });

  test("show() then hide() toggles visibility class", async () => {
    const { ProcessManagerPanel } = await loadProcMgr();
    const pm = new ProcessManagerPanel({
      getData: emptyWorkspaces,
      onKill: () => {},
    });
    const overlay = document.body.querySelector(
      ".process-manager-overlay",
    ) as HTMLElement;
    pm.show();
    expect(pm.isVisible()).toBe(true);
    expect(overlay.classList.contains("visible")).toBe(true);
    pm.hide();
    expect(pm.isVisible()).toBe(false);
    expect(overlay.classList.contains("visible")).toBe(false);
  });

  test("show() / hide() are idempotent", async () => {
    const { ProcessManagerPanel } = await loadProcMgr();
    const pm = new ProcessManagerPanel({
      getData: emptyWorkspaces,
      onKill: () => {},
    });
    expect(() => {
      pm.show();
      pm.show();
      pm.hide();
      pm.hide();
    }).not.toThrow();
  });

  test("toggle() flips visibility", async () => {
    const { ProcessManagerPanel } = await loadProcMgr();
    const pm = new ProcessManagerPanel({
      getData: emptyWorkspaces,
      onKill: () => {},
    });
    expect(pm.isVisible()).toBe(false);
    pm.toggle();
    expect(pm.isVisible()).toBe(true);
    pm.toggle();
    expect(pm.isVisible()).toBe(false);
  });
});

describe("[U1] ProcessManagerPanel — ModalHost a11y attrs", () => {
  test("overlay carries role=dialog + aria-modal + aria-labelledby", async () => {
    const { ProcessManagerPanel } = await loadProcMgr();
    new ProcessManagerPanel({
      getData: emptyWorkspaces,
      onKill: () => {},
    });
    const overlay = document.body.querySelector(
      ".process-manager-overlay",
    ) as HTMLElement;
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    expect(overlay.getAttribute("aria-labelledby")).toBe(
      "process-manager-title",
    );
    // The title element exists with that id.
    expect(document.getElementById("process-manager-title")?.textContent).toBe(
      "Process Manager",
    );
  });
});

describe("[U1] ProcessManagerPanel — close paths", () => {
  test("Escape on the overlay closes the panel", async () => {
    const { ProcessManagerPanel } = await loadProcMgr();
    const pm = new ProcessManagerPanel({
      getData: emptyWorkspaces,
      onKill: () => {},
    });
    pm.show();
    const overlay = document.body.querySelector(".process-manager-overlay")!;
    overlay.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(pm.isVisible()).toBe(false);
  });

  test("scrim click closes; click on the inner panel does not", async () => {
    const { ProcessManagerPanel } = await loadProcMgr();
    const pm = new ProcessManagerPanel({
      getData: emptyWorkspaces,
      onKill: () => {},
    });
    pm.show();
    const overlay = document.body.querySelector(".process-manager-overlay")!;
    const panel = overlay.querySelector(".process-manager-panel")!;

    // Click inside the panel — should NOT close.
    const innerEv = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(innerEv, "target", { value: panel });
    overlay.dispatchEvent(innerEv);
    expect(pm.isVisible()).toBe(true);

    // Click on the scrim — should close.
    const scrimEv = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(scrimEv, "target", { value: overlay });
    overlay.dispatchEvent(scrimEv);
    expect(pm.isVisible()).toBe(false);
  });

  test("close button click closes the panel", async () => {
    const { ProcessManagerPanel } = await loadProcMgr();
    const pm = new ProcessManagerPanel({
      getData: emptyWorkspaces,
      onKill: () => {},
    });
    pm.show();
    const closeBtn = document.body.querySelector(
      ".process-manager-close",
    ) as HTMLButtonElement;
    closeBtn.click();
    expect(pm.isVisible()).toBe(false);
  });
});
