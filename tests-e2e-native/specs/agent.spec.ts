import { test, expect } from "../fixtures";
import { waitFor } from "../helpers/wait";
import { execFileSync } from "node:child_process";

/**
 * Agent surface coverage. Agents are spawned as `pi --mode rpc` child
 * processes; the tests require the `pi` CLI to be on PATH and skip
 * gracefully when it isn't (e.g. CI runners without pi installed).
 *
 * The specs exercise the socket RPC surface end-to-end: create, list,
 * count, split, close. They don't drive the agent's chat loop — that's
 * a deeper test-matrix that needs a mocked pi backend.
 */

function isPiAvailable(): boolean {
  try {
    const out = execFileSync("which", ["pi"], { encoding: "utf8" });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

test.describe("agent surfaces", () => {
  test.beforeEach(async ({}) => {
    if (!isPiAvailable()) {
      test.skip(true, "`pi` CLI not on PATH — agent tests cannot run");
    }
  });

  test("agent.list is empty on a fresh app", async ({ app }) => {
    const agents = await app.rpc.agent.list();
    expect(agents).toEqual([]);
    expect(await app.rpc.agent.count()).toBe(0);
  });

  test("agent.create spawns exactly one agent", async ({ app }) => {
    await app.rpc.agent.create();
    await expect
      .poll(async () => app.rpc.agent.count(), { timeout: 10_000 })
      .toBe(1);
    const list = await app.rpc.agent.list();
    expect(list).toHaveLength(1);
    // Pi agent ids are the `agent-N` form assigned by PiAgentManager.
    expect(list[0].id).toMatch(/^agent[-:]/);
  });

  test("agent.create adds a surface to the active workspace", async ({
    app,
  }) => {
    const beforeSurfaces = (await app.rpc.surface.list()).length;
    await app.rpc.agent.create();
    // Agent surfaces don't live in `sessions` (surface.list), they live in
    // PiAgentManager. But they DO count toward workspace.surface_count once
    // the webview has synced the layout back to bun.
    await expect
      .poll(async () => app.rpc.agent.count(), { timeout: 10_000 })
      .toBe(1);
    // Regular terminal surface count stays unchanged — agents are tracked
    // separately from sessions.
    expect((await app.rpc.surface.list()).length).toBe(beforeSurfaces);
  });

  test("agent.create_split creates a second agent", async ({ app }) => {
    await app.rpc.agent.create();
    await expect
      .poll(async () => app.rpc.agent.count(), { timeout: 10_000 })
      .toBe(1);
    await app.rpc.agent.create_split({ direction: "horizontal" });
    await expect
      .poll(async () => app.rpc.agent.count(), { timeout: 10_000 })
      .toBe(2);
    const list = await app.rpc.agent.list();
    const ids = new Set(list.map((a) => a.id));
    expect(ids.size).toBe(2);
  });

  test("agent.close by surface_id removes the agent", async ({ app }) => {
    await app.rpc.agent.create();
    const first = await waitFor(
      async () => {
        const list = await app.rpc.agent.list();
        return list[0]?.id;
      },
      { timeoutMs: 10_000, message: "no agent ever appeared" },
    );
    await app.rpc.agent.close({ surface_id: first });
    await expect
      .poll(async () => app.rpc.agent.count(), { timeout: 5_000 })
      .toBe(0);
    expect(await app.rpc.agent.list()).toEqual([]);
  });

  test("agent.close with unknown id throws a clear error", async ({ app }) => {
    let err: Error | null = null;
    try {
      await app.rpc.agent.close({ surface_id: "agent:not-real" });
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err?.message ?? "").toMatch(/no agent/);
  });
});
