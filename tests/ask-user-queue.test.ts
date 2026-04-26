// Plan #10 — pure-state coverage for AskUserQueue. Uses a manual
// timer factory so timeout cases are deterministic; uses a fixed
// clock so created_at fields are predictable.

import { describe, expect, test } from "bun:test";
import { AskUserQueue } from "../src/bun/ask-user-queue";

interface ManualTimer {
  fire(): void;
  cancelled: boolean;
}

function mkQueue() {
  const timers: ManualTimer[] = [];
  const queue = new AskUserQueue({
    now: () => 0,
    setTimer: (fn) => {
      const timer: ManualTimer = {
        fire: () => fn(),
        cancelled: false,
      };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as ManualTimer).cancelled = true;
    },
  });
  return { queue, timers };
}

describe("AskUserQueue", () => {
  test("create assigns a request_id and emits a shown event", async () => {
    const { queue } = mkQueue();
    const events: string[] = [];
    queue.subscribe((e) =>
      events.push(
        e.kind === "shown"
          ? `shown:${e.request.request_id}`
          : `resolved:${e.request_id}`,
      ),
    );
    const { request } = queue.create({
      surface_id: "surface:1",
      kind: "yesno",
      title: "ok?",
    });
    expect(request.request_id).toBe("req:1");
    expect(request.surface_id).toBe("surface:1");
    expect(events).toEqual(["shown:req:1"]);
  });

  test("answer resolves the pending promise with the supplied value", async () => {
    const { queue } = mkQueue();
    const { request, response } = queue.create({
      surface_id: "surface:1",
      kind: "text",
      title: "name?",
    });
    const accepted = queue.answer(request.request_id, "Olivier");
    expect(accepted).toBe(true);
    const r = await response;
    expect(r).toEqual({
      request_id: "req:1",
      action: "ok",
      value: "Olivier",
    });
  });

  test("cancel resolves with action=cancel and an optional reason", async () => {
    const { queue } = mkQueue();
    const { request, response } = queue.create({
      surface_id: "surface:1",
      kind: "yesno",
      title: "delete?",
    });
    const accepted = queue.cancel(request.request_id, "user said no");
    expect(accepted).toBe(true);
    const r = await response;
    expect(r).toEqual({
      request_id: "req:1",
      action: "cancel",
      reason: "user said no",
    });
  });

  test("timeout fires action=timeout when the manual timer fires", async () => {
    const { queue, timers } = mkQueue();
    const { response } = queue.create({
      surface_id: "surface:1",
      kind: "yesno",
      title: "ok?",
      timeout_ms: 5000,
    });
    expect(timers.length).toBe(1);
    timers[0]!.fire();
    const r = await response;
    expect(r.action).toBe("timeout");
  });

  test("answer before timeout cancels the timer", async () => {
    const { queue, timers } = mkQueue();
    const { request, response } = queue.create({
      surface_id: "surface:1",
      kind: "yesno",
      title: "ok?",
      timeout_ms: 5000,
    });
    queue.answer(request.request_id, "yes");
    expect(timers[0]!.cancelled).toBe(true);
    const r = await response;
    expect(r.action).toBe("ok");
  });

  test("answering an unknown id returns false without crashing", () => {
    const { queue } = mkQueue();
    expect(queue.answer("ghost", "x")).toBe(false);
    expect(queue.cancel("ghost")).toBe(false);
  });

  test("pending_list returns requests in insertion order", () => {
    const { queue } = mkQueue();
    queue.create({ surface_id: "surface:1", kind: "yesno", title: "a" });
    queue.create({ surface_id: "surface:2", kind: "yesno", title: "b" });
    queue.create({ surface_id: "surface:1", kind: "yesno", title: "c" });
    const ids = queue.pending_list().map((r) => r.request_id);
    expect(ids).toEqual(["req:1", "req:2", "req:3"]);
  });

  test("pending_for_surface filters by surface id while preserving order", () => {
    const { queue } = mkQueue();
    queue.create({ surface_id: "s1", kind: "yesno", title: "a" });
    queue.create({ surface_id: "s2", kind: "yesno", title: "b" });
    queue.create({ surface_id: "s1", kind: "yesno", title: "c" });
    const titles = queue.pending_for_surface("s1").map((r) => r.title);
    expect(titles).toEqual(["a", "c"]);
  });

  test("resolved entries leave the pending list", async () => {
    const { queue } = mkQueue();
    const { request, response } = queue.create({
      surface_id: "s1",
      kind: "yesno",
      title: "a",
    });
    queue.answer(request.request_id, "yes");
    await response;
    expect(queue.pending_list()).toEqual([]);
  });

  test("a throwing subscriber doesn't break the queue", () => {
    const { queue } = mkQueue();
    queue.subscribe(() => {
      throw new Error("oops");
    });
    let calls = 0;
    queue.subscribe(() => calls++);
    queue.create({ surface_id: "s1", kind: "yesno", title: "a" });
    expect(calls).toBe(1);
  });

  test("unsubscribe stops further events", () => {
    const { queue } = mkQueue();
    let calls = 0;
    const off = queue.subscribe(() => calls++);
    queue.create({ surface_id: "s1", kind: "yesno", title: "a" });
    expect(calls).toBe(1);
    off();
    queue.create({ surface_id: "s1", kind: "yesno", title: "b" });
    expect(calls).toBe(1);
  });

  test("subscriber sees both shown and resolved events for a single round-trip", async () => {
    const { queue } = mkQueue();
    const seen: string[] = [];
    queue.subscribe((e) => {
      if (e.kind === "shown") seen.push(`shown:${e.request.request_id}`);
      else seen.push(`resolved:${e.request_id}:${e.response.action}`);
    });
    const { request, response } = queue.create({
      surface_id: "s1",
      kind: "yesno",
      title: "a",
    });
    queue.answer(request.request_id, "yes");
    await response;
    expect(seen).toEqual(["shown:req:1", "resolved:req:1:ok"]);
  });

  test("ids increment per-instance for predictability", () => {
    const { queue } = mkQueue();
    const a = queue.create({
      surface_id: "s1",
      kind: "yesno",
      title: "a",
    }).request;
    const b = queue.create({
      surface_id: "s1",
      kind: "yesno",
      title: "b",
    }).request;
    expect(a.request_id).toBe("req:1");
    expect(b.request_id).toBe("req:2");
  });

  test("custom idFactory overrides the default counter", () => {
    let n = 0;
    const queue = new AskUserQueue({
      idFactory: () => `custom:${++n}`,
    });
    const r = queue.create({
      surface_id: "s1",
      kind: "yesno",
      title: "x",
    }).request;
    expect(r.request_id).toBe("custom:1");
  });

  test("created_at uses the supplied clock", () => {
    const queue = new AskUserQueue({ now: () => 12345 });
    const r = queue.create({
      surface_id: "s1",
      kind: "yesno",
      title: "x",
    }).request;
    expect(r.created_at).toBe(12345);
  });

  test("answer is idempotent — second answer on the same id is a no-op", async () => {
    const { queue } = mkQueue();
    const { request, response } = queue.create({
      surface_id: "s1",
      kind: "text",
      title: "x",
    });
    expect(queue.answer(request.request_id, "first")).toBe(true);
    expect(queue.answer(request.request_id, "second")).toBe(false);
    const r = await response;
    expect(r.value).toBe("first");
  });
});
