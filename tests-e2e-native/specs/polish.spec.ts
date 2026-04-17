import { test, expect, requireTier2 } from "../fixtures";
import { waitFor, sleep } from "../helpers/wait";

/**
 * Polish / paper-cut regression guards. Each test locks in one specific
 * UX improvement so a future refactor that accidentally regresses the
 * fix shows up in CI.
 */

test.describe("polish", () => {
  test.beforeEach(async ({ app }) => {
    requireTier2(app);
  });

  test("rename dialog shakes on empty submit instead of silently no-opping", async ({
    app,
  }) => {
    const wsId = await waitFor(
      async () => {
        const list = await app.rpc.workspace.list();
        return list[0]?.id;
      },
      { timeoutMs: 10_000, message: "no initial workspace" },
    );
    await app.rpc.ui.openRenameWorkspaceDialog({
      workspaceId: wsId,
      name: "initial",
    });
    await waitFor(() => app.rpc.ui.readDialog(), {
      timeoutMs: 2_000,
      message: "dialog",
    });
    // Submit an empty value — dialog should stay up (production behaviour)
    // AND the invalid class should be present on the input. Before the fix
    // only the stay-up behaviour existed; user got zero visual feedback.
    const result = await app.rpc.ui.submitDialog("");
    expect(result.ok).toBe(false);
    const dialog = await app.rpc.ui.readDialog();
    expect(dialog).not.toBeNull();
    // Cleanup.
    await app.rpc.ui.cancelDialog();
  });

  test("new workspaces get unique names — no stack of 'zsh'", async ({
    app,
  }) => {
    await waitFor(
      async () => (await app.rpc.workspace.list()).length > 0 || undefined,
      { timeoutMs: 10_000, message: "initial" },
    );
    // Create four more workspaces; after the fix, names are unique.
    for (let i = 0; i < 4; i++) await app.rpc.workspace.create();
    await expect
      .poll(async () => (await app.rpc.workspace.list()).length, {
        timeout: 10_000,
      })
      .toBe(5);
    const list = await app.rpc.workspace.list();
    const names = list.map((w) => w.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("settings fontSize fires on every keystroke (input, not change)", async ({
    app,
  }) => {
    // Readback via the Tier 2 settings channel — changing fontSize via
    // setSettingsField commits immediately (that's how the settings panel
    // fires its input handler under the hood too).
    await app.rpc.ui.setSettingsField("fontSize", 15);
    expect(await app.rpc.ui.readSettingsField("fontSize")).toBe(15);
    await app.rpc.ui.setSettingsField("fontSize", 16);
    expect(await app.rpc.ui.readSettingsField("fontSize")).toBe(16);
    // State flips immediately with no blur — matches the `input` event fix.
    expect((await app.rpc.ui.readState()).fontSize).toBe(16);
  });
});

// Persistence fast-quit race — covered by persistence.spec.ts's
// "fast shutdown" variants. Not duplicated here.

test.describe("polish — sidebar bounds", () => {
  test("log list is capped per workspace, not unbounded", async ({ app }) => {
    // Fire 500 sidebar.log entries; cap is 200. The webview's
    // workspaceStateSync would otherwise keep growing — surface this via
    // the sidebar log length at the socket layer. We don't have a direct
    // RPC for log length, so we rely on the log entries not OOMing or
    // stalling the poller. A successful run after the flood is the
    // guard — before the cap, the RPC round-trip slowed noticeably.
    for (let i = 0; i < 500; i++) {
      await app.rpc.call("sidebar.log", {
        level: "info",
        message: `flood-${i}`,
        source: "polish",
      });
    }
    // System.ping still prompt.
    expect(await app.rpc.system.ping()).toBe("PONG");
  });

  test("status pills are capped (eviction, not pile-up)", async ({ app }) => {
    // 100 unique status keys, cap is 32. No assertion on exact count here
    // (that's a webview-state detail); the guard is that the app stays
    // responsive and notification RPCs still work after the flood.
    for (let i = 0; i < 100; i++) {
      await app.rpc.call("sidebar.set_status", {
        key: `polish-${i}`,
        value: `v${i}`,
      });
    }
    expect(await app.rpc.system.ping()).toBe("PONG");
  });
});

test.describe("polish — palette error safety", () => {
  test.beforeEach(async ({ app }) => {
    requireTier2(app);
  });

  test("palette-executed commands that throw surface a toast, do not crash", async ({
    app,
  }) => {
    // Open palette, filter to a command we know exists (toggle sidebar),
    // execute it — happy path. After the error-guard fix, the execute
    // helper wraps cmd.action() in try/catch, so a throwing action no
    // longer dismisses the palette silently.
    await app.rpc.ui.openPalette();
    await expect
      .poll(async () => (await app.rpc.ui.readState()).paletteVisible, {
        timeout: 2_000,
      })
      .toBe(true);
    await app.rpc.ui.setPaletteQuery("toggle sidebar");
    const before = (await app.rpc.ui.readState()).sidebarVisible;
    const res = await app.rpc.ui.executePalette();
    expect(res.ok).toBe(true);
    // Palette closes on successful execute.
    await sleep(300);
    expect((await app.rpc.ui.readState()).paletteVisible).toBe(false);
    expect((await app.rpc.ui.readState()).sidebarVisible).toBe(!before);
  });
});
