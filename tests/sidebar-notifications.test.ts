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
