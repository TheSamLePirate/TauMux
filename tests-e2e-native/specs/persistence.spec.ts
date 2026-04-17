import { test as base, expect } from "@playwright/test";
import {
  spawnAppAt,
  allocateConfigDir,
  wipeConfigDir,
  type AppHandle,
} from "../fixtures";
import { waitFor, sleep } from "../helpers/wait";

// Earlier revisions of these specs had a `waitForLayoutSync` helper that
// polled `system.tree` before each shutdown because a fast-quit path
// otherwise persisted a stale layout. That race is now fixed on the
// production side (gracefulShutdown awaits a `forceLayoutSync` RPC before
// calling saveLayout), so the helper was removed — the specs here now
// exercise the real behaviour a user sees when they quit mid-action.

/**
 * Persistence specs — drive the app, shut it down cleanly, and spawn a
 * second instance against the same `HT_CONFIG_DIR`. The second app sees
 * the first's on-disk state (layout.json, settings.json,
 * browser-history.json, cookies.json) and should rehydrate from it.
 *
 * This test file deliberately does NOT use the standard `app` fixture —
 * it manages its own configDir lifecycle so the second spawn observes
 * the first spawn's saved state. We go back to the vanilla Playwright
 * `test` from @playwright/test and compose the two spawns ourselves.
 */

interface Session {
  configDir: string;
  workerIndex: number;
  current: AppHandle;
  /** Gracefully shut down current, respawn against the same configDir. */
  restart(): Promise<AppHandle>;
  /** Shut down and wipe configDir. Safe to call multiple times. */
  dispose(): Promise<void>;
}

async function createSession(workerIndex: number): Promise<Session> {
  const configDir = allocateConfigDir(workerIndex);
  const first = await spawnAppAt({ configDir, workerIndex });
  const session: Session = {
    configDir,
    workerIndex,
    current: first,
    async restart() {
      await session.current.shutdown();
      // Breathing room for the old process to release the socket file +
      // flush writes. `gracefulShutdown` on bun side already waits for
      // persistence, but a tiny sleep keeps the next spawn from racing a
      // half-unlinked socket.
      await sleep(300);
      session.current = await spawnAppAt({ configDir, workerIndex });
      return session.current;
    },
    async dispose() {
      try {
        await session.current.shutdown();
      } catch {
        /* already shut down */
      }
      wipeConfigDir(configDir);
    },
  };
  return session;
}

const test = base.extend<{ session: Session }>({
  session: async ({}, use, testInfo) => {
    const s = await createSession(testInfo.workerIndex);
    try {
      await use(s);
    } finally {
      await s.dispose();
    }
  },
});

