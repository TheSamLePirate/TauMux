// I14 — verify the theme preset picker re-renders the swatch row on the
// same tick as the click, so the active-preset border moves immediately
// instead of waiting for a panel close/reopen cycle.

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

async function loadSettingsPanel() {
  const mod = await import("../src/views/terminal/settings-panel");
  const { DEFAULT_SETTINGS, THEME_PRESETS } =
    await import("../src/shared/settings");
  return { ...mod, DEFAULT_SETTINGS, THEME_PRESETS };
}

describe("SettingsPanel — theme preset feedback (I14)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("clicking a non-active preset moves the .active class on the same tick", async () => {
    const { SettingsPanel, DEFAULT_SETTINGS, THEME_PRESETS } =
      await loadSettingsPanel();

    const partials: unknown[] = [];
    const panel = new SettingsPanel((p) => partials.push(p));

    // Open Theme so its swatches render. Use a settings object whose
    // active preset is the first; we'll click the second to verify the
    // active class moves without waiting for an external updateSettings.
    const startSettings = {
      ...DEFAULT_SETTINGS,
      themePreset: THEME_PRESETS[0]!.id,
    };
    panel.show(startSettings);

    // Switch to Theme section. The panel persists section state via
    // localStorage; force-set by clicking the nav button matching Theme.
    const themeNavBtn = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".settings-nav-item"),
    ).find((b) => b.textContent?.includes("Theme"));
    expect(themeNavBtn, "Theme nav button must exist").toBeDefined();
    themeNavBtn!.click();

    const cards = document.querySelectorAll<HTMLElement>(".theme-card");
    expect(cards.length).toBeGreaterThanOrEqual(2);

    // Sanity: the first card should be active to start.
    expect(cards[0]!.classList.contains("active")).toBe(true);
    expect(cards[1]!.classList.contains("active")).toBe(false);

    cards[1]!.click();

    // Re-query — renderActiveSection rebuilds the section, so the old
    // node references are detached; the new active card sits at the
    // same DOM index because preset ordering is stable.
    const cardsAfter = document.querySelectorAll<HTMLElement>(".theme-card");
    expect(cardsAfter[1]!.classList.contains("active")).toBe(true);
    expect(cardsAfter[0]!.classList.contains("active")).toBe(false);

    // The change should also have been emitted.
    expect(partials.length).toBe(1);
  });
});
