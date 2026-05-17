// P7 S3 — notification history persistence.
//
// Boots a temp dir, hydrates a store from a hand-written JSON file,
// then exercises the debounced persister to confirm the round-trip is
// stable across simulated restarts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDebouncedPersister,
  loadInto,
} from "../src/bun/notification-persistence";
import type {
  Notification,
  NotificationStore,
} from "../src/bun/rpc-handlers/types";

function freshStore(): NotificationStore {
  return { list: [], counter: 0 };
}

function notif(id: string, title: string): Notification {
  return { id, title, body: "", time: 1000 };
}

describe("notification-persistence", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tau-notif-"));
    path = join(dir, "notifications.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("loadInto is a no-op when the file is absent", () => {
    const store = freshStore();
    loadInto(path, store);
    expect(store.list).toEqual([]);
    expect(store.counter).toBe(0);
  });

  test("loadInto seeds the store from a v1 snapshot", () => {
    const payload = {
      version: 1,
      counter: 7,
      list: [notif("notif:1", "a"), notif("notif:2", "b")],
    };
    writeFileSync(path, JSON.stringify(payload));

    const store = freshStore();
    loadInto(path, store);
    expect(store.list.map((n) => n.id)).toEqual(["notif:1", "notif:2"]);
    expect(store.counter).toBe(7);
  });

  test("loadInto skips unknown versions instead of corrupting state", () => {
    writeFileSync(
      path,
      JSON.stringify({ version: 999, counter: 0, list: [notif("x", "x")] }),
    );
    const store = freshStore();
    loadInto(path, store);
    expect(store.list).toEqual([]);
    expect(store.counter).toBe(0);
  });

  test("loadInto swallows malformed JSON (treats as empty history)", () => {
    writeFileSync(path, "{ broken json");
    const store = freshStore();
    loadInto(path, store);
    expect(store.list).toEqual([]);
  });

  test("loadInto trims a tampered list down to the 500-entry cap", () => {
    const huge: Notification[] = [];
    for (let i = 0; i < 1200; i++) huge.push(notif(`notif:${i}`, `t${i}`));
    writeFileSync(
      path,
      JSON.stringify({ version: 1, counter: 1200, list: huge }),
    );
    const store = freshStore();
    loadInto(path, store);
    expect(store.list.length).toBe(500);
    expect(store.list[0]!.id).toBe("notif:700"); // most recent 500
    expect(store.counter).toBe(1200);
  });

  test("persist() debounces a burst into one write + round-trips", async () => {
    const store = freshStore();
    const { persist, flush } = createDebouncedPersister(path, store, 20);

    store.list.push(notif("notif:1", "a"));
    store.counter = 1;
    persist();
    store.list.push(notif("notif:2", "b"));
    store.counter = 2;
    persist();
    store.list.push(notif("notif:3", "c"));
    store.counter = 3;
    persist();

    expect(existsSync(path)).toBe(false); // debounced — no write yet

    flush(); // simulate shutdown — fires the pending write immediately

    expect(existsSync(path)).toBe(true);

    // Round-trip into a fresh store.
    const next = freshStore();
    loadInto(path, next);
    expect(next.list.map((n) => n.id)).toEqual([
      "notif:1",
      "notif:2",
      "notif:3",
    ]);
    expect(next.counter).toBe(3);
  });

  test("persist() writes coalesce after the debounce delay", async () => {
    const store = freshStore();
    const { persist } = createDebouncedPersister(path, store, 20);

    store.list.push(notif("notif:1", "a"));
    persist();
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(path)).toBe(true);
  });
});