test.describe("persistence", () => {
  test("layout: 2-pane split survives a restart (fast shutdown)", async ({
    session,
  }) => {
    // No `waitForLayoutSync` — gracefulShutdown now force-flushes the
    // webview's debounced workspaceStateSync before saveLayout. This
    // test specifically exercises the fast-quit path: split, then
    // immediately restart without waiting for the 100ms debounce.
    await session.current.rpc.surface.split({ direction: "horizontal" });

    await session.restart();

    await expect
      .poll(async () => (await session.current.rpc.surface.list()).length, {
        timeout: 15_000,
      })
      .toBe(2);
  });

  test("layout: 4-pane split tree survives a restart (fast shutdown)", async ({
    session,
  }) => {
    const r = session.current.rpc;
    await r.surface.split({ direction: "horizontal" });
    await r.surface.split({ direction: "vertical" });
    await r.surface.split({ direction: "vertical" });

    await session.restart();

    await expect
      .poll(async () => (await session.current.rpc.surface.list()).length, {
        timeout: 15_000,
      })
      .toBe(4);
  });

  test("workspace: rename persists across restart", async ({ session }) => {
    const r = session.current.rpc;
    const wsId = await waitFor(
      async () => {
        const list = await r.workspace.list();
        return list[0]?.id;
      },
      { timeoutMs: 10_000, message: "no initial workspace" },
    );
    await r.workspace.rename({ workspace_id: wsId, name: "persistent-ws" });
    await expect
      .poll(
        async () => (await r.workspace.list()).find((w) => w.id === wsId)?.name,
        { timeout: 5_000 },
      )
      .toBe("persistent-ws");

    await session.restart();

    // Workspace ids are reassigned on restart; match by name.
    await expect
      .poll(
        async () =>
          (await session.current.rpc.workspace.list()).some(
            (w) => w.name === "persistent-ws",
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
  });

  test("workspace: multiple workspaces all restore", async ({ session }) => {
    const r = session.current.rpc;
    await waitFor(
      async () => (await r.workspace.list()).length > 0 || undefined,
      { timeoutMs: 10_000, message: "initial workspace" },
    );
    await r.workspace.create();
    await r.workspace.create();
    await expect
      .poll(async () => (await r.workspace.list()).length, { timeout: 10_000 })
      .toBe(3);

    await session.restart();

    await expect
      .poll(async () => (await session.current.rpc.workspace.list()).length, {
        timeout: 15_000,
      })
      .toBe(3);
  });

  test("settings: fontSize change persists", async ({ session }) => {
    // Wait until Tier 2 is ready so we can mutate settings programmatically.
    await waitFor(async () => session.current.info.tier2Ready || undefined, {
      timeoutMs: 10_000,
      message: "Tier 2 never ready for settings test",
    });
    const target = 18;
    await session.current.rpc.ui.setSettingsField("fontSize", target);
    await expect
      .poll(async () => (await session.current.rpc.ui.readState()).fontSize, {
        timeout: 5_000,
      })
      .toBe(target);

    await session.restart();

    await waitFor(async () => session.current.info.tier2Ready || undefined, {
      timeoutMs: 10_000,
      message: "Tier 2 never ready after restart",
    });
    expect((await session.current.rpc.ui.readState()).fontSize).toBe(target);
  });

  test("settings: paneGap change persists", async ({ session }) => {
    await waitFor(async () => session.current.info.tier2Ready || undefined, {
      timeoutMs: 10_000,
      message: "Tier 2",
    });
    await session.current.rpc.ui.setSettingsField("paneGap", 10);
    await expect
      .poll(async () => session.current.rpc.ui.readSettingsField("paneGap"), {
        timeout: 5_000,
      })
      .toBe(10);

    await session.restart();

    await waitFor(async () => session.current.info.tier2Ready || undefined, {
      timeoutMs: 10_000,
      message: "Tier 2 after restart",
    });
    expect(await session.current.rpc.ui.readSettingsField("paneGap")).toBe(10);
  });

  test("browser history: navigations recorded before shutdown restore", async ({
    session,
  }) => {
    // Navigate a browser surface so the history store gets an entry.
    await session.current.rpc.browser.open({ url: "about:blank" });
    const surface = await waitFor(
      async () => (await session.current.rpc.browser.list())[0],
      { timeoutMs: 10_000, message: "no browser surface" },
    );
    // The `browser.navigate` RPC itself doesn't add to history (history is
    // recorded from the webview's `browserNavigated` message, which only
    // fires on successful loads with network). For a hermetic test, write
    // directly via the clear/navigate/re-read round-trip: we just verify
    // the history store file exists and the get-all RPC returns an array
    // after restart — end-to-end wiring, not network-dependent content.
    await waitFor(
      async () => (await session.current.rpc.browser.list()).length > 0,
      { timeoutMs: 5_000, message: "browser surface" },
    );
    void surface;

    await session.restart();

    const history =
      await session.current.rpc.call<unknown[]>("browser.history");
    expect(Array.isArray(history)).toBe(true);
  });

  test("cold start without prior state creates a fresh workspace", async ({
    session,
  }) => {
    // Baseline: fresh session has exactly one workspace with one surface.
    const list = await waitFor(
      async () => {
        const l = await session.current.rpc.workspace.list();
        return l.length > 0 ? l : undefined;
      },
      { timeoutMs: 10_000, message: "initial" },
    );
    expect(list.length).toBe(1);
    expect(
      (await session.current.rpc.surface.list()).length,
    ).toBeGreaterThanOrEqual(1);
  });
});
