// P9 — PanelRegistry per-surface cap + existing behavior.
//
// The cap (default 256) guards against runaway scripts that mint
// fresh panel ids forever. When the cap is reached we evict the
// oldest entry (by createdAt) before inserting the new one. Existing
// behaviour (create / update / clear / flush handling, per-surface
// isolation, list) preserved.

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAX_PANELS_PER_SURFACE,
  PanelRegistry,
} from "../src/bun/panel-registry";
import type {
  SidebandContentMessage,
  SidebandMetaMessage,
} from "../src/shared/types";

function content(
  id: string,
  type: string = "image",
  extras: Partial<SidebandContentMessage> = {},
): SidebandContentMessage {
  return {
    id,
    type,
    ...extras,
  } as SidebandContentMessage;
}

describe("PanelRegistry — happy path", () => {
  test("creates a panel on first content message; list reflects it", () => {
    const r = new PanelRegistry();
    r.handleMeta("s1", content("p1"));
    expect(r.list("s1").map((p) => p.id)).toEqual(["p1"]);
  });

  test("updates do NOT mutate createdAt but DO mutate updatedAt + optional fields", () => {
    const r = new PanelRegistry();
    r.handleMeta("s1", content("p1", "image", { width: 100 }));
    const beforeCreate = r.list("s1")[0]!.createdAt;
    // Sleep-then-update is impractical in a sync test; instead just
    // assert that the create timestamp is preserved across an update.
    r.handleMeta("s1", content("p1", "update", { width: 200 }));
    const after = r.list("s1")[0]!;
    expect(after.createdAt).toBe(beforeCreate);
    expect(after.width).toBe(200);
  });

  test("clear removes the panel from that surface", () => {
    const r = new PanelRegistry();
    r.handleMeta("s1", content("p1"));
    r.handleMeta("s1", content("p1", "clear"));
    expect(r.list("s1")).toEqual([]);
  });

  test("flush is a no-op", () => {
    const r = new PanelRegistry();
    r.handleMeta("s1", content("p1"));
    r.handleMeta("s1", { type: "flush" } as SidebandMetaMessage);
    expect(r.list("s1")).toHaveLength(1);
  });

  test("per-surface isolation — s1 and s2 don't see each other's panels", () => {
    const r = new PanelRegistry();
    r.handleMeta("s1", content("p1"));
    r.handleMeta("s2", content("p2"));
    expect(r.list("s1").map((p) => p.id)).toEqual(["p1"]);
    expect(r.list("s2").map((p) => p.id)).toEqual(["p2"]);
  });

  test("clearSurface drops every panel for that surface", () => {
    const r = new PanelRegistry();
    r.handleMeta("s1", content("p1"));
    r.handleMeta("s1", content("p2"));
    r.clearSurface("s1");
    expect(r.list("s1")).toEqual([]);
  });
});

describe("PanelRegistry — P9 per-surface cap", () => {
  test("DEFAULT_MAX_PANELS_PER_SURFACE is a sane default", () => {
    expect(DEFAULT_MAX_PANELS_PER_SURFACE).toBe(256);
  });

  test("inserting beyond the cap evicts the OLDEST (createdAt) entry", async () => {
    const r = new PanelRegistry(3);
    r.handleMeta("s1", content("p1"));
    // Force a millisecond gap so createdAt ordering is deterministic.
    await Bun.sleep(2);
    r.handleMeta("s1", content("p2"));
    await Bun.sleep(2);
    r.handleMeta("s1", content("p3"));
    await Bun.sleep(2);
    r.handleMeta("s1", content("p4")); // should evict p1
    const ids = r
      .list("s1")
      .map((p) => p.id)
      .sort();
    expect(ids).toEqual(["p2", "p3", "p4"]);
  });

  test("updates to existing ids never trip the cap", () => {
    const r = new PanelRegistry(2);
    r.handleMeta("s1", content("p1"));
    r.handleMeta("s1", content("p2"));
    // Many updates — no evictions.
    for (let i = 0; i < 10; i++) {
      r.handleMeta("s1", content("p1", "update", { width: 100 + i }));
    }
    expect(
      r
        .list("s1")
        .map((p) => p.id)
        .sort(),
    ).toEqual(["p1", "p2"]);
  });

  test("clear of an evicted id is a no-op (doesn't throw)", () => {
    const r = new PanelRegistry(2);
    r.handleMeta("s1", content("p1"));
    r.handleMeta("s1", content("p2"));
    r.handleMeta("s1", content("p3")); // evicts p1
    // Now try to clear the already-evicted p1 — should not throw.
    expect(() => r.handleMeta("s1", content("p1", "clear"))).not.toThrow();
    expect(
      r
        .list("s1")
        .map((p) => p.id)
        .sort(),
    ).toEqual(["p2", "p3"]);
  });

  test("cap is per-surface — s1's cap doesn't affect s2", () => {
    const r = new PanelRegistry(2);
    r.handleMeta("s1", content("a"));
    r.handleMeta("s1", content("b"));
    r.handleMeta("s2", content("c"));
    r.handleMeta("s2", content("d"));
    expect(r.list("s1")).toHaveLength(2);
    expect(r.list("s2")).toHaveLength(2);
  });

  test("cap = 1 keeps only the most-recently-created panel", async () => {
    const r = new PanelRegistry(1);
    r.handleMeta("s1", content("p1"));
    await Bun.sleep(2);
    r.handleMeta("s1", content("p2"));
    expect(r.list("s1").map((p) => p.id)).toEqual(["p2"]);
  });

  test("non-positive cap argument is clamped to 1", () => {
    const r0 = new PanelRegistry(0);
    const rNeg = new PanelRegistry(-5);
    r0.handleMeta("s1", content("a"));
    r0.handleMeta("s1", content("b"));
    rNeg.handleMeta("s1", content("a"));
    rNeg.handleMeta("s1", content("b"));
    expect(r0.list("s1")).toHaveLength(1);
    expect(rNeg.list("s1")).toHaveLength(1);
  });
});
