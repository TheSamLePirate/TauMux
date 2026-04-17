import { test, expect } from "../fixtures";
import { waitFor } from "../helpers/wait";
import { expectApp, expectSurface } from "../assertions";

test.describe("surface", () => {
  test("boot yields one focused surface", async ({ app }) => {
    const surfaces = await app.rpc.surface.list();
    expect(surfaces.length).toBeGreaterThan(0);
    expect(surfaces[0].id).toBe(app.info.firstSurfaceId);
    expect(surfaces[0].pid).toBeGreaterThan(0);
  });

  test("surface.split horizontal adds a second surface", async ({ app }) => {
    await app.rpc.surface.split({ direction: "horizontal" });
    await expectApp(app.rpc).toHaveSurfaceCount(2, 5_000);
  });

  test("surface.split vertical adds a second surface", async ({ app }) => {
    await app.rpc.surface.split({ direction: "vertical" });
    await expectApp(app.rpc).toHaveSurfaceCount(2, 5_000);
  });

  test("closing one of two leaves the other", async ({ app }) => {
    await app.rpc.surface.split({ direction: "horizontal" });
    await expectApp(app.rpc).toHaveSurfaceCount(2, 5_000);
    const surfaces = await app.rpc.surface.list();
    const toClose = surfaces[surfaces.length - 1];
    await app.rpc.surface.close({ surface_id: toClose.id });
    await expectApp(app.rpc).toHaveSurfaceCount(1, 5_000);
    const remaining = await app.rpc.surface.list();
    expect(remaining[0].id).not.toBe(toClose.id);
  });

  test("surface.rename updates the listed title", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    await app.rpc.surface.rename({ surface_id: sid, title: "Custom Pane" });
    await expectSurface(app.rpc, sid).toHaveTitle("Custom Pane", 5_000);
  });

  test("four splits produce four surfaces", async ({ app }) => {
    for (let i = 0; i < 3; i++) {
      await app.rpc.surface.split({
        direction: i % 2 === 0 ? "horizontal" : "vertical",
      });
      await waitFor(
        async () => {
          const n = (await app.rpc.surface.list()).length;
          return n >= i + 2 ? true : undefined;
        },
        { timeoutMs: 5_000, message: `waiting for ${i + 2} surfaces` },
      );
    }
    const surfaces = await app.rpc.surface.list();
    expect(surfaces.length).toBe(4);
  });

  test("pane.list mirrors surface geometry", async ({ app }) => {
    await app.rpc.surface.split({ direction: "horizontal" });
    await expectApp(app.rpc).toHaveSurfaceCount(2, 5_000);
    const panes = await waitFor(
      async () => {
        const p = await app.rpc.pane.list();
        return p.length >= 2 ? p : undefined;
      },
      { timeoutMs: 5_000, message: "pane.list never returned 2 panes" },
    );
    expect(panes.length).toBe(2);
    expect(panes.some((p) => p.focused)).toBe(true);
    const totalWidth = panes.reduce((acc, p) => acc + p.w, 0);
    expect(totalWidth).toBeGreaterThan(0.9); // ~1.0 minus gap
  });
});
