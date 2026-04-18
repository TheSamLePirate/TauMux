import { expect, test } from "../fixtures";
import { sleep } from "../helpers/wait";
import { ACTIVE_DEMOS, commandFor } from "../../tests-e2e/design/helpers/demos";

/**
 * Sideband-demo coverage for the real native app. Shares the demo
 * catalog with the web-mirror spec so each demo appears in the design
 * report twice — once rendered in Chromium, once in the Electrobun
 * webview — for an apples-to-apples comparison.
 *
 * We send the command through `surface.send_text` rather than driving
 * keystrokes, so the PTY's line editor doesn't fight us and the test
 * doesn't race against xterm focus. After the settle window we send a
 * Ctrl-C to tear the demo down before the fixture's teardown kicks in.
 */

test.describe("@design-review demos", () => {
  for (const demo of ACTIVE_DEMOS) {
    test(`demo-${demo.slug}`, async ({ app }) => {
      test.setTimeout(60_000);
      const surfaces = await app.rpc.surface.list();
      const id = surfaces[0]?.id;
      if (!id) return;

      const command = commandFor(demo);
      await app.rpc.surface.send_text({
        surface_id: id,
        text: command + "\n",
      });
      await sleep(demo.settleMs);

      // Panel render assertion via the RPC panel registry. If sideband
      // broke between the fd write and the webview renderer this is
      // how we see it before promoting a broken baseline.
      if (!demo.expectNoPanel) {
        const panels = await app.rpc.panel.list({ surface_id: id });
        expect(
          panels.length,
          `native demo "${demo.slug}" produced no panel within ${demo.settleMs}ms`,
        ).toBeGreaterThan(0);
      }

      await app.snap(`demo-${demo.slug}`, {
        suite: "native",
        demo: demo.slug,
        command,
        settleMs: demo.settleMs,
        notes: demo.notes ?? null,
      });

      try {
        await app.rpc.surface.send_key({ surface_id: id, key: "C-c" });
      } catch {
        /* ignore */
      }
      await sleep(150);
    });
  }
});
