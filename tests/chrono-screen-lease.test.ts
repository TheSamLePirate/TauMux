// The screen lease — CHRONO's one dangerous move, isolated and proven.
//
// CHRONO borrows the *real* `.surface-container` of every pane into its
// lanes. Getting the handover wrong strands the user's panes behind an
// overlay they can no longer reach, so the lease ships before anything
// is built on top of it, with every exit path tested:
//
//   move · release · double release · release on teardown ·
//   release after the surface closed under us · the sibling that
//   vanished while we held the pane.
//
// The invariant behind all of them: the view never holds a container it
// cannot give back, and it always gives it back exactly as found.

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Scoped to this file — a project-wide preload would mutate globalThis
// for the web-server suites that rely on Bun's native fetch/WebSocket.
beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

import {
  LEASE_FLAG,
  ScreenLeases,
} from "../src/views/terminal/chrono/screen-lease";

interface Fixture {
  root: HTMLDivElement;
  slot: HTMLDivElement;
  panes: HTMLDivElement[];
}

/** Three absolutely-positioned panes in a container, as SurfaceManager
 *  leaves them, plus an empty CHRONO slot. */
function fixture(count = 3): Fixture {
  const root = document.createElement("div");
  root.id = "terminal-container";
  const panes: HTMLDivElement[] = [];
  for (let i = 0; i < count; i++) {
    const pane = document.createElement("div");
    pane.className = "surface-container";
    pane.dataset["surfaceId"] = `s${i}`;
    pane.style.cssText = `left: ${i * 100}px; top: 0px; width: 100px; height: 50px; display: ${i === 0 ? "flex" : "none"};`;
    pane.dataset["layoutSig"] = `${i * 100},0,100,50`;
    root.appendChild(pane);
    panes.push(pane);
  }
  const slot = document.createElement("div");
  slot.className = "tau-chrono-head-slot";
  document.body.append(root, slot);
  return { root, slot, panes };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("ScreenLeases.borrow", () => {
  test("moves the container into the slot and flags it", () => {
    const { slot, panes } = fixture();
    const leases = new ScreenLeases();

    expect(leases.borrow("s1", panes[1]!, slot)).toBe(true);

    expect(panes[1]!.parentElement).toBe(slot);
    expect(panes[1]!.dataset[LEASE_FLAG]).toBe("1");
    expect(leases.isLeased("s1")).toBe(true);
    expect(leases.size).toBe(1);
  });

  test("refuses an element with no parent to return to", () => {
    const { slot } = fixture();
    const orphan = document.createElement("div");
    const leases = new ScreenLeases();

    // The one case that could strand a pane: we would have nowhere to
    // put it back. Refuse rather than take it.
    expect(leases.borrow("ghost", orphan, slot)).toBe(false);
    expect(leases.size).toBe(0);
    expect(orphan.dataset[LEASE_FLAG]).toBeUndefined();
    expect(orphan.parentElement).toBeNull();
  });

  test("clears the pane's inline rect so the lane can own the geometry", () => {
    const { slot, panes } = fixture();
    const leases = new ScreenLeases();

    leases.borrow("s0", panes[0]!, slot);

    // An inline rect beats any rule a lane could state, so the borrow
    // hands presentation to the stylesheet outright.
    expect(panes[0]!.style.cssText).toBe("");
  });

  test("is idempotent for the same surface and slot", () => {
    const { slot, panes } = fixture();
    const leases = new ScreenLeases();
    const original = panes[0]!.style.cssText;

    leases.borrow("s0", panes[0]!, slot);
    // A lane sets its own geometry between refreshes; a second borrow
    // must not mistake that for the pane's return address.
    panes[0]!.style.cssText = "position: relative; height: 100%;";
    leases.borrow("s0", panes[0]!, slot);

    expect(leases.size).toBe(1);
    expect(slot.children.length).toBe(1);

    leases.release("s0");
    expect(panes[0]!.style.cssText).toBe(original);
  });

  test("re-borrowing into a new slot keeps the original return address", () => {
    const { root, slot, panes } = fixture();
    const other = document.createElement("div");
    document.body.appendChild(other);
    const leases = new ScreenLeases();

    leases.borrow("s2", panes[2]!, slot);
    leases.borrow("s2", panes[2]!, other);
    expect(panes[2]!.parentElement).toBe(other);

    leases.release("s2");
    expect(panes[2]!.parentElement).toBe(root);
    expect(panes[2]!.style.display).toBe("none");
  });
});

describe("ScreenLeases.release", () => {
  test("restores parent, order, inline style and layout signature", () => {
    const { root, slot, panes } = fixture();
    const leases = new ScreenLeases();
    const before = panes[1]!.style.cssText;

    leases.borrow("s1", panes[1]!, slot);
    // CHRONO owns the geometry while it holds the pane.
    panes[1]!.style.cssText =
      "position: relative; left: 0; top: 0; width: 100%; height: 100%; display: flex;";
    panes[1]!.dataset["layoutSig"] = "lane";

    leases.release("s1");

    expect(panes[1]!.parentElement).toBe(root);
    expect(Array.from(root.children)).toEqual(panes);
    expect(panes[1]!.style.cssText).toBe(before);
    expect(panes[1]!.dataset["layoutSig"]).toBe("100,0,100,50");
    expect(panes[1]!.dataset[LEASE_FLAG]).toBeUndefined();
    expect(leases.size).toBe(0);
  });

  test("a pane with no signature goes home with no signature", () => {
    const { root, slot, panes } = fixture();
    delete panes[0]!.dataset["layoutSig"];
    const leases = new ScreenLeases();

    leases.borrow("s0", panes[0]!, slot);
    panes[0]!.dataset["layoutSig"] = "lane";
    leases.release("s0");

    // A stale signature would make `applyPositions` skip the pane's
    // next layout because it believes the rect is already applied.
    expect(panes[0]!.dataset["layoutSig"]).toBeUndefined();
    expect(panes[0]!.parentElement).toBe(root);
  });

  test("is a no-op for an unknown surface and for a double release", () => {
    const { root, slot, panes } = fixture();
    const leases = new ScreenLeases();

    leases.release("never-borrowed");
    leases.borrow("s0", panes[0]!, slot);
    leases.release("s0");
    leases.release("s0");

    expect(panes[0]!.parentElement).toBe(root);
    expect(Array.from(root.children)).toEqual(panes);
    expect(leases.size).toBe(0);
  });

  test("drops a container whose surface closed while we held it", () => {
    const { root, slot, panes } = fixture();
    const leases = new ScreenLeases();

    leases.borrow("s1", panes[1]!, slot);
    // SurfaceManager.closeSurface → container.remove(), from under us.
    panes[1]!.remove();

    leases.release("s1");

    // Resurrecting a closed pane into the live layout is worse than
    // losing it: the terminal behind it is gone.
    expect(root.children.length).toBe(2);
    expect(panes[1]!.parentElement).toBeNull();
    expect(leases.size).toBe(0);
  });

  test("appends when the recorded sibling has since been removed", () => {
    const { root, slot, panes } = fixture();
    const leases = new ScreenLeases();

    leases.borrow("s0", panes[0]!, slot);
    // The neighbour it was recorded in front of closes while borrowed.
    panes[1]!.remove();

    leases.release("s0");

    // insertBefore would throw on a reference node that is no longer a
    // child; appending is where the pane would have ended up anyway.
    expect(panes[0]!.parentElement).toBe(root);
    expect(Array.from(root.children)).toEqual([panes[2]!, panes[0]!]);
  });

  test("releaseAll hands back every pane, in any order", () => {
    const { root, slot, panes } = fixture();
    const leases = new ScreenLeases();

    for (const [i, pane] of panes.entries()) leases.borrow(`s${i}`, pane, slot);
    expect(slot.children.length).toBe(3);

    leases.releaseAll();

    expect(leases.size).toBe(0);
    expect(slot.children.length).toBe(0);
    expect(new Set(Array.from(root.children))).toEqual(new Set(panes));
    for (const pane of panes) {
      expect(pane.dataset[LEASE_FLAG]).toBeUndefined();
    }
  });

  test("releaseAll survives a pane that was closed mid-flight", () => {
    const { root, slot, panes } = fixture();
    const leases = new ScreenLeases();

    for (const [i, pane] of panes.entries()) leases.borrow(`s${i}`, pane, slot);
    panes[1]!.remove();

    // A throw here would strand every pane queued behind the dead one.
    leases.releaseAll();

    expect(leases.size).toBe(0);
    expect(root.children.length).toBe(2);
    expect(panes[0]!.parentElement).toBe(root);
    expect(panes[2]!.parentElement).toBe(root);
  });
});
