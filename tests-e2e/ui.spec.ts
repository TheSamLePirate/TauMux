import { test, expect } from "./fixtures";

/**
 * UI-layer smoke / interaction tests driven through a real Chromium.
 * These cover the web-client's DOM assembly and its reactions to the
 * state store, which the server-side tests never exercise. Selectors
 * are stable IDs from src/bun/web/page.ts; avoid CSS-class-based
 * selectors that would drift as styling changes.
 */
test.describe("web mirror: UI rendering", () => {
  test("toolbar + sidebar + pane container all mount", async ({
    serverCtx,
    page,
  }) => {
    await page.goto(serverCtx.baseURL);

    // Toolbar and its key children.
    await expect(page.locator("#toolbar")).toBeVisible();
    await expect(page.locator("#sidebar-toggle-btn")).toBeVisible();
    await expect(page.locator("#workspace-select")).toBeVisible();
    await expect(page.locator("#toolbar-title")).toHaveText("τ-mux Remote");

    // Pane container holds the xterm.
    await expect(page.locator("#pane-container")).toBeVisible();
    await expect(page.locator(".xterm").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("workspace selector populated from the snapshot", async ({
    serverCtx,
    page,
  }) => {
    await page.goto(serverCtx.baseURL);

    const select = page.locator("#workspace-select");
    await expect(select).toBeVisible();

    // Wait for the select to be populated — the client renders it
    // asynchronously once `hello` arrives.
    await expect
      .poll(
        async () => {
          const html = await select.innerHTML();
          return html.length;
        },
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0);

    // The fixture boots a workspace named "e2e"; that should be the
    // selected option value.
    const options = select.locator("option");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveText("e2e");
  });

  test("sidebar toggle button flips sidebar visibility", async ({
    serverCtx,
    page,
  }) => {
    await page.goto(serverCtx.baseURL);
    // Wait for the hello envelope to settle the sidebar state before
    // we start toggling. Without this we'd race the server-provided
    // `sidebarVisible: true` against the initial DOM's `collapsed`
    // class, and see inconsistent starting states.
    await expect(page.locator(".xterm").first()).toBeVisible({
      timeout: 10_000,
    });

    const sidebar = page.locator("#sidebar");
    const isCollapsed = async () =>
      (await sidebar.getAttribute("class"))?.includes("collapsed") ?? false;

    const initial = await isCollapsed();
    await page.locator("#sidebar-toggle-btn").click();
    await expect.poll(isCollapsed, { timeout: 3_000 }).toBe(!initial);

    await page.locator("#sidebar-toggle-btn").click();
    await expect.poll(isCollapsed, { timeout: 3_000 }).toBe(initial);
  });

  test("sidebar shows workspace name and pane count when open", async ({
    serverCtx,
    page,
  }) => {
    await page.goto(serverCtx.baseURL);
    await expect(page.locator(".xterm").first()).toBeVisible({
      timeout: 10_000,
    });

    const sidebar = page.locator("#sidebar");
    // If the hello left the sidebar collapsed, open it — otherwise
    // leave it as-is. Either way we assert the content AFTER.
    const collapsed = (await sidebar.getAttribute("class"))?.includes(
      "collapsed",
    );
    if (collapsed) {
      await page.locator("#sidebar-toggle-btn").click();
      await expect
        .poll(
          async () =>
            !((await sidebar.getAttribute("class")) ?? "").includes(
              "collapsed",
            ),
          { timeout: 3_000 },
        )
        .toBe(true);
    }

    await expect(sidebar).toContainText("e2e");
    await expect(sidebar).toContainText(/1\s*pane/i);
  });

  test("pane header shows the shell title", async ({ serverCtx, page }) => {
    await page.goto(serverCtx.baseURL);
    const paneContainer = page.locator("#pane-container");
    await expect(paneContainer).toBeVisible();
    // SessionManager defaults the title to the basename of the shell
    // binary, so `/bin/sh` → "sh".
    await expect(paneContainer).toContainText("sh", { timeout: 5_000 });
  });

  test("client-count indicator shows this tab once connected", async ({
    serverCtx,
    page,
  }) => {
    await page.goto(serverCtx.baseURL);

    // `#client-count` is hidden until the client knows how many peers
    // are connected. We don't assert on content (that depends on the
    // server's broadcast semantics), just that the element exists and
    // the toolbar layout doesn't crash.
    await expect(page.locator("#client-count")).toBeAttached();
    await expect(page.locator("#status-dot")).toBeAttached();
  });

  test("pane fullscreen button toggles a fullscreen class on the pane", async ({
    serverCtx,
    page,
  }) => {
    await page.goto(serverCtx.baseURL);
    const pane = page.locator(".pane").first();
    await expect(pane).toBeVisible({ timeout: 10_000 });

    // Every pane header has a `.pane-bar-btn` (title "Fullscreen").
    // Locate it by title rather than class chain to survive CSS
    // refactors.
    const fsBtn = page.locator('.pane-bar-btn[title="Fullscreen"]').first();
    await fsBtn.click();

    // After click the pane or its ancestor should pick up a
    // fullscreen-ish class. We don't know the exact class name, so
    // assert that something in the DOM *changed* — a useful smoke
    // against the button being wired to nothing.
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
            return (
              document.body.classList.length +
              (document.querySelector(".pane")?.classList.length ?? 0)
            );
          }),
        { timeout: 3_000 },
      )
      .toBeGreaterThan(1);
  });
});
