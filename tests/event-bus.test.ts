// P7 S8 — typed EventBus seam (A6).
//
// Covers the wrapper contract: emit dispatches a real DOM CustomEvent
// (so legacy window.addEventListener consumers stay reachable), on()
// returns an unsubscribe thunk, payload arrives typed (no detail
// unwrapping), and the bus can target a custom EventTarget for
// isolated tests.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { EventBus, htEvents } from "../src/bun/../shared/event-bus";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

interface FixtureMap extends Record<string, unknown> {
  "test:hello": { greeting: string };
  "test:tick": number;
  "test:ping": void;
}

function makeBus(): {
  bus: EventBus<FixtureMap>;
  target: EventTarget;
} {
  const target = new EventTarget();
  return { bus: new EventBus<FixtureMap>(target), target };
}

describe("EventBus (P7 S8 / A6)", () => {
  test("emit dispatches a CustomEvent on the underlying target", () => {
    const { bus, target } = makeBus();
    const seen: unknown[] = [];
    target.addEventListener("test:hello", (e: Event) => {
      seen.push((e as CustomEvent).detail);
    });
    bus.emit("test:hello", { greeting: "hi" });
    expect(seen).toEqual([{ greeting: "hi" }]);
  });

  test("on receives typed payload directly (no detail unwrap)", () => {
    const { bus } = makeBus();
    const seen: string[] = [];
    bus.on("test:hello", (payload) => seen.push(payload.greeting));
    bus.emit("test:hello", { greeting: "hello" });
    bus.emit("test:hello", { greeting: "world" });
    expect(seen).toEqual(["hello", "world"]);
  });

  test("the unsubscribe thunk stops further deliveries", () => {
    const { bus } = makeBus();
    const seen: number[] = [];
    const off = bus.on("test:tick", (n) => seen.push(n));
    bus.emit("test:tick", 1);
    off();
    bus.emit("test:tick", 2);
    expect(seen).toEqual([1]);
  });

  test("primitive payloads round-trip (number)", () => {
    const { bus } = makeBus();
    let lastValue: number | null = null;
    bus.on("test:tick", (n) => {
      lastValue = n;
    });
    bus.emit("test:tick", 42);
    expect(lastValue).toBe(42);
  });

  test("void payloads work — handler still fires", () => {
    const { bus } = makeBus();
    let fired = 0;
    bus.on("test:ping", () => fired++);
    bus.emit("test:ping", undefined);
    bus.emit("test:ping", undefined);
    expect(fired).toBe(2);
  });

  test("legacy window.addEventListener consumers still see typed emits", () => {
    const seen: string[] = [];
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { order?: string[] };
      if (d?.order) seen.push(...d.order);
    };
    window.addEventListener("ht-reorder-workspaces", handler);
    htEvents.emit("ht-reorder-workspaces", { order: ["ws:a", "ws:b"] });
    window.removeEventListener("ht-reorder-workspaces", handler);
    expect(seen).toEqual(["ws:a", "ws:b"]);
  });

  test("typed on() consumers see the same emits as legacy listeners", () => {
    const typed: string[][] = [];
    const off = htEvents.on("ht-reorder-workspaces", (p) =>
      typed.push(p.order),
    );
    htEvents.emit("ht-reorder-workspaces", { order: ["x", "y"] });
    off();
    htEvents.emit("ht-reorder-workspaces", { order: ["z"] });
    expect(typed).toEqual([["x", "y"]]);
  });
});
