import { test, expect, requireTier2 } from "../fixtures";

test.describe("terminal search", () => {
  test.beforeEach(async ({ app }) => {
    requireTier2(app);
  });

  test("⌘F opens the search bar", async ({ app }) => {
    await app.rpc.ui.keydown({ key: "f", meta: true });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).searchBarVisible, {
        timeout: 2_000,
      })
      .toBe(true);
  });

  test("second ⌘F toggles the search bar closed", async ({ app }) => {
    await app.rpc.ui.keydown({ key: "f", meta: true });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).searchBarVisible, {
        timeout: 2_000,
      })
      .toBe(true);
    await app.rpc.ui.keydown({ key: "f", meta: true });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).searchBarVisible, {
        timeout: 2_000,
      })
      .toBe(false);
  });

  test("Escape inside the search bar closes it", async ({ app }) => {
    await app.rpc.ui.keydown({ key: "f", meta: true });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).searchBarVisible, {
        timeout: 2_000,
      })
      .toBe(true);
    await app.rpc.ui.keydown({ key: "Escape" });
    await expect
      .poll(async () => (await app.rpc.ui.readState()).searchBarVisible, {
        timeout: 2_000,
      })
      .toBe(false);
  });
});
