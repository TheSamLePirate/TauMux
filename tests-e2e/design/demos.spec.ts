import { expect, test } from "../fixtures";
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
      // Type + run the demo. The shell's cwd is $HOME, so `commandFor`
      // expands to an absolute scripts/ path + absolute runner path.
      // When the runner isn't on the HOST PATH (e.g. no python3
      // installed), skip the test with a clear reason instead of
      // snapping a "command not found" shot.
      const command = commandFor(demo);
      test.skip(
        command === null,
        `${demo.runner} is not on the host PATH — install it or remove the demo from the catalog`,
      );
      await gotoAndSettle(page, serverCtx.baseURL);
      await page.locator(".pane").first().click();
      await page.keyboard.type(command!, { delay: 0 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(demo.settleMs);

      // Panel render assertion — this catches sideband regressions
      // (fd closure, shell rc interference, server not broadcasting)
      // that would otherwise produce a "UI only, no overlay" shot.
      // `expectNoPanel` is the opt-out when a future demo is
      // stdout-only by design.
      if (!demo.expectNoPanel) {
        const panelCount = await page.locator(".web-panel").count();
        expect(
          panelCount,
          `demo "${demo.slug}" produced no .web-panel within ${demo.settleMs}ms — ` +
            "check sideband wiring, shell fd inheritance, or bump settleMs.",
        ).toBeGreaterThan(0);
      }

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
