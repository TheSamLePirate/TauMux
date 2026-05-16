// Phase 1 / U1 — Modal-host helper tests.
//
// Validates the four invariants: role + aria-modal, focus trap (Tab
// and Shift+Tab), focus restore on close, Escape + scrim click.

import {
  afterAll,
  afterEach,
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

afterEach(() => {
  document.body.innerHTML = "";
});

async function loadHost() {
  return await import("../../../src/views/terminal/a11y/modal-host");
}

interface Built {
  overlay: HTMLDivElement;
  panel: HTMLDivElement;
  inputA: HTMLInputElement;
  inputB: HTMLInputElement;
  buttonClose: HTMLButtonElement;
}

function build(opts?: { hideB?: boolean }): Built {
  // Outside trigger that focus should restore to.
  const trigger = document.createElement("button");
  trigger.id = "trigger";
  trigger.textContent = "open";
  document.body.appendChild(trigger);

  const overlay = document.createElement("div");
  overlay.className = "host-overlay";
  const panel = document.createElement("div");
  panel.className = "host-panel";

  const inputA = document.createElement("input");
  inputA.type = "text";
  inputA.id = "a";
  const inputB = document.createElement("input");
  inputB.type = "text";
  inputB.id = "b";
  if (opts?.hideB) inputB.style.display = "none";
  const buttonClose = document.createElement("button");
  buttonClose.type = "button";
  buttonClose.id = "close";
  buttonClose.textContent = "Close";

  panel.appendChild(inputA);
  panel.appendChild(inputB);
  panel.appendChild(buttonClose);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  trigger.focus();
  return { overlay, panel, inputA, inputB, buttonClose };
}

describe("[U1] ModalHost — static a11y attributes", () => {
  test("sets role=dialog + aria-modal on construction", async () => {
    const { ModalHost } = await loadHost();
    const { overlay, panel } = build();
    new ModalHost({ overlay, panel, onClose: () => {} });
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
  });

  test("wires aria-labelledby + aria-describedby when provided", async () => {
    const { ModalHost } = await loadHost();
    const { overlay, panel } = build();
    new ModalHost({
      overlay,
      panel,
      labelledBy: "the-title",
      describedBy: "the-desc",
      onClose: () => {},
    });
    expect(overlay.getAttribute("aria-labelledby")).toBe("the-title");
    expect(overlay.getAttribute("aria-describedby")).toBe("the-desc");
  });
});

describe("[U1] ModalHost — focus restore", () => {
  test("close() returns focus to the pre-open element", async () => {
    const { ModalHost } = await loadHost();
    const { overlay, panel, inputA } = build();
    const trigger = document.getElementById("trigger")!;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const host = new ModalHost({ overlay, panel, onClose: () => host.close() });
    host.open();
    inputA.focus();
    expect(document.activeElement).toBe(inputA);

    host.close();
    expect(document.activeElement).toBe(trigger);
  });

  test("close() is safe when the trigger is no longer in the DOM", async () => {
    const { ModalHost } = await loadHost();
    const { overlay, panel } = build();
    const trigger = document.getElementById("trigger")!;
    trigger.focus();

    const host = new ModalHost({ overlay, panel, onClose: () => host.close() });
    host.open();
    trigger.remove();
    expect(() => host.close()).not.toThrow();
  });
});

describe("[U1] ModalHost — focus trap", () => {
  function pressTab(target: HTMLElement, shift = false): void {
    const ev = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(ev);
  }

  test("Tab past the last focusable wraps to the first", async () => {
    const { ModalHost } = await loadHost();
    const { overlay, panel, inputA, buttonClose } = build();
    const host = new ModalHost({ overlay, panel, onClose: () => {} });
    host.open();
    buttonClose.focus();
    pressTab(buttonClose);
    expect(document.activeElement).toBe(inputA);
    host.destroy();
  });

  test("Shift+Tab past the first focusable wraps to the last", async () => {
    const { ModalHost } = await loadHost();
    const { overlay, panel, inputA, buttonClose } = build();
    const host = new ModalHost({ overlay, panel, onClose: () => {} });
    host.open();
    inputA.focus();
    pressTab(inputA, true);
    expect(document.activeElement).toBe(buttonClose);
    host.destroy();
  });

  test("Tab from outside the panel pulls focus to the first inside", async () => {
    const { ModalHost } = await loadHost();
    const { overlay, panel, inputA } = build();
    const host = new ModalHost({ overlay, panel, onClose: () => {} });
    host.open();
    // Focus the panel itself (not a focusable descendant); Tab should
    // pull into the first focusable inside.
    panel.setAttribute("tabindex", "-1");
    panel.focus();
    pressTab(panel);
    expect(document.activeElement).toBe(inputA);
    host.destroy();
  });
});

describe("[U1] ModalHost — Escape", () => {
  test("Escape calls onClose when escapeCloses is default (true)", async () => {
    const { ModalHost } = await loadHost();
    const { overlay, panel } = build();
    let closed = 0;
    const host = new ModalHost({
      overlay,
      panel,
      onClose: () => {
        closed++;
      },
    });
    host.open();
    overlay.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(closed).toBe(1);
    host.destroy();
  });

  test("Escape is ignored when escapeCloses=false", async () => {
    const { ModalHost } = await loadHost();
    const { overlay, panel } = build();
    let closed = 0;
    const host = new ModalHost({
      overlay,
      panel,
      escapeCloses: false,
      onClose: () => {
        closed++;
      },
    });
    host.open();
    overlay.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(closed).toBe(0);
    host.destroy();
  });
});

describe("[U1] ModalHost — scrim click", () => {
  test("clicking the overlay backdrop calls onClose", async () => {
    const { ModalHost } = await loadHost();
    const { overlay, panel } = build();
    let closed = 0;
    const host = new ModalHost({
      overlay,
      panel,
      onClose: () => {
        closed++;
      },
    });
    host.open();
    // Dispatch mousedown with target === overlay.
    const ev = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(ev, "target", { value: overlay });
    overlay.dispatchEvent(ev);
    expect(closed).toBe(1);
    host.destroy();
  });

  test("clicking inside the panel does NOT call onClose", async () => {
    const { ModalHost } = await loadHost();
    const { overlay, panel, inputA } = build();
    let closed = 0;
    const host = new ModalHost({
      overlay,
      panel,
      onClose: () => {
        closed++;
      },
    });
    host.open();
    const ev = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(ev, "target", { value: inputA });
    overlay.dispatchEvent(ev);
    expect(closed).toBe(0);
    host.destroy();
  });

  test("scrimCloses=false disables the backdrop dismiss", async () => {
    const { ModalHost } = await loadHost();
    const { overlay, panel } = build();
    let closed = 0;
    const host = new ModalHost({
      overlay,
      panel,
      scrimCloses: false,
      onClose: () => {
        closed++;
      },
    });
    host.open();
    const ev = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(ev, "target", { value: overlay });
    overlay.dispatchEvent(ev);
    expect(closed).toBe(0);
    host.destroy();
  });
});

describe("[U1] ModalHost — destroy + idempotency", () => {
  test("destroy() detaches the keydown handler so Escape becomes a no-op", async () => {
    const { ModalHost } = await loadHost();
    const { overlay, panel } = build();
    let closed = 0;
    const host = new ModalHost({
      overlay,
      panel,
      onClose: () => {
        closed++;
      },
    });
    host.open();
    host.destroy();
    overlay.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(closed).toBe(0);
  });

  test("open() / close() are idempotent (double-call no-ops)", async () => {
    const { ModalHost } = await loadHost();
    const { overlay, panel } = build();
    let closed = 0;
    const host = new ModalHost({
      overlay,
      panel,
      onClose: () => {
        closed++;
      },
    });
    expect(() => {
      host.open();
      host.open();
      host.close();
      host.close();
    }).not.toThrow();
    expect(closed).toBe(0); // close() doesn't auto-fire onClose
  });
});

describe("[U1] ModalHost — focusFirst()", () => {
  test("focusFirst() lands focus on the first focusable inside", async () => {
    const { ModalHost } = await loadHost();
    const { overlay, panel, inputA } = build();
    const host = new ModalHost({ overlay, panel, onClose: () => {} });
    host.open();
    host.focusFirst();
    expect(document.activeElement).toBe(inputA);
    host.destroy();
  });

  test("focusFirst() with no focusables falls back to the panel itself", async () => {
    const { ModalHost } = await loadHost();
    // Build a panel with no focusable controls.
    const overlay = document.createElement("div");
    const panel = document.createElement("div");
    panel.appendChild(document.createElement("span")); // non-focusable
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const host = new ModalHost({ overlay, panel, onClose: () => {} });
    host.open();
    host.focusFirst();
    expect(document.activeElement).toBe(panel);
    expect(panel.getAttribute("tabindex")).toBe("-1");
    host.destroy();
  });
});
