import { test, expect, requireTier2 } from "../fixtures";

test.describe("command palette", () => {
  test.beforeEach(async ({ app }) => {
    requireTier2(app);
  });

  test("opens with ⌘⇧P and lists commands", async ({ app }) => {
    await app.rpc.ui.keydown({ key: "p", meta: true, shift: true });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).paletteVisible, {
        timeout: 2_000,
      })
      .toBe(true);
    const cmds = await app.rpc.ui.readPaletteCommands();
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds.every((c) => typeof c.id === "string" && c.id.length > 0)).toBe(
      true,
    );
  });

  test("filter narrows the command list", async ({ app }) => {
    await app.rpc.ui.openPalette();
    await expect
      .poll(async () => (await app.rpc.ui.readState()).paletteVisible, {
        timeout: 2_000,
      })
      .toBe(true);
    const unfiltered = await app.rpc.ui.readPaletteCommands();
    await app.rpc.ui.setPaletteQuery("sidebar");
    const filtered = await app.rpc.ui.readPaletteCommands();
    expect(filtered.length).toBeLessThan(unfiltered.length);
    // Filter uses a fuzzy match — every char of "sidebar" appears in order
    // in the haystack (label + category + description).
    const fuzzy = new RegExp("sidebar".split("").join(".*"), "i");
    expect(
      filtered.some((c) =>
        fuzzy.test(`${c.label} ${c.category ?? ""} ${c.description ?? ""}`),
      ),
    ).toBe(true);
  });

  test("Escape closes the palette (via keydown)", async ({ app }) => {
    await app.rpc.ui.openPalette();
    await expect
      .poll(async () => (await app.rpc.ui.readState()).paletteVisible, {
        timeout: 2_000,
      })
      .toBe(true);
    // Palette input is focused and swallows Escape internally — use our
    // keydown which dispatches on `document`; the palette's input listener
    // receives the bubbled event.
    await app.rpc.ui.keydown({ key: "Escape" });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).paletteVisible, {
        timeout: 2_000,
      })
      .toBe(false);
  });

  test("executePalette runs the selected command", async ({ app }) => {
    await app.rpc.ui.openPalette();
    await expect
      .poll(async () => (await app.rpc.ui.readState()).paletteVisible, {
        timeout: 2_000,
      })
      .toBe(true);
    // Filter down to a deterministic command: the sidebar toggle.
    await app.rpc.ui.setPaletteQuery("toggle sidebar");
    const filtered = await app.rpc.ui.readPaletteCommands();
    expect(filtered.length).toBeGreaterThan(0);
    const before = (await app.rpc.ui.readState()).sidebarVisible;
    const result = await app.rpc.ui.executePalette();
    expect(result.ok).toBe(true);
    await expect
      .poll(async () => (await app.rpc.ui.readState()).paletteVisible, {
        timeout: 2_000,
      })
      .toBe(false);
    await expect
      .poll(async () => (await app.rpc.ui.readState()).sidebarVisible, {
        timeout: 2_000,
      })
      .toBe(!before);
  });

  test("palette query reflects what setPaletteQuery wrote", async ({ app }) => {
    await app.rpc.ui.openPalette();
    await expect
      .poll(async () => (await app.rpc.ui.readState()).paletteVisible, {
        timeout: 2_000,
      })
      .toBe(true);
    await app.rpc.ui.setPaletteQuery("foo");
    const state = await app.rpc.ui.readState();
    expect(state.paletteQuery).toBe("foo");
  });

  test("commands all have labels and stable ids", async ({ app }) => {
    await app.rpc.ui.openPalette();
    await expect
      .poll(async () => (await app.rpc.ui.readState()).paletteVisible, {
        timeout: 2_000,
      })
      .toBe(true);
    const cmds = await app.rpc.ui.readPaletteCommands();
    const ids = cmds.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of cmds) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(typeof c.id).toBe("string");
    }
  });
});
