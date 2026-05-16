// Triple-A G.6 / L8 — verify CommandPalette.destroy() cleans up cleanly.
// Backfill from Phase 0 audit (PR 5 in tracking_triple_a_analysis.md).
//
// The bug: every electrobun-dev hot-reload re-instantiated the palette,
// and document/window-level Escape listeners accumulated with stale
// `this`. The fix routes every listener through a single AbortController
// signal and aborts it in destroy().

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
  // Reset DOM between tests.
  document.body.innerHTML = "";
});

async function loadPalette() {
  return await import("../src/views/terminal/command-palette");
}

describe("[L8] CommandPalette destroy lifecycle", () => {
  test("destroy() removes the overlay from the DOM", async () => {
    const { CommandPalette } = await loadPalette();
    // The constructor self-appends to document.body — no separate mount().
    const palette = new CommandPalette();

    const overlay = document.body.querySelector(".palette-overlay");
    expect(overlay).not.toBeNull();

    palette.destroy();
    expect(document.body.querySelector(".palette-overlay")).toBeNull();
  });

  test("destroy() aborts the AbortController used for listeners", async () => {
    const { CommandPalette } = await loadPalette();
    // The constructor self-appends to document.body — no separate mount().
    const palette = new CommandPalette();

    // Reach into the private `abort` field to verify signal state.
    // The single-AbortController pattern is the L8 fix invariant —
    // a future refactor that re-introduces per-listener removeEventListener
    // calls would break this test and surface the regression.
    const abort = (palette as unknown as { abort: AbortController }).abort;
    expect(abort.signal.aborted).toBe(false);

    palette.destroy();
    expect(abort.signal.aborted).toBe(true);
  });

  test("destroy() is safe to call when overlay was already removed", async () => {
    const { CommandPalette } = await loadPalette();
    const palette = new CommandPalette();
    // Remove the overlay manually to exercise the parentElement-null
    // path inside destroy().
    document.body.innerHTML = "";
    expect(() => palette.destroy()).not.toThrow();
  });
});

describe("[U1] CommandPalette — ModalHost integration", () => {
  test("overlay carries role=dialog + aria-modal after construction", async () => {
    const { CommandPalette } = await loadPalette();
    new CommandPalette();
    const overlay = document.body.querySelector(".palette-overlay")!;
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
  });

  test("Escape closes the palette via the host", async () => {
    const { CommandPalette } = await loadPalette();
    const palette = new CommandPalette();
    palette.show();
    expect(palette.isVisible()).toBe(true);
    const overlay = document.body.querySelector(".palette-overlay")!;
    overlay.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(palette.isVisible()).toBe(false);
  });

  test("scrim click closes; click on the container doesn't", async () => {
    const { CommandPalette } = await loadPalette();
    const palette = new CommandPalette();
    palette.show();
    const overlay = document.body.querySelector(".palette-overlay")!;
    const container = overlay.querySelector(".palette-container")!;

    // Click inside the container — should NOT close.
    const innerEv = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(innerEv, "target", { value: container });
    overlay.dispatchEvent(innerEv);
    expect(palette.isVisible()).toBe(true);

    // Click on the scrim (overlay itself) — should close.
    const scrimEv = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(scrimEv, "target", { value: overlay });
    overlay.dispatchEvent(scrimEv);
    expect(palette.isVisible()).toBe(false);
  });

  test("show() restores focus to the previously-focused element on hide()", async () => {
    const { CommandPalette } = await loadPalette();
    const trigger = document.createElement("button");
    trigger.id = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const palette = new CommandPalette();
    palette.show();
    // Focus is on the input now.
    expect(document.activeElement).not.toBe(trigger);
    palette.hide();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("[U15] CommandPalette — IME composition guard on Enter", () => {
  function pressEnter(
    input: HTMLInputElement,
    opts?: { isComposing?: boolean },
  ): void {
    const ev = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    if (opts?.isComposing) {
      Object.defineProperty(ev, "isComposing", { value: true });
    }
    input.dispatchEvent(ev);
  }

  test("Enter while composing does NOT execute a command", async () => {
    const { CommandPalette } = await loadPalette();
    const palette = new CommandPalette();
    let fired = 0;
    palette.setCommands([
      {
        id: "noop",
        label: "Noop",
        action: () => {
          fired++;
        },
      },
    ]);
    palette.show();
    const input = document.body.querySelector(
      ".palette-input",
    ) as HTMLInputElement;

    // Start composition — palette tracks this internally.
    input.dispatchEvent(new Event("compositionstart"));
    pressEnter(input);
    expect(fired).toBe(0);

    // End composition — Enter should now fire again.
    input.dispatchEvent(new Event("compositionend"));
    pressEnter(input);
    expect(fired).toBe(1);
  });

  test("Enter with isComposing=true on the event itself is also ignored", async () => {
    const { CommandPalette } = await loadPalette();
    const palette = new CommandPalette();
    let fired = 0;
    palette.setCommands([
      {
        id: "noop",
        label: "Noop",
        action: () => {
          fired++;
        },
      },
    ]);
    palette.show();
    const input = document.body.querySelector(
      ".palette-input",
    ) as HTMLInputElement;
    // Some browsers don't fire compositionend before the commit-Enter;
    // they set isComposing on the KeyboardEvent itself.
    pressEnter(input, { isComposing: true });
    expect(fired).toBe(0);
  });
});
