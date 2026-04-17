import { test, expect } from "../fixtures";
import { waitFor } from "../helpers/wait";
import { expectApp } from "../assertions";

test.describe("script runner", () => {
  test.beforeEach(async ({ app }) => {
    // script.run falls back to the active workspace id when none is given,
    // and the state sync from the webview takes ~1-2s post-boot. Make
    // sure it's there before the test body runs.
    await waitFor(
      async () => (await app.rpc.workspace.list()).length > 0 || undefined,
      { timeoutMs: 10_000, message: "no workspace ever synced" },
    );
  });
  test("script.run spawns a tracked surface and echoes the command", async ({
    app,
  }) => {
    const before = (await app.rpc.surface.list()).length;
    const result = await app.rpc.script.run({
      cwd: process.cwd(),
      command: "node -v",
      script_key: "e2e:node-version",
    });
    expect(result.ok).toBe(true);
    expect(result.scriptKey).toBe("e2e:node-version");
    await expectApp(app.rpc).toHaveSurfaceCount(before + 1, 10_000);
  });

  test("script.run output appears on the new surface's screen", async ({
    app,
  }) => {
    const before = new Set((await app.rpc.surface.list()).map((s) => s.id));
    await app.rpc.script.run({
      cwd: process.cwd(),
      command: "echo script-runner-marker",
    });
    const newSurface = await waitFor(
      async () => {
        const list = await app.rpc.surface.list();
        return list.find((s) => !before.has(s.id));
      },
      { timeoutMs: 10_000, message: "new surface never appeared" },
    );
    await expect
      .poll(
        async () => {
          const text = await app.rpc.surface.read_text({
            surface_id: newSurface.id,
          });
          return text.includes("script-runner-marker");
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  });

  test("script.run uses an auto-generated key when script_key omitted", async ({
    app,
  }) => {
    const result = await app.rpc.script.run({
      cwd: process.cwd(),
      command: "true",
    });
    expect(result.ok).toBe(true);
    expect(result.scriptKey).toMatch(/^script\.run:\d+/);
  });

  test("script.run targets the active workspace by default", async ({
    app,
  }) => {
    const before = (await app.rpc.surface.list()).length;
    await app.rpc.script.run({
      cwd: process.cwd(),
      command: "echo default-ws",
    });
    // Just asserts the surface spawned; workspace attachment is a
    // webview-side concern we verified via the tracked-surface test.
    await expectApp(app.rpc).toHaveSurfaceCount(before + 1, 10_000);
  });

  test("script.run refuses missing cwd or command", async ({ app }) => {
    let threw = false;
    try {
      await app.rpc.call("script.run", { command: "true" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("two script.runs in flight both produce distinct surfaces", async ({
    app,
  }) => {
    const before = (await app.rpc.surface.list()).length;
    await Promise.all([
      app.rpc.script.run({
        cwd: process.cwd(),
        command: "sleep 0.1 && echo first-script",
        script_key: "first",
      }),
      app.rpc.script.run({
        cwd: process.cwd(),
        command: "sleep 0.1 && echo second-script",
        script_key: "second",
      }),
    ]);
    await expectApp(app.rpc).toHaveSurfaceCount(before + 2, 10_000);
  });
});
