// Plan #10 commit C — pure state coverage for the webview's
// AskUserState. No DOM, no Electrobun — just the FIFO + subscribe
// contract that the modal and sidebar badge layer onto.

import { describe, expect, test } from "bun:test";
import {
  AskUserState,
  type AskUserStateChange,
} from "../src/views/terminal/ask-user-state";
import type { AskUserRequest } from "../src/shared/types";

let nextId = 1;
function mkReq(partial: Partial<AskUserRequest> = {}): AskUserRequest {
  return {
    request_id: partial.request_id ?? `req:${nextId++}`,
    surface_id: partial.surface_id ?? "surface:1",
    kind: partial.kind ?? "yesno",
    title: partial.title ?? "ok?",
    body: partial.body,
    choices: partial.choices,
    default: partial.default,
    timeout_ms: partial.timeout_ms,
    unsafe: partial.unsafe,
    agent_id: partial.agent_id,
    created_at: partial.created_at ?? 0,
  };
}

function mkRecorder() {
  const events: AskUserStateChange[] = [];
  return {
    events,
    fn: (e: AskUserStateChange) => {
      events.push(e);
    },
  };
}

describe("AskUserState", () => {
  test("pushShown adds a request and notifies subscribers", () => {
    const state = new AskUserState();
    const rec = mkRecorder();
    state.subscribe(rec.fn);
    const req = mkReq({ request_id: "req:1" });
    state.pushShown(req);

    expect(state.getPendingCount("surface:1")).toBe(1);
    expect(state.getTotalCount()).toBe(1);
    expect(state.getHeadForSurface("surface:1")?.request_id).toBe("req:1");
    expect(rec.events).toEqual([{ kind: "shown", request: req }]);
  });

  test("pushShown is idempotent on request_id (replay-safe)", () => {
    const state = new AskUserState();
    const req = mkReq({ request_id: "dupe" });
    state.pushShown(req);
    state.pushShown(req);

    expect(state.getPendingCount("surface:1")).toBe(1);
    expect(state.getTotalCount()).toBe(1);
  });

  test("FIFO order per surface is preserved", () => {
    const state = new AskUserState();
    const a = mkReq({ request_id: "a", surface_id: "s" });
    const b = mkReq({ request_id: "b", surface_id: "s" });
    const c = mkReq({ request_id: "c", surface_id: "s" });
    state.pushShown(a);
    state.pushShown(b);
    state.pushShown(c);

    expect(state.getPendingForSurface("s").map((r) => r.request_id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(state.getHeadForSurface("s")?.request_id).toBe("a");
  });

  test("pushResolved drops the matching request and re-heads the surface", () => {
    const state = new AskUserState();
    const a = mkReq({ request_id: "a" });
    const b = mkReq({ request_id: "b" });
    state.pushShown(a);
    state.pushShown(b);
    state.pushResolved("a");

    expect(
      state.getPendingForSurface("surface:1").map((r) => r.request_id),
    ).toEqual(["b"]);
    expect(state.getHeadForSurface("surface:1")?.request_id).toBe("b");
    expect(state.getById("a")).toBeNull();
    expect(state.getById("b")?.request_id).toBe("b");
  });

  test("pushResolved on unknown id is a silent no-op", () => {
    const state = new AskUserState();
    const rec = mkRecorder();
    state.subscribe(rec.fn);
    state.pushResolved("ghost");

    expect(rec.events.length).toBe(0);
    expect(state.getTotalCount()).toBe(0);
  });

  test("resolving the last request for a surface clears the entry", () => {
    const state = new AskUserState();
    const a = mkReq({ request_id: "a", surface_id: "s" });
    state.pushShown(a);
    state.pushResolved("a");

    expect(state.getPendingForSurface("s")).toEqual([]);
    expect(state.getHeadForSurface("s")).toBeNull();
    expect(state.getPendingCount("s")).toBe(0);
  });

  test("seedSnapshot replaces all state and emits a snapshot event", () => {
    const state = new AskUserState();
    state.pushShown(mkReq({ request_id: "old" }));
    const rec = mkRecorder();
    state.subscribe(rec.fn);

    const incoming = [
      mkReq({ request_id: "n1", surface_id: "s1" }),
      mkReq({ request_id: "n2", surface_id: "s2" }),
      mkReq({ request_id: "n3", surface_id: "s1" }),
    ];
    state.seedSnapshot(incoming);

    expect(state.getById("old")).toBeNull();
    expect(state.getTotalCount()).toBe(3);
    expect(state.getPendingForSurface("s1").map((r) => r.request_id)).toEqual([
      "n1",
      "n3",
    ]);
    expect(state.getPendingForSurface("s2").map((r) => r.request_id)).toEqual([
      "n2",
    ]);
    expect(rec.events).toEqual([{ kind: "snapshot" }]);
  });

  test("seedSnapshot dedupes by request_id defensively", () => {
    const state = new AskUserState();
    const dup = mkReq({ request_id: "x" });
    state.seedSnapshot([dup, dup]);
    expect(state.getTotalCount()).toBe(1);
  });

  test("surfaces stay isolated — no cross-surface bleed", () => {
    const state = new AskUserState();
    state.pushShown(mkReq({ request_id: "a", surface_id: "alpha" }));
    state.pushShown(mkReq({ request_id: "b", surface_id: "beta" }));

    expect(state.getPendingCount("alpha")).toBe(1);
    expect(state.getPendingCount("beta")).toBe(1);
    expect(state.getPendingCount("gamma")).toBe(0);
    expect(state.getHeadForSurface("alpha")?.request_id).toBe("a");
    expect(state.getHeadForSurface("beta")?.request_id).toBe("b");
  });

  test("unsubscribe stops further notifications", () => {
    const state = new AskUserState();
    const rec = mkRecorder();
    const off = state.subscribe(rec.fn);
    state.pushShown(mkReq({ request_id: "a" }));
    off();
    state.pushShown(mkReq({ request_id: "b" }));

    expect(rec.events.length).toBe(1);
  });

  test("subscriber throws are isolated from other subscribers", () => {
    const state = new AskUserState();
    const calls: string[] = [];
    state.subscribe(() => {
      throw new Error("boom");
    });
    state.subscribe(() => {
      calls.push("ok");
    });
    state.pushShown(mkReq({ request_id: "a" }));
    expect(calls).toEqual(["ok"]);
  });

  test("getAllPending walks every surface", () => {
    const state = new AskUserState();
    state.pushShown(mkReq({ request_id: "a", surface_id: "s1" }));
    state.pushShown(mkReq({ request_id: "b", surface_id: "s2" }));
    state.pushShown(mkReq({ request_id: "c", surface_id: "s1" }));
    expect(
      state
        .getAllPending()
        .map((r) => r.request_id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });

  test("notification sequence: shown → resolved → shown again", () => {
    const state = new AskUserState();
    const rec = mkRecorder();
    state.subscribe(rec.fn);
    const a = mkReq({ request_id: "a" });
    const b = mkReq({ request_id: "b" });
    state.pushShown(a);
    state.pushResolved("a");
    state.pushShown(b);

    expect(rec.events).toEqual([
      { kind: "shown", request: a },
      { kind: "resolved", request_id: "a" },
      { kind: "shown", request: b },
    ]);
  });
});
