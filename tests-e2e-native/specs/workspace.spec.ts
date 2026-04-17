import { test, expect } from "../fixtures";
import { waitFor } from "../helpers/wait";
import { expectApp } from "../assertions";

test.describe("workspace", () => {
  test("boot creates exactly one active workspace", async ({ app }) => {
    // The webview's `resize` handler creates an initial workspace; fixture
    // guarantees it before the test body runs.
    const workspaces = await waitFor(
      async () => {
        const list = await app.rpc.workspace.list();
        return list.length > 0 ? list : undefined;
      },
      { timeoutMs: 10_000, message: "no workspace after boot" },
    );
    expect(workspaces.length).toBe(1);
    expect(workspaces[0].active).toBe(true);
    expect(workspaces[0].surface_count).toBeGreaterThan(0);
  });

  test("workspace.create adds a workspace", async ({ app }) => {
    await waitFor(
      async () => (await app.rpc.workspace.list()).length > 0 || undefined,
      { timeoutMs: 10_000, message: "initial workspace" },
    );
    const before = await app.rpc.workspace.list();
    await app.rpc.workspace.create();
    await expectApp(app.rpc).toHaveWorkspaceCount(before.length + 1, 5_000);
    const after = await app.rpc.workspace.list();
    expect(after.some((w) => w.active)).toBe(true);
  });

  test("new workspace becomes active", async ({ app }) => {
    await waitFor(
      async () => (await app.rpc.workspace.list()).length > 0 || undefined,
      { timeoutMs: 10_000, message: "initial workspace" },
    );
    await app.rpc.workspace.create();
    const list = await waitFor(
      async () => {
        const l = await app.rpc.workspace.list();
        return l.length >= 2 ? l : undefined;
      },
      { timeoutMs: 5_000, message: "second workspace" },
    );
    const active = list.find((w) => w.active);
    expect(active).toBeTruthy();
    // The newly created one is always last in list order.
    expect(active?.id).toBe(list[list.length - 1].id);
  });

  test("workspace.next cycles forward", async ({ app }) => {
    await waitFor(
      async () => (await app.rpc.workspace.list()).length > 0 || undefined,
      { timeoutMs: 10_000, message: "initial workspace" },
    );
    await app.rpc.workspace.create();
    await expectApp(app.rpc).toHaveWorkspaceCount(2, 5_000);
    const before = (await app.rpc.workspace.list()).find((w) => w.active);
    await app.rpc.workspace.next();
    await waitFor(
      async () => {
        const active = (await app.rpc.workspace.list()).find((w) => w.active);
        return active && active.id !== before?.id ? active : undefined;
      },
      { timeoutMs: 3_000, message: "workspace.next never changed active" },
    );
  });

  test("workspace.previous inverse of next", async ({ app }) => {
    await waitFor(
      async () => (await app.rpc.workspace.list()).length > 0 || undefined,
      { timeoutMs: 10_000, message: "initial workspace" },
    );
    await app.rpc.workspace.create();
    await expectApp(app.rpc).toHaveWorkspaceCount(2, 5_000);
    const first = (await app.rpc.workspace.list()).find((w) => w.active);
    await app.rpc.workspace.next();
    await app.rpc.workspace.previous();
    await waitFor(
      async () => {
        const active = (await app.rpc.workspace.list()).find((w) => w.active);
        return active?.id === first?.id ? true : undefined;
      },
      {
        timeoutMs: 3_000,
        message: "workspace.previous didn't return to original",
      },
    );
  });

  test("workspace.rename updates the listed name", async ({ app }) => {
    const list = await waitFor(
      async () => {
        const l = await app.rpc.workspace.list();
        return l.length > 0 ? l : undefined;
      },
      { timeoutMs: 10_000, message: "initial workspace" },
    );
    const wsId = list[0].id;
    await app.rpc.workspace.rename({ workspace_id: wsId, name: "renamed-ws" });
    await expect
      .poll(
        async () =>
          (await app.rpc.workspace.list()).find((w) => w.id === wsId)?.name,
        { timeout: 5_000 },
      )
      .toBe("renamed-ws");
  });

  test("closing non-active workspace leaves active unchanged", async ({
    app,
  }) => {
    await waitFor(
      async () => (await app.rpc.workspace.list()).length > 0 || undefined,
      { timeoutMs: 10_000, message: "initial" },
    );
    await app.rpc.workspace.create();
    await expectApp(app.rpc).toHaveWorkspaceCount(2, 5_000);
    const list = await app.rpc.workspace.list();
    const activeBefore = list.find((w) => w.active)!;
    const inactive = list.find((w) => !w.active)!;
    await app.rpc.workspace.close({ workspace_id: inactive.id });
    await expectApp(app.rpc).toHaveWorkspaceCount(1, 5_000);
    const remaining = (await app.rpc.workspace.list())[0];
    expect(remaining.id).toBe(activeBefore.id);
    expect(remaining.active).toBe(true);
  });

  test("rapid create then close keeps count coherent", async ({ app }) => {
    await waitFor(
      async () => (await app.rpc.workspace.list()).length > 0 || undefined,
      { timeoutMs: 10_000, message: "initial workspace" },
    );
    for (let i = 0; i < 3; i++) {
      await app.rpc.workspace.create();
    }
    await expectApp(app.rpc).toHaveWorkspaceCount(4, 10_000);
    const ws = (await app.rpc.workspace.list()).find((w) => w.active);
    if (ws) {
      await app.rpc.workspace.close({ workspace_id: ws.id });
      await expectApp(app.rpc).toHaveWorkspaceCount(3, 5_000);
    }
  });
});
