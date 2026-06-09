// Settings slider drag stability.
//
// Bug: dragging a slider stalled to one step at a time. Two causes:
//  (1) the host's applySettings re-entered settingsPanel.updateSettings with a
//      (clamped) echo; if settingsEqual failed it called renderActiveSection()
//      and destroyed the live <input type="range"> mid-drag; and
//  (2) the heavy applySettings ran synchronously on every input event.
// (2) is fixed host-side (rAF coalesce + debounced persist). This test pins
// the panel-side invariant for (1): emit() now stores the validated/clamped
// value, so a host echo of the same value is a no-op and the slider node
// survives across repeated input + echo cycles.

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => GlobalRegistrator.register());
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.innerHTML = "";
});

async function loadPanel() {
  return await import("../src/views/terminal/settings-panel");
}
async function loadSettings() {
  return await import("../src/shared/settings");
}

describe("SettingsPanel — slider drag does not destroy the input", () => {
  test("repeated input + clamped echo keeps the SAME range node (no re-render)", async () => {
    const { SettingsPanel } = await loadPanel();
    const { DEFAULT_SETTINGS, mergeSettings } = await loadSettings();

    const received: number[] = [];
    const panel = new SettingsPanel((partial) => {
      if (typeof partial.fontSize === "number") received.push(partial.fontSize);
    }, {});
    panel.show({
      ...DEFAULT_SETTINGS,
      ansiColors: { ...DEFAULT_SETTINGS.ansiColors },
    });

    // Navigate to Appearance (holds the Font Size slider).
    const navBtn = document.body.querySelector(
      '[data-section="appearance"]',
    ) as HTMLElement | null;
    expect(navBtn).not.toBeNull();
    navBtn!.click();

    const slider = document.body.querySelector(
      'input[type="range"].settings-range',
    ) as HTMLInputElement | null;
    expect(slider).not.toBeNull();

    // Simulate a drag: several input events, each followed by the host
    // applying the (clamped) value back through updateSettings — exactly the
    // echo that used to rebuild the section and break the gesture.
    for (const v of [12, 14, 16, 20, 24]) {
      slider!.value = String(v);
      slider!.dispatchEvent(new Event("input", { bubbles: true }));
      panel.updateSettings(
        mergeSettings(
          {
            ...DEFAULT_SETTINGS,
            ansiColors: { ...DEFAULT_SETTINGS.ansiColors },
          },
          { fontSize: v },
        ),
      );
      // The SAME node must still be mounted — never replaced by a re-render.
      const now = document.body.querySelector(
        'input[type="range"].settings-range',
      );
      expect(now).toBe(slider);
    }

    expect(received).toEqual([12, 14, 16, 20, 24]);
  });
});
