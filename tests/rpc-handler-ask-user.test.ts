// Integration coverage for the agent.ask_* RPC family. Wires a real
// AskUserQueue through `createRpcHandler` and asserts the
// long-pending agent.ask_user resolves when a sibling
// agent.ask_answer / agent.ask_cancel lands.

import { afterEach, describe, expect, test } from "bun:test";
import { SessionManager } from "../src/bun/session-manager";
import { createRpcHandler, type AppState } from "../src/bun/rpc-handler";
import { AskUserQueue } from "../src/bun/ask-user-queue";

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

describe("agent.ask_* RPCs", () => {
  let sessions: SessionManager;
  afterEach(() => {
    sessions?.destroy();
  });

  function setup() {
    sessions = new SessionManager("/bin/sh");
    const askUser = new AskUserQueue();
    const handler = createRpcHandler(
      sessions,
      makeState,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { askUser },
    );
    return { handler, askUser };
  }

  test("ask_user is long-pending and resolves on ask_answer", async () => {
    const { handler, askUser } = setup();
    const askPromise = handler("agent.ask_user", {
      surface_id: "surface:1",
      kind: "text",
      title: "name?",
    });
    // The promise is pending — pull the queued request id and answer it.
    expect(askUser.pending_list().length).toBe(1);
    const id = askUser.pending_list()[0]!.request_id;
    const answer = handler("agent.ask_answer", {
      request_id: id,
      value: "Olivier",
    }) as { resolved: boolean };
    expect(answer.resolved).toBe(true);
    const result = (await askPromise) as {
      action: string;
      value?: string;
    };
    expect(result.action).toBe("ok");
    expect(result.value).toBe("Olivier");
  });

  test("ask_cancel resolves the long-pending request with action=cancel", async () => {
    const { handler, askUser } = setup();
    const askPromise = handler("agent.ask_user", {
      surface_id: "surface:1",
      kind: "yesno",
      title: "delete?",
    });
    const id = askUser.pending_list()[0]!.request_id;
    handler("agent.ask_cancel", { request_id: id, reason: "user said no" });
    const result = (await askPromise) as { action: string; reason?: string };
    expect(result.action).toBe("cancel");
    expect(result.reason).toBe("user said no");
  });

  test("ask_pending returns the queued requests", async () => {
    const { handler } = setup();
    void handler("agent.ask_user", {
      surface_id: "surface:1",
      kind: "text",
      title: "first",
    });
    void handler("agent.ask_user", {
      surface_id: "surface:2",
      kind: "yesno",
      title: "second",
    });
    const pending = handler("agent.ask_pending", {}) as {
      pending: { title: string; surface_id: string }[];
    };
    expect(pending.pending.map((r) => r.title)).toEqual(["first", "second"]);
  });

  test("ask_pending filters by surface_id", async () => {
    const { handler } = setup();
    void handler("agent.ask_user", {
      surface_id: "s1",
      kind: "text",
      title: "a",
    });
    void handler("agent.ask_user", {
      surface_id: "s2",
      kind: "text",
      title: "b",
    });
    void handler("agent.ask_user", {
      surface_id: "s1",
      kind: "text",
      title: "c",
    });
    const filtered = handler("agent.ask_pending", { surface_id: "s1" }) as {
      pending: { title: string }[];
    };
    expect(filtered.pending.map((r) => r.title)).toEqual(["a", "c"]);
  });

  test("ask_user rejects an invalid kind", () => {
    const { handler } = setup();
    expect(() =>
      handler("agent.ask_user", {
        surface_id: "s1",
        kind: "garbage",
        title: "x",
      }),
    ).toThrow(/invalid kind/);
  });

  test("ask_user with kind=choice requires non-empty choices array", () => {
    const { handler } = setup();
    expect(() =>
      handler("agent.ask_user", {
        surface_id: "s1",
        kind: "choice",
        title: "pick",
      }),
    ).toThrow(/choices/);
    expect(() =>
      handler("agent.ask_user", {
        surface_id: "s1",
        kind: "choice",
        title: "pick",
        choices: [],
      }),
    ).toThrow(/at least one/);
  });

  test("ask_user kind=choice persists choices on the request", async () => {
    const { handler, askUser } = setup();
    void handler("agent.ask_user", {
      surface_id: "s1",
      kind: "choice",
      title: "branch",
      choices: [
        { id: "main", label: "main" },
        { id: "dev", label: "dev" },
      ],
    });
    const req = askUser.pending_list()[0]!;
    expect(req.choices).toEqual([
      { id: "main", label: "main" },
      { id: "dev", label: "dev" },
    ]);
  });

  test("ask_answer / ask_cancel return resolved=false for unknown ids", () => {
    const { handler } = setup();
    expect(
      handler("agent.ask_answer", { request_id: "ghost", value: "x" }),
    ).toEqual({
      resolved: false,
    });
    expect(handler("agent.ask_cancel", { request_id: "ghost" })).toEqual({
      resolved: false,
    });
  });

  test("ask_user rejects when surface_id / title are missing", () => {
    const { handler } = setup();
    expect(() =>
      handler("agent.ask_user", { kind: "yesno", title: "x" }),
    ).toThrow(/surface_id/);
    expect(() =>
      handler("agent.ask_user", { surface_id: "s1", kind: "yesno" }),
    ).toThrow(/title/);
  });
});
