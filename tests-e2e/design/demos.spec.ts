import { test } from "../fixtures";
import { snap } from "./helpers/snap";
import { ACTIVE_DEMOS, commandFor } from "./helpers/demos";

/**
 * Sideband-demo coverage for the web mirror. Each demo in
 * `scripts/demo_*` is launched through the PTY, given a fixed settle
 * window, then screenshotted. Captures the rendered sideband panel over
 * the terminal — exactly what a user would see after running the demo
 * themselves. Tests never fail on a demo's internal error; they still
 * snap so the report shows whatever output landed.
 */

async function gotoAndSettle(
  page: import("@playwright/test").Page,
  url: string,
) {
  await page.goto(url);
  await page.locator(".xterm").first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
}

test.describe("@design demos: web mirror", () => {
  for (const demo of ACTIVE_DEMOS) {
    test(`demo-${demo.slug}`, async ({ serverCtx, page }, testInfo) => {
      test.setTimeout(45_000);
      await gotoAndSettle(page, serverCtx.baseURL);
      await page.locator(".pane").first().click();
      // Type + run the demo. The shell's cwd is $HOME, so `commandFor`
      // expands to an absolute scripts/ path. The fixture boots /bin/sh
      // with sideband fds, so this still hits the full protocol path.
      const command = commandFor(demo);
      await page.keyboard.type(command, { delay: 0 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(demo.settleMs);
      await snap(page, testInfo, `demo-${demo.slug}`, {
        state: {
          suite: "web",
          demo: demo.slug,
          command,
          settleMs: demo.settleMs,
          notes: demo.notes ?? null,
        },
        annotate: ["#pane-container", ".xterm-rows"],
      });
      // Best-effort cleanup: Ctrl-C so long-running demos don't leak
      // into the next test (each test has its own server, but killing
      // early shortens teardown).
      try {
        await page.keyboard.press("Control+C");
      } catch {
        /* ignore */
      }
    });
  }
});
