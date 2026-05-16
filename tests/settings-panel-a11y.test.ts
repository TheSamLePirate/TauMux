// Phase 1 / U1 — SettingsPanel a11y integration with ModalHost.
//
// Until Phase 1 the settings-panel had only the theme-feedback test;
// the modal lifecycle + a11y attrs were uncovered. These tests pin
// the U1 invariants.

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

async function loadPanel() {
  return await import("../src/views/terminal/settings-panel");
}

async function buildDefaultSettings() {
  // Import via dynamic so the test runner discovers the actual default
  // shape rather than re-declaring it here (which would rot).
  return (await import("../src/shared/settings")).DEFAULT_SETTINGS;
}

describe("SettingsPanel — lifecycle", () => {
  test("constructor mounts a hidden overlay onto document.body", async () => {
    const { SettingsPanel } = await loadPanel();
    new SettingsPanel({
      onChange: () => {},
      getWorkspaces: () => [],
    });
    const overlay = document.body.querySelector(".settings-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.classList.contains("visible")).toBe(false);
  });

  test("show() then hide() toggles visibility class", async () => {
    const { SettingsPanel } = await loadPanel();
    const panel = new SettingsPanel({
      onChange: () => {},
      getWorkspaces: () => [],
    });
    const overlay = document.body.querySelector(
      ".settings-overlay",
    ) as HTMLElement;
    const settings = await buildDefaultSettings();
    panel.show(settings);
    expect(panel.isVisible()).toBe(true);
    expect(overlay.classList.contains("visible")).toBe(true);
    panel.hide();
    expect(panel.isVisible()).toBe(false);
    expect(overlay.classList.contains("visible")).toBe(false);
  });

  test("show()/hide() are idempotent", async () => {
    const { SettingsPanel } = await loadPanel();
    const panel = new SettingsPanel({
      onChange: () => {},
      getWorkspaces: () => [],
    });
    const settings = await buildDefaultSettings();
    expect(() => {
      panel.show(settings);
      panel.show(settings);
      panel.hide();
      panel.hide();
    }).not.toThrow();
  });
});

describe("[U1] SettingsPanel — ModalHost a11y attrs", () => {
  test("overlay carries role=dialog + aria-modal + aria-labelledby", async () => {
    const { SettingsPanel } = await loadPanel();
    new SettingsPanel({
      onChange: () => {},
      getWorkspaces: () => [],
    });
    const overlay = document.body.querySelector(
      ".settings-overlay",
    ) as HTMLElement;
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    expect(overlay.getAttribute("aria-labelledby")).toBe(
      "settings-panel-title",
    );
    expect(document.getElementById("settings-panel-title")?.textContent).toBe(
      "Settings",
    );
  });
});

describe("[U1] SettingsPanel — close paths", () => {
  test("Escape on the overlay closes the panel", async () => {
    const { SettingsPanel } = await loadPanel();
    const panel = new SettingsPanel({
      onChange: () => {},
      getWorkspaces: () => [],
    });
    const settings = await buildDefaultSettings();
    panel.show(settings);
    const overlay = document.body.querySelector(".settings-overlay")!;
    overlay.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(panel.isVisible()).toBe(false);
  });

  test("scrim click closes; click inside the panel does not", async () => {
    const { SettingsPanel } = await loadPanel();
    const panel = new SettingsPanel({
      onChange: () => {},
      getWorkspaces: () => [],
    });
    const settings = await buildDefaultSettings();
    panel.show(settings);
    const overlay = document.body.querySelector(".settings-overlay")!;
    const inner = overlay.querySelector(".settings-panel")!;

    const innerEv = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(innerEv, "target", { value: inner });
    overlay.dispatchEvent(innerEv);
    expect(panel.isVisible()).toBe(true);

    const scrimEv = new MouseEvent("mousedown", { bubbles: true });
    Object.defineProperty(scrimEv, "target", { value: overlay });
    overlay.dispatchEvent(scrimEv);
    expect(panel.isVisible()).toBe(false);
  });

  test("close-button click closes the panel", async () => {
    const { SettingsPanel } = await loadPanel();
    const panel = new SettingsPanel({
      onChange: () => {},
      getWorkspaces: () => [],
    });
    const settings = await buildDefaultSettings();
    panel.show(settings);
    const closeBtn = document.body.querySelector(
      ".settings-close-btn",
    ) as HTMLButtonElement;
    closeBtn.click();
    expect(panel.isVisible()).toBe(false);
  });
});
