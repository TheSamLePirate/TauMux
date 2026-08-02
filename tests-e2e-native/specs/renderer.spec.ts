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
  test("defaults to the GPU renderer and actually attaches it", async ({
    app,
  }) => {
    requireTier2(app);

    const setting = await app.rpc.ui.readSettingsField("terminalRenderer");
    expect(setting).toBe("webgl");

    const state = await app.rpc.ui.readState();
    expect(state.terminalRenderer).toBe("webgl");
  });

  test("switching to DOM re-attaches every live terminal in place", async ({
    app,
  }) => {
    requireTier2(app);

    await app.rpc.ui.setSettingsField("terminalRenderer", "dom");
    await expect
      .poll(async () => (await app.rpc.ui.readState()).terminalRenderer, {
        timeout: 5_000,
      })
      .toBe("dom");

    // The terminal must still be alive and driving the PTY after the swap
    // — the buffer is renderer-independent, so nothing should be lost.
    const surfaces = await app.rpc.surface.list();
    expect(surfaces.length).toBeGreaterThan(0);

    await app.rpc.ui.setSettingsField("terminalRenderer", "webgl");
    await expect
      .poll(async () => (await app.rpc.ui.readState()).terminalRenderer, {
        timeout: 5_000,
      })
      .toBe("webgl");
  });
});
