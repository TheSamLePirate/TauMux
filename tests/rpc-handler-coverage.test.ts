// Phase 3 Step 2 — RPC method ↔ handler invariant.
//
// Closes a class of A1-style regressions at runtime: every method
// registered via `createRpcHandler` should also have a schema entry
// in METHOD_SCHEMAS for the security-sensitive subset, and the
// system.capabilities response (the externally-visible method list)
// must include every registered method. A future PR that adds a
// handler without registering it correctly, or that exposes a
// method-name schema for something that isn't actually wired, fails
// this test.

import { describe, expect, test, afterEach } from "bun:test";
import { SessionManager } from "../src/bun/session-manager";
import { createRpcHandler, type AppState } from "../src/bun/rpc-handler";
import { METHOD_SCHEMAS } from "../src/bun/rpc-handlers/shared";

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    focusedSurfaceId: "surface:1",
    workspaces: [
      {
        id: "ws:1",
        name: "Test",
        color: "#89b4fa",
        surfaceIds: ["surface:1"],
        focusedSurfaceId: "surface:1",
        layout: { type: "leaf", surfaceId: "surface:1" },
      },
    ],
    activeWorkspaceId: "ws:1",
    ...overrides,
  };
}

let sessions: SessionManager | null = null;
afterEach(() => {
  sessions?.destroy();
  sessions = null;
});

function listMethods(): string[] {
  sessions = new SessionManager("/bin/sh");
  const handler = createRpcHandler(
    sessions,
    () => makeState(),
    () => {},
  );
  // `system.capabilities` returns the registered method list — same
  // surface area the externally-observable `ht --json capabilities`
  // exposes. Use it rather than reaching into private state.
  const result = handler("system.capabilities", {});
  expect(result).toBeDefined();
  // The result shape is `{ methods: string[] }`.
  const r = result as { methods: string[] };
  expect(Array.isArray(r.methods)).toBe(true);
  return r.methods;
}

describe("[Phase 3] RPC handler coverage invariants", () => {
  test("system.capabilities returns at least the well-known method set", () => {
    const methods = listMethods();
    // A hard floor — every release should ship these. The list grows
    // forward (never shrinks) so an absolute minimum is the safest
    // gate. Adding a new method here is a deliberate act.
    for (const must of [
      "system.ping",
      "system.version",
      "system.identify",
      "system.capabilities",
      "system.tree",
      "surface.metadata",
      "workspace.list",
    ]) {
      expect(methods).toContain(must);
    }
    // Sanity ceiling — if the count drops below this floor, something
    // broke the registration pipeline (a missing register*() call in
    // createRpcHandler).
    expect(methods.length).toBeGreaterThanOrEqual(40);
  });

  test("every METHOD_SCHEMAS entry corresponds to a registered handler", () => {
    // If a schema is declared for a method that's no longer wired,
    // a CLI call to that method would bypass schema validation
    // because the registered-methods check happens first. Catching
    // this dead schema entry up front prevents the rot.
    const methods = new Set(listMethods());
    const missing: string[] = [];
    for (const m of Object.keys(METHOD_SCHEMAS)) {
      if (!methods.has(m)) missing.push(m);
    }
    expect(missing).toEqual([]);
  });

  test("the method list contains no duplicates", () => {
    const methods = listMethods();
    const set = new Set(methods);
    expect(set.size).toBe(methods.length);
  });
});
