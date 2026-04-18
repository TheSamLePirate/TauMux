import { test } from "../fixtures";
import { sleep } from "../helpers/wait";

/**
 * `@design-review` canonical-state snapshots for the native Electrobun
 * app. Run with:
 *   bun run test:native:design-review
 * to regenerate a directory of images fit for manual review, pixel-diff,
 * or the HTML design report (`bun run report:design`).
 *
 * Each test drives the app into a named state and calls `snap()`. The
 * screenshot plus a state blob land in `test-results/screenshots-index.jsonl`.
 *
 * Structure:
 *   - @design-review / components   — per-subsystem views (palette, settings, process-manager, sidebar)
 *   - @design-review / scenarios    — composite layouts (splits, browser, agent, notifications)
 *
 * Tests that need Tier 2 RPC (palette / settings / process manager) bail
 * out gracefully when the harness is running without HYPERTERM_TEST_MODE.
 */

test.describe("@design-review", () => {
  // ── Scenarios: layout + composite views ─────────────────────────────

  test("scenario-boot-empty", async ({ app }) => {
    await sleep(1_000);
    await app.snap("boot-empty", { scenario: "boot-empty" });
  });

  test("scenario-split-horizontal", async ({ app }) => {
    await app.rpc.surface.split({ direction: "horizontal" });
    await sleep(900);
    await app.snap("split-horizontal", { scenario: "split-1x2" });
  });

  test("scenario-split-vertical", async ({ app }) => {
    await app.rpc.surface.split({ direction: "vertical" });
    await sleep(900);
    await app.snap("split-vertical", { scenario: "split-2x1" });
  });

  test("scenario-split-2x2", async ({ app }) => {
    await app.rpc.surface.split({ direction: "horizontal" });
    await sleep(400);
    await app.rpc.surface.split({ direction: "vertical" });
    await sleep(400);
    await app.rpc.surface.split({ direction: "vertical" });
    await sleep(900);
    await app.snap("split-2x2", { scenario: "split-2x2" });
  });

  test("scenario-split-3-unbalanced", async ({ app }) => {
    await app.rpc.surface.split({ direction: "horizontal" });
    await sleep(400);
    await app.rpc.surface.split({ direction: "vertical" });
    await sleep(900);
    await app.snap("split-3-unbalanced", { scenario: "split-3-unbalanced" });
  });

  test("scenario-browser-surface", async ({ app }) => {
    await app.rpc.browser.open({ url: "about:blank" });
    await sleep(2_000);
    await app.snap("browser-surface", { scenario: "browser-about-blank" });
  });

  test("scenario-pty-colors", async ({ app }) => {
    const surfaces = await app.rpc.surface.list();
    const id = surfaces[0]?.id;
    if (!id) return;
    await app.rpc.surface.send_text({
      surface_id: id,
      text: "for i in 1 2 3 4 5 6 7 8; do printf '\\033[3${i}m color ${i} \\033[0m'; done\n",
    });
    await sleep(600);
    await app.snap("pty-colors", { scenario: "pty-colors" });
  });

  test("scenario-pty-long-scrollback", async ({ app }) => {
    const surfaces = await app.rpc.surface.list();
    const id = surfaces[0]?.id;
    if (!id) return;
    await app.rpc.surface.send_text({
      surface_id: id,
      text: "for i in $(seq 1 150); do echo line-$i; done\n",
    });
    await sleep(800);
    await app.snap("pty-long-scrollback", { scenario: "long-scrollback" });
  });

  test("scenario-notification-toast", async ({ app }) => {
    await app.rpc.notification.create({
      title: "Design review",
      body: "Sample notification captured for the design gallery.",
    });
    await sleep(900);
    await app.snap("notification-toast", { scenario: "notification-toast" });
  });

  test("scenario-workspace-second", async ({ app }) => {
    await app.rpc.workspace.create();
    await sleep(800);
    await app.snap("workspace-second", { scenario: "workspace-second" });
  });

  // ── Components: Tier-2 UI states ─────────────────────────────────────

  test("component-sidebar-open", async ({ app }) => {
    if (!app.info.tier2Ready) return;
    const pre = await app.rpc.ui.readState();
    if (!pre.sidebarVisible) await app.rpc.ui.toggleSidebar();
    await sleep(500);
    await app.snap("sidebar-open", { component: "sidebar", open: true });
  });

  test("component-sidebar-closed", async ({ app }) => {
    if (!app.info.tier2Ready) return;
    const pre = await app.rpc.ui.readState();
    if (pre.sidebarVisible) await app.rpc.ui.toggleSidebar();
    await sleep(500);
    await app.snap("sidebar-closed", { component: "sidebar", open: false });
  });

  test("component-palette-open-empty", async ({ app }) => {
    if (!app.info.tier2Ready) return;
    await app.rpc.ui.openPalette();
    await sleep(400);
    await app.snap("palette-open-empty", {
      component: "palette",
      query: "",
    });
  });

  test("component-palette-open-filtered", async ({ app }) => {
    if (!app.info.tier2Ready) return;
    await app.rpc.ui.openPalette();
    await sleep(300);
    await app.rpc.ui.setPaletteQuery("split");
    await sleep(350);
    await app.snap("palette-open-filtered", {
      component: "palette",
      query: "split",
    });
  });

  test("component-settings-general", async ({ app }) => {
    if (!app.info.tier2Ready) return;
    await app.rpc.ui.openSettings();
    await sleep(600);
    await app.snap("settings-general", {
      component: "settings",
      tab: "general",
    });
  });

  test("component-process-manager-open", async ({ app }) => {
    if (!app.info.tier2Ready) return;
    await app.rpc.ui.toggleProcessManager();
    await sleep(700);
    await app.snap("process-manager-open", {
      component: "process-manager",
      open: true,
    });
  });

  test("component-rename-workspace-dialog", async ({ app }) => {
    if (!app.info.tier2Ready) return;
    const workspaces = await app.rpc.workspace.list();
    const ws = workspaces[0];
    if (!ws) return;
    await app.rpc.ui.openRenameWorkspaceDialog({
      workspaceId: ws.id,
      name: ws.name,
    });
    await sleep(400);
    await app.snap("dialog-rename-workspace", {
      component: "dialog",
      variant: "rename-workspace",
    });
  });

  test("component-rename-surface-dialog", async ({ app }) => {
    if (!app.info.tier2Ready) return;
    const surfaces = await app.rpc.surface.list();
    const surf = surfaces[0];
    if (!surf) return;
    await app.rpc.ui.openRenameSurfaceDialog({
      surfaceId: surf.id,
      title: surf.title,
    });
    await sleep(400);
    await app.snap("dialog-rename-surface", {
      component: "dialog",
      variant: "rename-surface",
    });
  });
});
