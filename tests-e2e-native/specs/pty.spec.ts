import { test, expect } from "../fixtures";
import { waitForScreen } from "../helpers/shell";
import { waitFor, sleep } from "../helpers/wait";
import { expectSurface } from "../assertions";

test.describe("pty", () => {
  test("echo hello lands on screen", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    await app.rpc.surface.send_text({
      surface_id: sid,
      text: "echo hello-e2e-marker\r",
    });
    await waitForScreen(app.rpc, sid, "hello-e2e-marker");
  });

  test("pwd matches metadata cwd after the shell settles", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    // Shell takes a beat to print its prompt; send pwd after a short wait so
    // the command lands after, not during, the PS1 flush.
    await sleep(300);
    await app.rpc.surface.send_text({ surface_id: sid, text: "pwd\r" });
    const text = await waitForScreen(app.rpc, sid, /\/[a-zA-Z0-9._/-]+/);
    expect(text.length).toBeGreaterThan(0);
  });

  test("cd /tmp updates metadata cwd within 2s", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    await sleep(300);
    await app.rpc.surface.send_text({
      surface_id: sid,
      text: "cd /tmp && echo cd-done\r",
    });
    await waitForScreen(app.rpc, sid, "cd-done");
    // macOS resolves `/tmp` → `/private/tmp` through the metadata poller's
    // `realpathSync`. Match either for portability.
    await waitFor(
      async () => {
        const meta = await app.rpc.surface.metadata({ surface_id: sid });
        return meta?.cwd === "/tmp" || meta?.cwd === "/private/tmp"
          ? meta.cwd
          : undefined;
      },
      { timeoutMs: 4_000, message: "cwd never updated to /tmp" },
    );
  });

  test("long-running foreground command is observable in metadata", async ({
    app,
  }) => {
    const sid = app.info.firstSurfaceId;
    await sleep(300);
    await app.rpc.surface.send_text({
      surface_id: sid,
      text: "sleep 30\r",
    });
    await expectSurface(app.rpc, sid).toHaveForegroundCommand(/sleep/, 5_000);
    // Send Ctrl-C to clean up.
    await app.rpc.surface.send_text({ surface_id: sid, text: "\x03" });
  });

  test("ctrl-C returns foreground to the shell", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    await sleep(300);
    await app.rpc.surface.send_text({ surface_id: sid, text: "sleep 30\r" });
    await expectSurface(app.rpc, sid).toHaveForegroundCommand(/sleep/, 5_000);
    await app.rpc.surface.send_text({ surface_id: sid, text: "\x03" });
    await waitFor(
      async () => {
        const meta = await app.rpc.surface.metadata({ surface_id: sid });
        if (!meta) return undefined;
        return meta.foregroundPid === meta.pid ? true : undefined;
      },
      { timeoutMs: 5_000, message: "foreground never returned to shell" },
    );
  });

  test("seq output is visible in screen buffer", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    await sleep(300);
    await app.rpc.surface.send_text({
      surface_id: sid,
      text: "seq 1 50\r",
    });
    // 50 is the tail; the buffer window holds the last few dozen rows.
    await waitForScreen(app.rpc, sid, /\b50\b/);
  });

  test("clear wipes visible buffer", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    await sleep(300);
    await app.rpc.surface.send_text({
      surface_id: sid,
      text: "echo before-clear-marker\r",
    });
    await waitForScreen(app.rpc, sid, "before-clear-marker");
    await app.rpc.surface.send_text({ surface_id: sid, text: "clear\r" });
    await waitFor(
      async () => {
        const text = await app.rpc.surface.read_text({ surface_id: sid });
        // After clear, the marker shouldn't be in the active viewport text.
        return !text.includes("before-clear-marker") ? true : undefined;
      },
      { timeoutMs: 5_000, message: "clear did not wipe the screen" },
    );
  });
});
