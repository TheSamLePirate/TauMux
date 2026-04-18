import { test, expect } from "../fixtures";
import { snap } from "./helpers/snap";

/**
 * Per-component design gallery for the web mirror. Each test captures a
 * component under one named state with `annotate` selectors so the
 * design-report HTML can render a table of computed styles + rects. Not
 * exhaustive — captures every discoverable DOM id exposed by
 * src/bun/web/page.ts and the element classes created by
 * src/web-client/main.ts.
 */

const TOOLBAR_SEL = [
  "#toolbar",
  "#sidebar-toggle-btn",
  "#back-btn",
  "#workspace-select",
  "#toolbar-title",
  "#client-count",
  "#fullscreen-btn",
  "#status-dot",
];

const SIDEBAR_SEL = ["#sidebar"];

const PANE_SEL = [
  "#pane-container",
  ".pane",
  ".pane-bar",
  ".pane-bar-title",
  ".pane-bar-chips",
  ".pane-bar-btn",
  ".pane-term",
  ".xterm",
  ".xterm-viewport",
];

async function gotoAndSettle(
  page: import("@playwright/test").Page,
  url: string,
) {
  await page.goto(url);
  await page.locator(".xterm").first().waitFor({ timeout: 10_000 });
  // Let xterm finish its first paint + sizing pass.
  await page.waitForTimeout(400);
}

test.describe("@design components: toolbar", () => {
  test("toolbar-default", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    await snap(page, testInfo, "toolbar-default", {
      clip: "#toolbar",
      annotate: TOOLBAR_SEL,
      state: { variant: "default" },
    });
  });

  test("toolbar-sidebar-btn-hover", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    await page.locator("#sidebar-toggle-btn").hover();
    await snap(page, testInfo, "toolbar-sidebar-btn-hover", {
      clip: "#toolbar",
      annotate: ["#sidebar-toggle-btn"],
      state: { variant: "hover", target: "#sidebar-toggle-btn" },
    });
  });

  test("toolbar-sidebar-btn-focus", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    await page.locator("#sidebar-toggle-btn").focus();
    await snap(page, testInfo, "toolbar-sidebar-btn-focus", {
      clip: "#toolbar",
      annotate: ["#sidebar-toggle-btn"],
      state: { variant: "focus" },
    });
  });

  test("toolbar-fullscreen-btn-hover", async ({
    serverCtx,
    page,
  }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    await page.locator("#fullscreen-btn").hover();
    await snap(page, testInfo, "toolbar-fullscreen-btn-hover", {
      clip: "#toolbar",
      annotate: ["#fullscreen-btn"],
      state: { variant: "hover", target: "#fullscreen-btn" },
    });
  });

  test("toolbar-workspace-select-open", async ({
    serverCtx,
    page,
  }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    // Native <select> dropdown behavior varies; capture focus state instead
    // of the actual popup (which is OS-owned and not screenshotable).
    await page.locator("#workspace-select").focus();
    await snap(page, testInfo, "toolbar-workspace-select-focus", {
      clip: "#toolbar",
      annotate: ["#workspace-select"],
      state: { variant: "focus" },
    });
  });

  test("toolbar-status-dot-connected", async ({
    serverCtx,
    page,
  }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    // Wait for a first message roundtrip to ensure the connection
    // indicator has a stable color.
    await page.waitForTimeout(500);
    await snap(page, testInfo, "toolbar-status-dot-connected", {
      clip: "#toolbar",
      annotate: ["#status-dot", "#client-count"],
      state: { variant: "connected" },
    });
  });
});

test.describe("@design components: sidebar", () => {
  test("sidebar-collapsed", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    const sidebar = page.locator("#sidebar");
    const collapsed = (await sidebar.getAttribute("class"))?.includes(
      "collapsed",
    );
    if (!collapsed) await page.locator("#sidebar-toggle-btn").click();
    await page.waitForTimeout(200);
    await snap(page, testInfo, "sidebar-collapsed", {
      annotate: SIDEBAR_SEL,
      state: { collapsed: true },
    });
  });

  test("sidebar-expanded", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    const sidebar = page.locator("#sidebar");
    const collapsed = (await sidebar.getAttribute("class"))?.includes(
      "collapsed",
    );
    if (collapsed) await page.locator("#sidebar-toggle-btn").click();
    await expect
      .poll(
        async () =>
          !((await sidebar.getAttribute("class")) ?? "").includes("collapsed"),
      )
      .toBe(true);
    await page.waitForTimeout(200);
    await snap(page, testInfo, "sidebar-expanded", {
      clip: "#sidebar",
      annotate: SIDEBAR_SEL,
      state: { collapsed: false },
    });
  });
});

test.describe("@design components: pane", () => {
  test("pane-default", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    await snap(page, testInfo, "pane-default", {
      clip: "#pane-container",
      annotate: PANE_SEL,
      state: { state: "idle" },
    });
  });

  test("pane-bar-detail", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    await snap(page, testInfo, "pane-bar-detail", {
      clip: ".pane-bar",
      annotate: [
        ".pane-bar",
        ".pane-bar-title",
        ".pane-bar-chips",
        ".pane-bar-btn",
      ],
      state: { state: "bar-only" },
    });
  });

  test("pane-bar-btn-hover", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    await page.locator('.pane-bar-btn[title="Fullscreen"]').first().hover();
    await snap(page, testInfo, "pane-bar-btn-hover", {
      clip: ".pane-bar",
      annotate: ['.pane-bar-btn[title="Fullscreen"]'],
      state: { variant: "hover" },
    });
  });

  test("pane-with-content", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    await page.locator(".pane").first().click();
    await page.keyboard.type('echo "Design review row $LINENO" && ls -la /', {
      delay: 0,
    });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    await snap(page, testInfo, "pane-with-content", {
      clip: "#pane-container",
      annotate: [".xterm-rows", ".xterm-viewport", ".xterm-cursor-layer"],
      state: { state: "populated" },
    });
  });

  test("pane-fullscreen", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    await page.locator('.pane-bar-btn[title="Fullscreen"]').first().click();
    await page.waitForTimeout(300);
    await snap(page, testInfo, "pane-fullscreen", {
      annotate: [".pane", "body"],
      state: { variant: "fullscreen" },
    });
  });
});

test.describe("@design components: layout", () => {
  test("layout-full-viewport", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    await snap(page, testInfo, "layout-full-viewport", {
      annotate: ["body", "#toolbar", "#sidebar", "#pane-container"],
      state: { capture: "full-viewport" },
    });
  });

  test("layout-full-viewport-sidebar-open", async ({
    serverCtx,
    page,
  }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    const sidebar = page.locator("#sidebar");
    if (((await sidebar.getAttribute("class")) ?? "").includes("collapsed")) {
      await page.locator("#sidebar-toggle-btn").click();
      await page.waitForTimeout(250);
    }
    await snap(page, testInfo, "layout-full-viewport-sidebar-open", {
      annotate: ["body", "#toolbar", "#sidebar", "#pane-container"],
      state: { capture: "full-viewport", sidebarOpen: true },
    });
  });
});
