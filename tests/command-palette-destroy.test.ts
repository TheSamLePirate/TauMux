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
