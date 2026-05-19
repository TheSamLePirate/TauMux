import { describe, expect, test } from "bun:test";
import { enrichContext } from "../../../pi-extensions/ht-bridge/lib/surface-context";
import type { HtClient } from "../../../pi-extensions/ht-bridge/lib/ht-client";
import type { SurfaceContext } from "../../../pi-extensions/ht-bridge/lib/surface-context";

function ctx(): SurfaceContext {
  return {
    surfaceId: "surface:7",
    workspaceId: null,
    agentId: "pi:surface:7",
    inTauMux: true,
    cwd: null,
    fg: null,
  };
}

function ht(responses: Record<string, unknown>): HtClient {
  return {
    async call<T>(method: string): Promise<T> {
      if (!(method in responses)) throw new Error(`unexpected method ${method}`);
      return responses[method] as T;
    },
    callSoft() {},
    socketAvailable: () => true,
  };
}

describe("ht-bridge surface context enrichment", () => {
  test("accepts current system.identify snake_case workspace fields", async () => {
    const c = ctx();
    await enrichContext(
      c,
      ht({
        "system.identify": {
          active_workspace: "ws:2",
          focused_surface: "surface:7",
        },
      }),
    );
    expect(c.workspaceId).toBe("ws:2");
  });

  test("accepts camelCase identify aliases used by fixtures", async () => {
    const c = ctx();
    await enrichContext(
      c,
      ht({
        "system.identify": {
          workspaceId: "ws:3",
          surfaceId: "surface:7",
          metadata: { cwd: "/tmp/project", fg: "pi" },
        },
      }),
    );
    expect(c.workspaceId).toBe("ws:3");
    expect(c.cwd).toBe("/tmp/project");
    expect(c.fg).toBe("pi");
  });

  test("maps HT_SURFACE through system.tree when another pane is focused", async () => {
    const c = ctx();
    await enrichContext(
      c,
      ht({
        "system.identify": {
          active_workspace: "ws:focused",
          focused_surface: "surface:99",
        },
        "system.tree": [
          { workspace: "ws:1", surfaces: [{ id: "surface:1" }] },
          { workspace: "ws:own", surfaces: [{ id: "surface:7" }] },
        ],
      }),
    );
    expect(c.workspaceId).toBe("ws:own");
  });

  test("falls back to active workspace if tree lookup fails", async () => {
    const c = ctx();
    await enrichContext(
      c,
      ht({
        "system.identify": {
          active_workspace: "ws:fallback",
          focused_surface: "surface:99",
        },
        "system.tree": [],
      }),
    );
    expect(c.workspaceId).toBe("ws:fallback");
  });
});
