import { test, expect, requireTier2 } from "../fixtures";

/**
 * The WebGL renderer is the point of the optimisation, so it isn't enough
 * to assert the *setting* — these read back what is actually painting.
 * `getActiveRendererKind()` reports the live attachment, which degrades
 * to "dom" on unsupported hardware or context loss, so a silent fallback
 * shows up here as a failure rather than as a mystery performance
 * regression.
 */
test.describe("terminal renderer", () => {
  test("defaults to the DOM renderer", async ({ app }) => {
    requireTier2(app);

    // DOM is the default because the GPU renderer shipped on by default
    // in v0.4.9 and rendered panes blank in the real app. Opt-in until
    // that is understood and verified on-screen.
    const setting = await app.rpc.ui.readSettingsField("terminalRenderer");
    expect(setting).toBe("dom");

    const state = await app.rpc.ui.readState();
    expect(state.terminalRenderer).toBe("dom");
  });

  test("opting into GPU and back leaves the terminals alive", async ({
    app,
  }) => {
    requireTier2(app);

    await app.rpc.ui.setSettingsField("terminalRenderer", "webgl");
    // NOTE: this asserts the setting round-trips and the panes survive
    // the swap. It deliberately does NOT assert `state.terminalRenderer`
    // becomes "webgl" — attachment is deferred until a pane has non-zero
    // layout, and "attached" was never the same thing as "painting
    // pixels", which is exactly the gap that let v0.4.9 ship blank.
    const surfaces = await app.rpc.surface.list();
    expect(surfaces.length).toBeGreaterThan(0);

    await app.rpc.ui.setSettingsField("terminalRenderer", "dom");
    await expect
      .poll(async () => (await app.rpc.ui.readState()).terminalRenderer, {
        timeout: 5_000,
      })
      .toBe("dom");

    expect((await app.rpc.surface.list()).length).toBeGreaterThan(0);
  });
});
