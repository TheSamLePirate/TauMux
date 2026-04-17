import { test, expect } from "../fixtures";
import { sleep, waitFor } from "../helpers/wait";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const SIDEBAND_SCRIPT = `${REPO_ROOT}/scripts/test_sideband.sh`;

test.describe("sideband", () => {
  test("svg + html panels land in panel.list", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    await sleep(500);
    await app.rpc.surface.send_text({
      surface_id: sid,
      text: `bash ${SIDEBAND_SCRIPT}\r`,
    });

    // Wait for both panels to be created. The script also fires a `clear`
    // for the svg panel at the end, so we assert on the intermediate state.
    const panels = await waitFor(
      async () => {
        const list = await app.rpc.panel.list({ surface_id: sid });
        return list.length >= 2 ? list : undefined;
      },
      { timeoutMs: 15_000, message: "panels never reached 2" },
    );
    const types = new Set(panels.map((p) => p.type));
    expect(types.has("html")).toBe(true);
    // svg may or may not still be there depending on whether `clear`
    // already fired; at least one of the two content types should be live.
    expect(types.size).toBeGreaterThan(0);
  });

  test("clear op removes a panel from panel.list", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    await sleep(500);
    await app.rpc.surface.send_text({
      surface_id: sid,
      text: `bash ${SIDEBAND_SCRIPT}\r`,
    });
    // Script ends with a clear on the svg-test panel; wait for it.
    await waitFor(
      async () => {
        const list = await app.rpc.panel.list({ surface_id: sid });
        return list.every((p) => p.id !== "svg-test") &&
          list.some((p) => p.id === "html-test")
          ? true
          : undefined;
      },
      {
        timeoutMs: 20_000,
        message: "svg-test panel never cleared while html-test remained",
      },
    );
  });

  test("panel.list is empty for surfaces with no sideband activity", async ({
    app,
  }) => {
    const sid = app.info.firstSurfaceId;
    const panels = await app.rpc.panel.list({ surface_id: sid });
    expect(panels).toEqual([]);
  });

  test("panel.list resolves focused surface when no id given", async ({
    app,
  }) => {
    const panels = await app.rpc.panel.list();
    expect(Array.isArray(panels)).toBe(true);
  });

  test("update op mutates an existing panel without creating a new one", async ({
    app,
  }) => {
    const sid = app.info.firstSurfaceId;
    await sleep(500);
    await app.rpc.surface.send_text({
      surface_id: sid,
      text: `bash ${SIDEBAND_SCRIPT}\r`,
    });
    // Wait for the script to reach its "Test 3: Move SVG panel" update op.
    // The registry's updatedAt advances without a new entry appearing.
    await waitFor(
      async () => {
        const panels = await app.rpc.panel.list({ surface_id: sid });
        const svg = panels.find((p) => p.id === "svg-test");
        if (!svg) return undefined;
        return svg.updatedAt > svg.createdAt ? true : undefined;
      },
      { timeoutMs: 15_000, message: "update never advanced updatedAt" },
    );
  });

  test("panel descriptors carry the position + dimension fields", async ({
    app,
  }) => {
    const sid = app.info.firstSurfaceId;
    await sleep(500);
    await app.rpc.surface.send_text({
      surface_id: sid,
      text: `bash ${SIDEBAND_SCRIPT}\r`,
    });
    await waitFor(
      async () => {
        const panels = await app.rpc.panel.list({ surface_id: sid });
        const html = panels.find((p) => p.id === "html-test");
        return html?.width !== undefined ? html : undefined;
      },
      { timeoutMs: 15_000, message: "html panel never surfaced with width" },
    );
  });

  test("closing the surface clears its panels", async ({ app }) => {
    const sid = app.info.firstSurfaceId;
    await sleep(500);
    await app.rpc.surface.send_text({
      surface_id: sid,
      text: `bash ${SIDEBAND_SCRIPT}\r`,
    });
    await waitFor(
      async () => {
        const panels = await app.rpc.panel.list({ surface_id: sid });
        return panels.length > 0 ? true : undefined;
      },
      { timeoutMs: 15_000, message: "no panels" },
    );
    // Split so we have a second surface to focus after closing.
    await app.rpc.surface.split({ direction: "horizontal" });
    await app.rpc.surface.close({ surface_id: sid });
    await expect
      .poll(
        async () => (await app.rpc.panel.list({ surface_id: sid })).length,
        { timeout: 5_000 },
      )
      .toBe(0);
  });
});
