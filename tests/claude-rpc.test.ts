/**
 * `claude.*` RPC handlers + `ht claude …` CLI mapping (august-plan M1).
 */
import { describe, test, expect, afterEach } from "bun:test";
import { SessionManager } from "../src/bun/session-manager";
import { createRpcHandler, type AppState } from "../src/bun/rpc-handler";
import { ClaudeSessionRegistry } from "../src/bun/claude-session-registry";
import type { ClaudeSessionState } from "../src/shared/claude-types";
import { mapCommand } from "../src/cli/map-command";

function makeState(): AppState {
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
  };
}

describe("claude.* RPC", () => {
  let sessions: SessionManager;

  afterEach(() => {
    sessions?.destroy();
  });

  function setup() {
    sessions = new SessionManager("/bin/sh");
    const registry = new ClaudeSessionRegistry();
    const handler = createRpcHandler(
      sessions,
      () => makeState(),
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { claudeRegistry: registry },
    );
    return { handler, registry };
  }

  test("claude.event ingests and claude.sessions reads back", () => {
    const { handler } = setup();
    const r = handler("claude.event", {
      event: {
        type: "prompt",
        sessionId: "s1",
        prompt: "Fix it",
        surfaceId: "surface:1",
      },
    });
    expect(r).toBe("OK");
    const out = handler("claude.sessions", {}) as {
      sessions: ClaudeSessionState[];
    };
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0]!.phase).toBe("working");
    expect(out.sessions[0]!.label).toBe("Fix it");
  });

  test("claude.statusline ingests the data plane", () => {
    const { handler, registry } = setup();
    const r = handler("claude.statusline", {
      data: { sessionId: "s1", costUsd: 0.5, modelDisplayName: "Opus" },
    });
    expect(r).toBe("OK");
    expect(registry.get("s1")?.costUsd).toBe(0.5);
  });

  test("malformed payloads return errors without throwing", () => {
    const { handler } = setup();
    expect(handler("claude.event", {})).toBe("ERR: missing event");
    expect(handler("claude.event", { event: { type: "prompt" } })).toBe(
      "ERR: invalid event",
    );
    expect(handler("claude.statusline", {})).toBe("ERR: missing data");
  });

  test("claude.sessions --all includes ended sessions", () => {
    const { handler } = setup();
    handler("claude.event", {
      event: { type: "session-end", sessionId: "gone" },
    });
    const live = handler("claude.sessions", {}) as {
      sessions: ClaudeSessionState[];
    };
    expect(live.sessions).toHaveLength(0);
    const all = handler("claude.sessions", { all: true }) as {
      sessions: ClaudeSessionState[];
    };
    expect(all.sessions).toHaveLength(1);
  });

  test("handlers are absent when no registry is wired (test fixtures)", () => {
    sessions = new SessionManager("/bin/sh");
    const handler = createRpcHandler(
      sessions,
      () => makeState(),
      () => {},
    );
    expect(() => handler("claude.sessions", {})).toThrow(/Unknown method/);
  });
});

describe("ht claude CLI mapping", () => {
  const ctx = (args: string[], flags: Record<string, string> = {}) => ({
    args: ["claude", ...args],
    command: "claude",
    positional: args,
    flags,
  });

  test("claude event --json maps to claude.event", () => {
    const call = mapCommand(
      ctx(["event"], {
        json: JSON.stringify({ type: "stop", sessionId: "s1" }),
      }),
    );
    expect(call.method).toBe("claude.event");
    expect((call.params["event"] as Record<string, unknown>)["type"]).toBe(
      "stop",
    );
  });

  test("claude event injects HT_SURFACE when the payload lacks it", () => {
    const prev = process.env["HT_SURFACE"];
    process.env["HT_SURFACE"] = "surface:9";
    try {
      const call = mapCommand(
        ctx(["event"], {
          json: JSON.stringify({ type: "stop", sessionId: "s1" }),
        }),
      );
      expect(
        (call.params["event"] as Record<string, unknown>)["surfaceId"],
      ).toBe("surface:9");
      // …but never overrides an explicit one.
      const call2 = mapCommand(
        ctx(["event"], {
          json: JSON.stringify({
            type: "stop",
            sessionId: "s1",
            surfaceId: "surface:2",
          }),
        }),
      );
      expect(
        (call2.params["event"] as Record<string, unknown>)["surfaceId"],
      ).toBe("surface:2");
    } finally {
      if (prev === undefined) delete process.env["HT_SURFACE"];
      else process.env["HT_SURFACE"] = prev;
    }
  });

  test("claude event without json throws a usage error", () => {
    expect(() => mapCommand(ctx(["event"]))).toThrow(/--json/);
  });

  test("claude approve does NOT default to HT_SURFACE (it must target the BLOCKED pane)", () => {
    // Regression: approve previously fell back to HT_SURFACE like the
    // sidebar verbs do, so running it from your own pane always asked
    // the app to answer *that* pane — never the one actually blocked.
    const prev = process.env["HT_SURFACE"];
    process.env["HT_SURFACE"] = "surface:1";
    try {
      const call = mapCommand(ctx(["approve"]));
      expect(call.method).toBe("claude.approve");
      expect(call.params["surface_id"]).toBeUndefined();
      // An explicit --surface still wins.
      expect(
        mapCommand(ctx(["approve"], { surface: "surface:7" })).params[
          "surface_id"
        ],
      ).toBe("surface:7");
    } finally {
      if (prev === undefined) delete process.env["HT_SURFACE"];
      else process.env["HT_SURFACE"] = prev;
    }
  });

  test("claude sessions maps with the all flag", () => {
    expect(mapCommand(ctx(["sessions"]))).toEqual({
      method: "claude.sessions",
      params: { all: false },
    });
    expect(mapCommand(ctx(["sessions"], { all: "true" })).params["all"]).toBe(
      true,
    );
  });

  test("unknown subcommand throws", () => {
    expect(() => mapCommand(ctx(["bogus"]))).toThrow(/Unknown claude/);
  });
});
