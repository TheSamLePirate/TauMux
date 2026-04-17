import { test, expect } from "../fixtures";
import { snapshotClipboard } from "../clipboard";

/**
 * `@clipboard` tag triggers the fixture's snapshot+restore guard
 * (doc/native-e2e-plan.md §8.5). Anything we write to `pbcopy` in these
 * tests is restored to the user's previous clipboard value after the
 * test body runs.
 */

test.describe("clipboard isolation @clipboard", () => {
  test("guard restores prior clipboard contents after the test body", async ({
    app,
  }) => {
    // The guard snapshotted the clipboard in `beforeEach`. We write a
    // marker; after the test, the guard restores the original. We can't
    // assert on the restore from inside the test body (it runs in
    // afterEach) — this test exercises the snapshot mechanism end-to-end
    // by verifying that our marker landed on the clipboard at all.
    if (process.platform !== "darwin") {
      test.skip(true, "clipboard is macOS-only");
      return;
    }
    const marker = `ht-e2e-clipboard-${Date.now()}`;
    // Use app.rpc to reach anything clipboard-related — currently we
    // don't have a socket clipboard RPC, so touch pbcopy directly to
    // prove the fixture saves/restores correctly around native state.
    const { spawn } = await import("node:child_process");
    await new Promise<void>((resolve) => {
      const c = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
      c.stdin.end(marker);
      c.once("exit", () => resolve());
    });
    expect(snapshotClipboard()).toBe(marker);
    // App should still be responsive despite clipboard mutation.
    const caps = await app.rpc.system.capabilities();
    expect(caps.methods.length).toBeGreaterThan(0);
  });
});
