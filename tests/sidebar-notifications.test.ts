import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Scope happy-dom to this file so parser-level tests that rely on a
// Node global environment are unaffected.
beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

// Load lazily so happy-dom globals exist when the module's top-level
// DOM code (icon slots) runs.
async function loadSidebar() {
  return await import("../src/views/terminal/sidebar");
}

type NotificationSeed = {
  id: string;
  title?: string;
  body?: string;
  time?: number;
  surfaceId?: string | null;
};

async function makeSidebar() {
  document.body.innerHTML = `<div id="sidebar-test"></div>`;
  const container = document.getElementById("sidebar-test") as HTMLElement;
  const { Sidebar } = await loadSidebar();
  const sidebar = new Sidebar(container, {
    onSelectWorkspace: () => {},
    onNewWorkspace: () => {},
    onCloseWorkspace: () => {},
  });
  return { sidebar, container };
}

function seed(n: NotificationSeed) {
  return {
    id: n.id,
    title: n.title ?? n.id,
    body: n.body ?? "",
    time: n.time ?? 0,
    surfaceId: n.surfaceId,
  };
}

describe("Sidebar notifications — glow lifecycle", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("new notifications start with the .glow class", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setNotifications([seed({ id: "n1", surfaceId: "surface:1" })]);

    const items = container.querySelectorAll(".notification-item");
    expect(items.length).toBe(1);
    expect(items[0].classList.contains("glow")).toBe(true);
  });

  test("acknowledgeBySurface removes glow on matching notifications only", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setNotifications([
      seed({ id: "n1", surfaceId: "surface:1" }),
      seed({ id: "n2", surfaceId: "surface:2" }),
      seed({ id: "n3", surfaceId: "surface:1" }),
    ]);

    sidebar.acknowledgeBySurface("surface:1");

    const byId: Record<string, Element> = {};
    for (const el of container.querySelectorAll(".notification-item")) {
      const title = el.querySelector(".notification-title")?.textContent ?? "";
      byId[title] = el;
    }
    expect(byId["n1"]!.classList.contains("glow")).toBe(false);
    expect(byId["n2"]!.classList.contains("glow")).toBe(true);
    expect(byId["n3"]!.classList.contains("glow")).toBe(false);
  });

  test("notifications without a surfaceId never match acknowledgeBySurface", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setNotifications([seed({ id: "n1" })]); // no surface

    sidebar.acknowledgeBySurface("surface:1");

    expect(
      container.querySelector(".notification-item")?.classList.contains("glow"),
    ).toBe(true);
  });

  test("re-applying the same notification list preserves acknowledged state", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setNotifications([seed({ id: "n1", surfaceId: "surface:1" })]);
    sidebar.acknowledgeBySurface("surface:1");

    // Simulate a rebroadcast of the same list (happens on dismiss-of-
    // another-notification or on reconnect snapshots).
    sidebar.setNotifications([seed({ id: "n1", surfaceId: "surface:1" })]);

    expect(
      container.querySelector(".notification-item")?.classList.contains("glow"),
    ).toBe(false);
  });

  test("acknowledged ids for dropped notifications are pruned", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setNotifications([seed({ id: "n1", surfaceId: "surface:1" })]);
    sidebar.acknowledgeBySurface("surface:1");

    // Dismiss the only notification; the ack set should drop n1 so a
    // future notification that happens to reuse id "n1" still glows.
    sidebar.setNotifications([]);
    sidebar.setNotifications([seed({ id: "n1", surfaceId: "surface:1" })]);

    expect(
      container.querySelector(".notification-item")?.classList.contains("glow"),
    ).toBe(true);
  });

  test("dismiss button dispatches ht-dismiss-notification with the id", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setNotifications([seed({ id: "n42", surfaceId: "surface:1" })]);

    const events: string[] = [];
    const listener = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id?: string };
      if (detail?.id) events.push(detail.id);
    };
    window.addEventListener("ht-dismiss-notification", listener);

    const btn = container.querySelector(
      ".notification-dismiss",
    ) as HTMLButtonElement;
    btn.click();

    window.removeEventListener("ht-dismiss-notification", listener);
    expect(events).toEqual(["n42"]);
  });

  test("click on body dispatches ht-focus-notification-source and clears glow", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setNotifications([seed({ id: "n7", surfaceId: "surface:9" })]);

    const events: { notificationId?: string; surfaceId?: string | null }[] = [];
    const listener = (e: Event) => {
      events.push((e as CustomEvent).detail);
    };
    window.addEventListener("ht-focus-notification-source", listener);

    const body = container.querySelector(
      ".notification-body-btn",
    ) as HTMLButtonElement;
    body.click();

    window.removeEventListener("ht-focus-notification-source", listener);
    expect(events).toEqual([{ notificationId: "n7", surfaceId: "surface:9" }]);

    // Glow is cleared immediately on click, before any rerender from
    // the server.
    expect(
      container.querySelector(".notification-item")?.classList.contains("glow"),
    ).toBe(false);
  });

  test("click on body for source-less notification does not dispatch focus", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setNotifications([seed({ id: "n1" })]); // no surface

    const events: unknown[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener("ht-focus-notification-source", listener);

    (
      container.querySelector(".notification-body-btn") as HTMLButtonElement
    ).click();

    window.removeEventListener("ht-focus-notification-source", listener);
    expect(events).toEqual([]);
  });
});

