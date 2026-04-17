import { test, expect } from "../fixtures";

test.describe("smoke", () => {
  test("app boots and surface.list returns at least one surface", async ({
    app,
  }) => {
    const surfaces = await app.rpc.surface.list();
    expect(surfaces.length).toBeGreaterThan(0);
    expect(surfaces[0].id).toBe(app.info.firstSurfaceId);
  });

  test("system.ping verbose returns pid + uptime", async ({ app }) => {
    const pong = await app.rpc.system.ping(true);
    expect(pong).not.toBe("PONG");
    if (typeof pong === "object") {
      expect(pong.pong).toBe("PONG");
      expect(pong.pid).toBeGreaterThan(0);
      expect(pong.uptimeMs).toBeGreaterThan(0);
    }
  });

  test("capabilities includes panel.list and system.shutdown", async ({
    app,
  }) => {
    const caps = await app.rpc.system.capabilities();
    expect(caps.methods).toContain("panel.list");
    expect(caps.methods).toContain("system.shutdown");
    expect(caps.methods).toContain("system.ping");
  });
});
