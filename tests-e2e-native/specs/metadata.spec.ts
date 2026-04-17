import { test, expect } from "../fixtures";
import { sleep, waitFor } from "../helpers/wait";
import { expectSurface } from "../assertions";

test.describe("metadata", () => {
  test("metadata snapshot exposes shell pid + cwd", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    const meta = await waitFor(
      async () => app.rpc.surface.metadata({ surface_id: sid }),
      { timeoutMs: 5_000, message: "no metadata snapshot" },
    );
    expect(meta.pid).toBeGreaterThan(0);
    expect(meta.foregroundPid).toBeGreaterThan(0);
    expect(meta.cwd.length).toBeGreaterThan(0);
    expect(meta.tree.length).toBeGreaterThan(0);
    expect(meta.tree.some((n) => n.pid === meta.pid)).toBe(true);
  });

  test("python3 http.server advertises its listening port", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    await sleep(300);
    // Pick a port unlikely to collide on dev machines / CI runners.
    const port = 39000 + Math.floor(Math.random() * 1000);
    await app.rpc.surface.send_text({
      surface_id: sid,
      text: `python3 -m http.server ${port} --bind 127.0.0.1\r`,
    });
    await expectSurface(app.rpc, sid).toHaveListeningPort(port, 10_000);
    // Clean up.
    await app.rpc.surface.send_text({ surface_id: sid, text: "\x03" });
  });

  test("process tree includes spawned children", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    await sleep(300);
    await app.rpc.surface.send_text({
      surface_id: sid,
      text: "sleep 20 &\r",
    });
    await waitFor(
      async () => {
        const meta = await app.rpc.surface.metadata({ surface_id: sid });
        if (!meta) return undefined;
        return meta.tree.some((n) => n.command.includes("sleep"))
          ? true
          : undefined;
      },
      { timeoutMs: 5_000, message: "sleep never joined process tree" },
    );
    await app.rpc.surface.send_text({ surface_id: sid, text: "kill %1\r" });
  });

  test("package.json surfaces metadata.packageJson", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    // Repo root has package.json — cd there, give the poller a tick, then read.
    await sleep(300);
    await app.rpc.surface.send_text({
      surface_id: sid,
      text: `cd ${process.cwd()}\r`,
    });
    await expect
      .poll(
        async () =>
          (await app.rpc.surface.metadata({ surface_id: sid }))?.packageJson
            ?.name ?? null,
        { timeout: 5_000 },
      )
      .toBe("hyperterm-canvas");
  });

  test("cd to /tmp (no repo) leaves metadata.git null", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    await sleep(300);
    await app.rpc.surface.send_text({
      surface_id: sid,
      text: "cd /tmp && echo cd-done\r",
    });
    await expect
      .poll(
        async () =>
          (await app.rpc.surface.metadata({ surface_id: sid }))?.git == null,
        { timeout: 5_000 },
      )
      .toBe(true);
  });

  test("listening port drops when server is killed", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    await sleep(300);
    const port = 38000 + Math.floor(Math.random() * 1000);
    await app.rpc.surface.send_text({
      surface_id: sid,
      text: `python3 -m http.server ${port} --bind 127.0.0.1\r`,
    });
    await expect
      .poll(
        async () =>
          (
            await app.rpc.surface.metadata({ surface_id: sid })
          )?.listeningPorts.some((p) => p.port === port) ?? false,
        { timeout: 10_000 },
      )
      .toBe(true);
    await app.rpc.surface.send_text({ surface_id: sid, text: "\x03" });
    await expect
      .poll(
        async () =>
          (
            await app.rpc.surface.metadata({ surface_id: sid })
          )?.listeningPorts.some((p) => p.port === port) ?? false,
        { timeout: 10_000 },
      )
      .toBe(false);
  });

  test("metadata tree parses CPU% without locale drift", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    const meta = await waitFor(
      async () => app.rpc.surface.metadata({ surface_id: sid }),
      { timeoutMs: 5_000, message: "no metadata snapshot" },
    );
    // CPU% must always be a finite number, never NaN (which is what a
    // `0,4`-instead-of-`0.4` locale parse bug would produce).
    for (const node of meta.tree) {
      expect(Number.isFinite(node.cpu)).toBe(true);
      expect(Number.isFinite(node.rssKb)).toBe(true);
      expect(node.rssKb).toBeGreaterThanOrEqual(0);
    }
  });
});
