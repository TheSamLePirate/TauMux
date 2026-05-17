// P7 S25 / Cluster B U10 — per-field reset-to-default in the settings
// panel.
//
// fieldRow() now accepts an optional `resetKey` that pipes through to
// every field-creator helper (textField / numberField / toggleField /
// selectField / sliderField / segmentedField / colorField). When the
// live value differs from DEFAULT_SETTINGS, a "↺" button appears in
// the label-wrap; click → emit(default).

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

async function loadPanel() {
  const settingsMod = await import("../src/shared/settings");
  const panelMod = await import("../src/views/terminal/settings-panel");
  return { ...settingsMod, ...panelMod };
}

function findRow(label: string): HTMLElement | undefined {
  const labels = [
    ...document.querySelectorAll<HTMLElement>(".settings-field-label"),
  ];
  const match = labels.find((l) => l.textContent === label);
  if (!match) return undefined;
  // .settings-field-label → .settings-field-label-wrap → .settings-field
  return match.parentElement?.parentElement as HTMLElement | undefined;
}

describe("settings reset-to-default (S25)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("button is hidden when the field is at default", async () => {
    const { SettingsPanel, DEFAULT_SETTINGS } = await loadPanel();
    const panel = new SettingsPanel(() => {});
    panel.show({ ...DEFAULT_SETTINGS });

    const row = findRow("Scrollback Lines");
    expect(row).toBeTruthy();
    const btn = row!.querySelector<HTMLButtonElement>(".settings-field-reset");
    expect(btn).not.toBeNull();
    expect(btn!.classList.contains("settings-field-reset-hidden")).toBe(true);
  });

  test("button shows when the live value differs from default", async () => {
    const { SettingsPanel, DEFAULT_SETTINGS } = await loadPanel();
    const panel = new SettingsPanel(() => {});
    panel.show({ ...DEFAULT_SETTINGS, scrollbackLines: 24 });

    const row = findRow("Scrollback Lines");
    const btn = row!.querySelector<HTMLButtonElement>(".settings-field-reset");
    expect(btn).not.toBeNull();
    expect(btn!.classList.contains("settings-field-reset-hidden")).toBe(false);
    expect(btn!.title).toContain("Scrollback Lines");
    expect(btn!.getAttribute("aria-label")).toContain("Scrollback Lines");
  });

  test("clicking the button emits the DEFAULT_SETTINGS value", async () => {
    const { SettingsPanel, DEFAULT_SETTINGS } = await loadPanel();
    const emits: Array<Record<string, unknown>> = [];
    const panel = new SettingsPanel((partial) =>
      emits.push(partial as Record<string, unknown>),
    );
    panel.show({ ...DEFAULT_SETTINGS, scrollbackLines: 24 });

    const row = findRow("Scrollback Lines");
    const btn = row!.querySelector<HTMLButtonElement>(".settings-field-reset");
    btn!.click();

    expect(emits.length).toBeGreaterThan(0);
    const last = emits[emits.length - 1]!;
    expect(last["scrollbackLines"]).toBe(DEFAULT_SETTINGS.scrollbackLines);
  });

  test("button hides again after the value returns to default", async () => {
    const { SettingsPanel, DEFAULT_SETTINGS } = await loadPanel();
    const panel = new SettingsPanel(() => {});
    panel.show({ ...DEFAULT_SETTINGS, scrollbackLines: 24 });

    // Flip back to the default and re-render.
    panel.updateSettings({ ...DEFAULT_SETTINGS });

    const row = findRow("Scrollback Lines");
    const btn = row!.querySelector<HTMLButtonElement>(".settings-field-reset");
    expect(btn!.classList.contains("settings-field-reset-hidden")).toBe(true);
  });
});
