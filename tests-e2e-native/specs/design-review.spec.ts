import { test } from "../fixtures";
import { sleep } from "../helpers/wait";

/**
 * `@design-review` canonical-state snapshots. Run with:
 *   bun run test:native:design-review
 * to regenerate a directory of images fit for manual review / Claude Opus
 * visual QA (doc/native-e2e-plan.md §7.5).
 *
 * Each test drives the app into a named state and calls `snap()`. The
 * screenshot plus a small state blob land in `test-results/screenshots-index.jsonl`.
 *
 * Keep this list opinionated: one canonical state per test, minimal body.
 */

test.describe("@design-review", () => {
  test("boot-empty", async ({ app }) => {
    // Let the webview settle on its first surface + paint.
    await sleep(1_000);
    await app.snap("boot-empty");
  });

  test("split-2x1", async ({ app }) => {
    await app.rpc.surface.split({ direction: "horizontal" });
    await sleep(1_000);
    await app.snap("split-2x1");
  });

  test("split-2x2", async ({ app }) => {
    await app.rpc.surface.split({ direction: "horizontal" });
    await sleep(500);
    await app.rpc.surface.split({ direction: "vertical" });
    await sleep(500);
    await app.rpc.surface.split({ direction: "vertical" });
    await sleep(1_000);
    await app.snap("split-2x2");
  });

  test("browser-surface", async ({ app }) => {
    await app.rpc.browser.open({ url: "about:blank" });
    await sleep(2_000);
    await app.snap("browser-surface");
  });
});
