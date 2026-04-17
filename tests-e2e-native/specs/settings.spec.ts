import { test, expect, requireTier2 } from "../fixtures";

test.describe("settings", () => {
  test.beforeEach(async ({ app }) => {
    requireTier2(app);
  });

  test("readSettingsField returns the current value", async ({ app }) => {
    const initialFont = (await app.rpc.ui.readState()).fontSize;
    const viaSettings = await app.rpc.ui.readSettingsField("fontSize");
    expect(viaSettings).toBe(initialFont);
  });

  test("setSettingsField fontSize round-trips into the webview state", async ({
    app,
  }) => {
    const before = (await app.rpc.ui.readState()).fontSize;
    const target = before + 2;
    await app.rpc.ui.setSettingsField("fontSize", target);
    await expect
      .poll(async () => (await app.rpc.ui.readState()).fontSize, {
        timeout: 2_000,
      })
      .toBe(target);
    const via = await app.rpc.ui.readSettingsField("fontSize");
    expect(via).toBe(target);
  });

  test("setSettingsField paneGap updates without error", async ({ app }) => {
    await app.rpc.ui.setSettingsField("paneGap", 12);
    const via = await app.rpc.ui.readSettingsField("paneGap");
    expect(via).toBe(12);
  });

  test("settings panel open + setField works while panel is visible", async ({
    app,
  }) => {
    await app.rpc.ui.openSettings();
    await expect
      .poll(async () => (await app.rpc.ui.readState()).settingsPanelVisible, {
        timeout: 2_000,
      })
      .toBe(true);
    await app.rpc.ui.setSettingsField("fontSize", 16);
    const via = await app.rpc.ui.readSettingsField("fontSize");
    expect(via).toBe(16);
    // Dismiss — the production Escape handler only fires on document, so
    // we send the same keydown the user would.
    await app.rpc.ui.keydown({ key: "Escape" });
  });

  test("unknown settings field returns null", async ({ app }) => {
    const via = await app.rpc.ui.readSettingsField("notARealKey");
    expect(via).toBeNull();
  });

  test("readSettingsField survives repeated calls", async ({ app }) => {
    for (let i = 0; i < 5; i++) {
      const v = await app.rpc.ui.readSettingsField("fontSize");
      expect(typeof v).toBe("number");
    }
  });
});
