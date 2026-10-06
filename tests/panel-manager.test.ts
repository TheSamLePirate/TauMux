import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { PanelManager } from "../src/views/terminal/panel-manager";

/**
 * The pending-data prune timer used to be armed in the constructor —
 * one 30 s interval per terminal pane, iterating an almost-always-
 * empty map forever (20 panes = 20 timers). It is now armed lazily by
 * the first pending entry and disarms itself when the map empties.
 */

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

/** Minimal xterm stub: the manager only subscribes to onScroll/onResize. */
function stubTerm() {
  const disposable = { dispose: () => {} };
  return {
    onScroll: () => disposable,
    onResize: () => disposable,
  };
}

/** Structural view of the private timing state — the behaviour under
 *  test IS the timer lifecycle, so the test reads it directly. */
interface TimerView {
  pendingPruneTimer: unknown;
  pendingData: Map<string, { data: Uint8Array; timestamp: number }>;
  prunePending(): void;
}

function makeManager() {
  const container = document.createElement("div");
  const manager = new PanelManager(
    container,
    stubTerm() as never,
    () => {},
  );
  return { manager, view: manager as unknown as TimerView };
}

describe("PanelManager pending-prune timer", () => {
  test("construction arms NO timer", () => {
    const { manager, view } = makeManager();
    expect(view.pendingPruneTimer).toBeNull();
    manager.destroy();
  });

  test("the first pending binary arms the timer", () => {
    const { manager, view } = makeManager();
    manager.handleBinary("p1", new Uint8Array([1, 2, 3]));
    expect(view.pendingData.size).toBe(1);
    expect(view.pendingPruneTimer).not.toBeNull();
    manager.destroy();
    expect(view.pendingPruneTimer).toBeNull();
  });

  test("prunePending drops stale entries and DISARMS when the map empties", () => {
    const { manager, view } = makeManager();
    manager.handleBinary("p1", new Uint8Array([1]));
    // Age the entry past the TTL by rewriting its timestamp.
    view.pendingData.set("p1", {
      data: new Uint8Array([1]),
      timestamp: Date.now() - 120_000,
    });
    view.prunePending();
    expect(view.pendingData.size).toBe(0);
    expect(view.pendingPruneTimer).toBeNull();
    manager.destroy();
  });

  test("prunePending keeps fresh entries and STAYS armed", () => {
    const { manager, view } = makeManager();
    manager.handleBinary("p1", new Uint8Array([1]));
    view.prunePending();
    expect(view.pendingData.size).toBe(1);
    expect(view.pendingPruneTimer).not.toBeNull();
    manager.destroy();
  });

  test("a pane with no stray binary never arms anything across its lifetime", () => {
    const { manager, view } = makeManager();
    manager.handleDataFailed("nope", "test");
    expect(view.pendingPruneTimer).toBeNull();
    manager.destroy();
  });
});
