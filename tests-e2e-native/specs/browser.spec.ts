import { test, expect } from "../fixtures";
import { waitFor } from "../helpers/wait";

test.describe("browser-pane", () => {
  test("browser.open creates a browser surface", async ({ app }) => {
    const before = (await app.rpc.browser.list()).length;
    await app.rpc.browser.open({ url: "about:blank" });
    await waitFor(
      async () => (await app.rpc.browser.list()).length > before || undefined,
      { timeoutMs: 10_000, message: "browser surface never appeared" },
    );
    const list = await app.rpc.browser.list();
    expect(list.length).toBeGreaterThan(before);
  });

  test("browser.navigate accepts a URL update", async ({ app }) => {
    // The bun-side handler dispatches to the webview; asserting on the
    // post-navigation URL requires network + navigation events that aren't
    // hermetic on CI. Assert that the call is accepted and the surface
    // remains known, which is the contract the RPC guarantees.
    await app.rpc.browser.open({ url: "about:blank" });
    const surface = await waitFor(
      async () => (await app.rpc.browser.list())[0],
      { timeoutMs: 10_000, message: "no browser surface" },
    );
    const target = "https://example.com/";
    const result = await app.rpc.browser.navigate({
      surface_id: surface.id,
      url: target,
    });
    expect(result).toBe("OK");
    const ident = await app.rpc.browser.identify({ surface_id: surface.id });
    expect(ident?.id).toBe(surface.id);
  });

  test("browser.identify matches browser.list entry", async ({ app }) => {
    await app.rpc.browser.open({ url: "about:blank" });
    const surface = await waitFor(
      async () => (await app.rpc.browser.list())[0],
      { timeoutMs: 10_000, message: "no browser surface" },
    );
    const ident = await app.rpc.browser.identify({ surface_id: surface.id });
    expect(ident).toBeTruthy();
    expect(ident?.id).toBe(surface.id);
    expect(ident?.url).toBe(surface.url);
  });

  test("browser.close removes the surface", async ({ app }) => {
    await app.rpc.browser.open({ url: "about:blank" });
    const surface = await waitFor(
      async () => (await app.rpc.browser.list())[0],
      { timeoutMs: 10_000, message: "no browser surface" },
    );
    await app.rpc.browser.close({ surface_id: surface.id });
    await waitFor(
      async () => {
        const list = await app.rpc.browser.list();
        return list.every((s) => s.id !== surface.id) ? true : undefined;
      },
      { timeoutMs: 10_000, message: "browser surface never removed" },
    );
  });

  test("multiple browser.open requests create distinct surfaces", async ({
    app,
  }) => {
    const before = (await app.rpc.browser.list()).length;
    await app.rpc.browser.open({ url: "about:blank" });
    await app.rpc.browser.open({ url: "about:blank" });
    await waitFor(
      async () =>
        (await app.rpc.browser.list()).length >= before + 2 ? true : undefined,
      { timeoutMs: 15_000, message: "only one browser surface created" },
    );
    const list = await app.rpc.browser.list();
    const ids = new Set(list.map((s) => s.id));
    expect(ids.size).toBe(list.length);
  });
});
