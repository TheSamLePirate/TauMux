import { test } from "../fixtures";
import { snap } from "./helpers/snap";

/**
 * End-to-end scenario gallery for the web mirror. Each test drives the
 * mirror into a recognisable state (boot, active shell, long scrollback,
 * auth gate, etc.) and snapshots the full viewport so the design report
 * can show how the product composes across real usage.
 */

async function gotoAndSettle(
  page: import("@playwright/test").Page,
  url: string,
) {
  await page.goto(url);
  await page.locator(".xterm").first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
}

test.describe("@design scenarios: boot", () => {
  test("boot-empty", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    await snap(page, testInfo, "boot-empty", {
      state: { scenario: "boot-empty" },
      annotate: ["#toolbar", "#sidebar", "#pane-container", ".xterm"],
    });
  });

  test("boot-sidebar-collapsed", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    const sidebar = page.locator("#sidebar");
    const collapsed = (await sidebar.getAttribute("class"))?.includes(
      "collapsed",
    );
    if (!collapsed) await page.locator("#sidebar-toggle-btn").click();
    await page.waitForTimeout(250);
    await snap(page, testInfo, "boot-sidebar-collapsed", {
      state: { scenario: "sidebar-collapsed" },
      annotate: ["#toolbar", "#sidebar", "#pane-container"],
    });
  });

  test("boot-sidebar-expanded", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    const sidebar = page.locator("#sidebar");
    if (((await sidebar.getAttribute("class")) ?? "").includes("collapsed")) {
      await page.locator("#sidebar-toggle-btn").click();
    }
    await page.waitForTimeout(300);
    await snap(page, testInfo, "boot-sidebar-expanded", {
      state: { scenario: "sidebar-expanded" },
      annotate: ["#toolbar", "#sidebar", "#pane-container"],
    });
  });
});

test.describe("@design scenarios: pty activity", () => {
  test("pty-colors-showcase", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    await page.locator(".pane").first().click();
    // 16 color palette + RGB truecolor sample.
    await page.keyboard.type(
      "for i in 1 2 3 4 5 6 7 8; do printf '\\033[3${i}m color ${i} \\033[0m'; done; echo",
      { delay: 0 },
    );
    await page.keyboard.press("Enter");
    await page.keyboard.type("echo -e '\\033[1;32mbold green\\033[0m'", {
      delay: 0,
    });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    await snap(page, testInfo, "pty-colors-showcase", {
      state: { scenario: "pty-colors" },
      annotate: [".xterm-rows"],
    });
  });

  test("pty-long-scrollback", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    await page.locator(".pane").first().click();
    await page.keyboard.type("for i in $(seq 1 200); do echo line-$i; done", {
      delay: 0,
    });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    await snap(page, testInfo, "pty-long-scrollback", {
      state: { scenario: "long-scrollback", lineCount: 200 },
      annotate: [".xterm-viewport", ".xterm-rows"],
    });
  });

  test("pty-directory-listing", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    await page.locator(".pane").first().click();
    await page.keyboard.type("ls -la /", { delay: 0 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await snap(page, testInfo, "pty-directory-listing", {
      state: { scenario: "ls-root" },
      annotate: [".xterm-rows"],
    });
  });
});

test.describe("@design scenarios: auth", () => {
  test("auth-open", async ({ serverCtx, page }, testInfo) => {
    await gotoAndSettle(page, serverCtx.baseURL);
    await snap(page, testInfo, "auth-open", {
      state: { scenario: "auth-open", token: "" },
      annotate: ["#toolbar", "#pane-container"],
    });
  });

  test("auth-required-missing-token", async ({ boot, page }, testInfo) => {
    const ctx = await boot({ token: "secrettoken" });
    // Hit the base URL WITHOUT appending the token to capture the gate.
    await page.goto(ctx.baseURL);
    await page.waitForTimeout(500);
    await snap(page, testInfo, "auth-required-missing-token", {
      state: { scenario: "auth-required", tokenProvided: false },
      annotate: ["body"],
    });
  });

  test("auth-required-correct-token", async ({ boot, page }, testInfo) => {
    const ctx = await boot({ token: "secrettoken" });
    await page.goto(ctx.urlWithToken("/"));
    await page.locator(".xterm").first().waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await snap(page, testInfo, "auth-required-correct-token", {
      state: { scenario: "auth-required", tokenProvided: true },
      annotate: ["#toolbar", "#pane-container"],
    });
  });
});

test.describe("@design scenarios: resize", () => {
  test("viewport-regular", async ({ serverCtx, page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoAndSettle(page, serverCtx.baseURL);
    await snap(page, testInfo, "viewport-1280x800", {
      state: { viewport: { width: 1280, height: 800 } },
      annotate: ["body", "#toolbar", "#sidebar", "#pane-container"],
    });
  });

  test("viewport-narrow", async ({ serverCtx, page }, testInfo) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await gotoAndSettle(page, serverCtx.baseURL);
    await snap(page, testInfo, "viewport-900x700", {
      state: { viewport: { width: 900, height: 700 } },
      annotate: ["body", "#toolbar", "#sidebar", "#pane-container"],
    });
  });
});
