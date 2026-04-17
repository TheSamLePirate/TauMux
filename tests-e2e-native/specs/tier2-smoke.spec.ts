import { test, expect, requireTier2 } from "../fixtures";

test.describe("tier 2 smoke", () => {
  test("tier 2 handlers are ready on boot", async ({ app }) => {
    expect(app.info.tier2Ready).toBe(true);
  });

  test("capabilities includes __test.* methods", async ({ app }) => {
    requireTier2(app);
    const caps = await app.rpc.system.capabilities();
    expect(caps.methods).toContain("__test.readWebviewState");
    expect(caps.methods).toContain("__test.keydown");
    expect(caps.methods).toContain("__test.readDialog");
    expect(caps.methods).toContain("__test.setSettingsField");
  });

  test("readState returns a well-shaped snapshot", async ({ app }) => {
    requireTier2(app);
    const state = await app.rpc.ui.readState();
    expect(typeof state.sidebarVisible).toBe("boolean");
    expect(typeof state.paletteVisible).toBe("boolean");
    expect(typeof state.settingsPanelVisible).toBe("boolean");
    expect(typeof state.fontSize).toBe("number");
  });

  test("⌘B via keydown toggles sidebar", async ({ app }) => {
    requireTier2(app);
    const before = (await app.rpc.ui.readState()).sidebarVisible;
    await app.rpc.ui.keydown({ key: "b", meta: true });
    // Bindings run synchronously, but DOM class changes can schedule a
    // transition; poll the state flag for up to 2s.
    await expect
      .poll(async () => (await app.rpc.ui.readState()).sidebarVisible, {
        timeout: 2_000,
      })
      .toBe(!before);
  });
});
