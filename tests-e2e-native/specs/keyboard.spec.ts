import { test, expect, requireTier2 } from "../fixtures";
import { sleep } from "../helpers/wait";

/**
 * Drive every major keyboard shortcut via `__test.keydown` and assert on
 * its observable effect — typically a webview state flip or a workspace/
 * surface mutation.
 */
test.describe("keyboard", () => {
  test.beforeEach(async ({ app }) => {
    requireTier2(app);
  });

  test("⌘B toggles the sidebar", async ({ app }) => {
    const before = (await app.rpc.ui.readState()).sidebarVisible;
    await app.rpc.ui.keydown({ key: "b", meta: true });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).sidebarVisible, {
        timeout: 2_000,
      })
      .toBe(!before);
  });

  test("⌘⇧P opens the command palette", async ({ app }) => {
    await app.rpc.ui.keydown({ key: "p", meta: true, shift: true });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).paletteVisible, {
        timeout: 2_000,
      })
      .toBe(true);
  });

  test("⌘, opens the settings panel; Escape closes it", async ({ app }) => {
    await app.rpc.ui.keydown({ key: ",", meta: true });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).settingsPanelVisible, {
        timeout: 2_000,
      })
      .toBe(true);
    await app.rpc.ui.keydown({ key: "Escape" });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).settingsPanelVisible, {
        timeout: 2_000,
      })
      .toBe(false);
  });

  test("⌘⌥P toggles the process manager", async ({ app }) => {
    const before = (await app.rpc.ui.readState()).processManagerVisible;
    await app.rpc.ui.keydown({ key: "p", meta: true, alt: true });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).processManagerVisible, {
        timeout: 2_000,
      })
      .toBe(!before);
  });

  test("⌘N dispatches createSurface — surface count grows", async ({ app }) => {
    const before = (await app.rpc.surface.list()).length;
    await app.rpc.ui.keydown({ key: "n", meta: true });
    await expect
      .poll(async () => (await app.rpc.surface.list()).length, {
        timeout: 5_000,
      })
      .toBeGreaterThan(before);
  });

  test("⌘D splits horizontally", async ({ app }) => {
    const before = (await app.rpc.surface.list()).length;
    await app.rpc.ui.keydown({ key: "d", meta: true });
    await expect
      .poll(async () => (await app.rpc.surface.list()).length, {
        timeout: 5_000,
      })
      .toBe(before + 1);
  });

  test("⌘W closes focused surface", async ({ app }) => {
    // Split first so we have two surfaces, then close via ⌘W.
    await app.rpc.surface.split({ direction: "horizontal" });
    await expect
      .poll(async () => (await app.rpc.surface.list()).length, {
        timeout: 5_000,
      })
      .toBe(2);
    await app.rpc.ui.keydown({ key: "w", meta: true });
    await expect
      .poll(async () => (await app.rpc.surface.list()).length, {
        timeout: 5_000,
      })
      .toBe(1);
  });

  test("⌘F opens terminal search", async ({ app }) => {
    await app.rpc.ui.keydown({ key: "f", meta: true });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).searchBarVisible, {
        timeout: 2_000,
      })
      .toBe(true);
  });

  test("⌘= / ⌘- step font size within bounds", async ({ app }) => {
    const initial = (await app.rpc.ui.readState()).fontSize;
    await app.rpc.ui.keydown({ key: "=", meta: true });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).fontSize, {
        timeout: 2_000,
      })
      .toBeGreaterThan(initial);
    await app.rpc.ui.keydown({ key: "-", meta: true });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).fontSize, {
        timeout: 2_000,
      })
      .toBe(initial);
  });

  test("palette-visible gate: ⌘D does NOT split while palette is open", async ({
    app,
  }) => {
    await app.rpc.ui.openPalette();
    await expect
      .poll(async () => (await app.rpc.ui.readState()).paletteVisible, {
        timeout: 2_000,
      })
      .toBe(true);
    const before = (await app.rpc.surface.list()).length;
    await app.rpc.ui.keydown({ key: "d", meta: true });
    await sleep(500);
    const after = (await app.rpc.surface.list()).length;
    expect(after).toBe(before);
  });

  test("settings-visible gate: ⌘B is swallowed while settings panel open", async ({
    app,
  }) => {
    await app.rpc.ui.openSettings();
    await expect
      .poll(async () => (await app.rpc.ui.readState()).settingsPanelVisible, {
        timeout: 2_000,
      })
      .toBe(true);
    const before = (await app.rpc.ui.readState()).sidebarVisible;
    await app.rpc.ui.keydown({ key: "b", meta: true });
    await sleep(400);
    expect((await app.rpc.ui.readState()).sidebarVisible).toBe(before);
  });

  test("⌘⇧P even works when palette is already open (it stays on the high-priority path)", async ({
    app,
  }) => {
    await app.rpc.ui.openPalette();
    await expect
      .poll(async () => (await app.rpc.ui.readState()).paletteVisible, {
        timeout: 2_000,
      })
      .toBe(true);
    // ⌘⇧P is in HIGH_PRIORITY_BINDINGS — it toggles the palette via
    // openCommandPalette() which turns into show() when closed, hide() when
    // open. Firing it while visible should close it.
    await app.rpc.ui.keydown({ key: "p", meta: true, shift: true });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).paletteVisible, {
        timeout: 2_000,
      })
      .toBe(false);
  });
});
