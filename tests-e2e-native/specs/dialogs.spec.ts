import { test, expect, requireTier2 } from "../fixtures";
import { waitFor } from "../helpers/wait";

/** Helper: grab the current active workspace id; fail loudly if missing. */
async function getActiveWorkspaceId(app: {
  rpc: {
    workspace: { list(): Promise<{ id: string; active: boolean }[]> };
  };
}): Promise<string> {
  const list = await waitFor(
    async () => {
      const l = await app.rpc.workspace.list();
      return l.length > 0 ? l : undefined;
    },
    { timeoutMs: 10_000, message: "no workspace ever appeared" },
  );
  const active = list.find((w) => w.active);
  if (!active) throw new Error("no active workspace");
  return active.id;
}

test.describe("prompt dialogs", () => {
  test.beforeEach(async ({ app }) => {
    requireTier2(app);
  });

  test("rename-workspace dialog opens with current name", async ({ app }) => {
    const wsId = await getActiveWorkspaceId(app);
    await app.rpc.ui.openRenameWorkspaceDialog({
      workspaceId: wsId,
      name: "MyPane",
    });
    const dialog = await waitFor(() => app.rpc.ui.readDialog(), {
      timeoutMs: 2_000,
      message: "dialog never appeared",
    });
    expect(dialog.title.toLowerCase()).toContain("workspace");
    expect(dialog.value).toBe("MyPane");
  });

  test("submit rename-workspace updates workspace.list", async ({ app }) => {
    const wsId = await getActiveWorkspaceId(app);
    await app.rpc.ui.openRenameWorkspaceDialog({
      workspaceId: wsId,
      name: "oldname",
    });
    await waitFor(() => app.rpc.ui.readDialog(), {
      timeoutMs: 2_000,
      message: "dialog",
    });
    await app.rpc.ui.submitDialog("renamed-e2e");
    await expect
      .poll(
        async () => {
          const ws = (await app.rpc.workspace.list()).find(
            (w) => w.id === wsId,
          );
          return ws?.name ?? null;
        },
        { timeout: 5_000 },
      )
      .toBe("renamed-e2e");
  });

  test("cancel rename-workspace leaves the name unchanged", async ({ app }) => {
    const wsId = await getActiveWorkspaceId(app);
    const originalName = (await app.rpc.workspace.list()).find(
      (w) => w.id === wsId,
    )!.name;
    await app.rpc.ui.openRenameWorkspaceDialog({
      workspaceId: wsId,
      name: originalName,
    });
    await waitFor(() => app.rpc.ui.readDialog(), {
      timeoutMs: 2_000,
      message: "dialog",
    });
    await app.rpc.ui.cancelDialog();
    await expect
      .poll(async () => app.rpc.ui.readDialog(), { timeout: 2_000 })
      .toBeNull();
    const unchanged = (await app.rpc.workspace.list()).find(
      (w) => w.id === wsId,
    )!.name;
    expect(unchanged).toBe(originalName);
  });

  test("submit with empty value does not close the dialog", async ({ app }) => {
    const wsId = await getActiveWorkspaceId(app);
    await app.rpc.ui.openRenameWorkspaceDialog({
      workspaceId: wsId,
      name: "anything",
    });
    await waitFor(() => app.rpc.ui.readDialog(), {
      timeoutMs: 2_000,
      message: "dialog",
    });
    await app.rpc.ui.submitDialog("");
    // Production behaviour: empty value is a no-op; dialog stays up.
    const still = await app.rpc.ui.readDialog();
    expect(still).not.toBeNull();
    await app.rpc.ui.cancelDialog();
  });

  test("only one dialog can be open at a time", async ({ app }) => {
    const wsId = await getActiveWorkspaceId(app);
    await app.rpc.ui.openRenameWorkspaceDialog({
      workspaceId: wsId,
      name: "first",
    });
    await waitFor(() => app.rpc.ui.readDialog(), {
      timeoutMs: 2_000,
      message: "first dialog",
    });
    await app.rpc.ui.openRenameWorkspaceDialog({
      workspaceId: wsId,
      name: "second",
    });
    const dialog = await app.rpc.ui.readDialog();
    expect(dialog?.value).toBe("second");
    await app.rpc.ui.cancelDialog();
  });

  test("rename-surface dialog flow mirrors workspace", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    await app.rpc.ui.openRenameSurfaceDialog({
      surfaceId: sid,
      title: "foo",
    });
    await waitFor(() => app.rpc.ui.readDialog(), {
      timeoutMs: 2_000,
      message: "dialog",
    });
    await app.rpc.ui.submitDialog("pane-renamed-e2e");
    await expect
      .poll(
        async () =>
          (await app.rpc.surface.list()).find((s) => s.id === sid)?.title,
        { timeout: 5_000 },
      )
      .toBe("pane-renamed-e2e");
  });
});