describe("Sidebar notifications — incremental DOM updates", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("existing notification elements are reused across rerenders", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setNotifications([seed({ id: "a", surfaceId: "surface:1" })]);
    const firstA = container.querySelector(".notification-item") as HTMLElement;
    expect(firstA).not.toBeNull();

    // A second notification arrives; the existing one must be the
    // SAME DOM node — not a rebuild — so its CSS glow animation keeps
    // running from whatever frame it was on.
    sidebar.setNotifications([
      seed({ id: "a", surfaceId: "surface:1" }),
      seed({ id: "b", surfaceId: "surface:2" }),
    ]);
    const items = container.querySelectorAll(".notification-item");
    expect(items.length).toBe(2);

    // The newest is at the top; `a` moves to index 1 but is the same
    // element reference.
    const nodeA = Array.from(items).find(
      (el) => el.querySelector(".notification-title")?.textContent === "a",
    );
    expect(nodeA).toBe(firstA);
  });

  test("dismissed notifications remove their element without touching siblings", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setNotifications([
      seed({ id: "a", surfaceId: "s1" }),
      seed({ id: "b", surfaceId: "s2" }),
      seed({ id: "c", surfaceId: "s3" }),
    ]);
    const before = Array.from(container.querySelectorAll(".notification-item"));
    const nodeA = before.find(
      (el) => el.querySelector(".notification-title")?.textContent === "a",
    );
    const nodeC = before.find(
      (el) => el.querySelector(".notification-title")?.textContent === "c",
    );

    // Server dismissed `b` → we receive the reduced list.
    sidebar.setNotifications([
      seed({ id: "a", surfaceId: "s1" }),
      seed({ id: "c", surfaceId: "s3" }),
    ]);

    const after = Array.from(container.querySelectorAll(".notification-item"));
    expect(after.length).toBe(2);
    // a and c are the same nodes as before — only b was evicted.
    expect(after).toContain(nodeA as Element);
    expect(after).toContain(nodeC as Element);
  });

  test("header count updates in place without rebuilding the header", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setNotifications([seed({ id: "a" })]);
    const headerBefore = container.querySelector(".sidebar-section-header");
    expect(headerBefore?.textContent).toContain("Notifications (1)");

    sidebar.setNotifications([seed({ id: "a" }), seed({ id: "b" })]);
    const headerAfter = container.querySelector(".sidebar-section-header");
    // Same node, updated text.
    expect(headerAfter).toBe(headerBefore);
    expect(headerAfter?.textContent).toContain("Notifications (2)");
  });

  test("clearing to empty tears the shell down and rebuilds on next add", async () => {
    const { sidebar, container } = await makeSidebar();
    sidebar.setNotifications([seed({ id: "a" })]);
    sidebar.setNotifications([]);
    expect(container.querySelector(".sidebar-section-header")).toBeNull();

    sidebar.setNotifications([seed({ id: "b" })]);
    expect(container.querySelector(".sidebar-section-header")).not.toBeNull();
    expect(container.querySelectorAll(".notification-item").length).toBe(1);
  });
});
