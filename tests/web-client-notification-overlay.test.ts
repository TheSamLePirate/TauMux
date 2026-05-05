import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

import { createStore, initialState } from "../src/web-client/store";
import type { AppState } from "../src/web-client/store";
import { createNotificationOverlayBridge } from "../src/web-client/notification-overlay-bridge";
import {
  pickWebSettings,
  DEFAULT_SETTINGS,
  mergeSettings,
} from "../src/shared/settings";

interface SetupResult {
  store: ReturnType<typeof createStore>;
  sendMsg: ReturnType<typeof mock>;
  bridge: ReturnType<typeof createNotificationOverlayBridge>;
  surfaces: Record<string, HTMLElement>;
}

function setup(seedSettings: Partial<AppState["settings"]> = {}): SetupResult {
  document.body.innerHTML = "";
  const surfaces: Record<string, HTMLElement> = {};
  const seed: AppState = {
    ...initialState(),
    settings: { ...pickWebSettings(DEFAULT_SETTINGS), ...seedSettings },
  };
  const store = createStore(seed);
  const sendMsg = mock(() => {});
  const bridge = createNotificationOverlayBridge({
    store,
    sendMsg,
    getSurfaceContainer: (id) => surfaces[id] ?? null,
  });
  return { store, sendMsg, bridge, surfaces };
}

function makeSurfaceContainer(id: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "pane";
  el.setAttribute("data-surface", id);
  document.body.appendChild(el);
  return el;
}

describe("web-client notification overlay bridge", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("notification with surfaceId mounts a card inside the pane container", () => {
    const { store, surfaces } = setup();
    surfaces["s1"] = makeSurfaceContainer("s1");
    store.dispatch({
      kind: "notification/add",
      entry: {
        id: "n1",
        title: "build done",
        body: "ok",
        surfaceId: "s1",
        at: 0,
      },
    });
    const card = surfaces["s1"]!.querySelector(".tau-notif-overlay-card");
    expect(card).not.toBeNull();
    expect(card?.querySelector(".tau-notif-overlay-title")?.textContent).toBe(
      "build done",
    );
    // Card is anchored inside the pane (not the document root) so
    // the layout transform pipeline moves it with its surface.
    expect(card?.parentElement?.className).toBe("tau-notif-overlay-stack");
    expect(card?.closest(".pane")).toBe(surfaces["s1"]!);
  });

  test("notification arriving before the surface mounts is queued and replayed", () => {
    const { store, surfaces, bridge } = setup();
    store.dispatch({
      kind: "notification/add",
      entry: { id: "n1", title: "early", body: "", surfaceId: "s1", at: 0 },
    });
    // No surface yet — nothing in the DOM.
    expect(document.querySelectorAll(".tau-notif-overlay-card").length).toBe(0);
    surfaces["s1"] = makeSurfaceContainer("s1");
    bridge.flushQueueForSurface("s1");
    expect(
      surfaces["s1"]!.querySelector(".tau-notif-overlay-card"),
    ).not.toBeNull();
  });

  test("clicking the close button dismisses + sends dismissNotification", () => {
    const { store, sendMsg, surfaces } = setup();
    surfaces["s1"] = makeSurfaceContainer("s1");
    store.dispatch({
      kind: "notification/add",
      entry: { id: "n1", title: "x", body: "", surfaceId: "s1", at: 0 },
    });
    const close = surfaces["s1"]!.querySelector<HTMLElement>(
      ".tau-notif-overlay-close",
    );
    expect(close).not.toBeNull();
    close!.click();
    expect(surfaces["s1"]!.querySelector(".tau-notif-overlay-card")).toBeNull();
    // Optimistic local state is also gone so a snapshot replay
    // doesn't re-mount the same card.
    expect(store.getState().sidebar.notifications.length).toBe(0);
    expect(sendMsg).toHaveBeenCalledWith("dismissNotification", { id: "n1" });
  });

  test("clicking the body activates: dismisses + focuses + sends both envelopes", () => {
    const { store, sendMsg, surfaces } = setup();
    surfaces["s1"] = makeSurfaceContainer("s1");
    store.dispatch({
      kind: "notification/add",
      entry: { id: "n1", title: "x", body: "", surfaceId: "s1", at: 0 },
    });
    const card = surfaces["s1"]!.querySelector<HTMLElement>(
      ".tau-notif-overlay-card",
    );
    expect(card).not.toBeNull();
    card!.click();
    expect(surfaces["s1"]!.querySelector(".tau-notif-overlay-card")).toBeNull();
    expect(sendMsg).toHaveBeenCalledWith("dismissNotification", { id: "n1" });
    expect(sendMsg).toHaveBeenCalledWith("focusSurface", { surfaceId: "s1" });
  });

  test("disabling the overlay setting tears down all live cards", () => {
    const { store, surfaces } = setup();
    surfaces["s1"] = makeSurfaceContainer("s1");
    store.dispatch({
      kind: "notification/add",
      entry: { id: "n1", title: "x", body: "", surfaceId: "s1", at: 0 },
    });
    expect(
      surfaces["s1"]!.querySelector(".tau-notif-overlay-card"),
    ).not.toBeNull();
    // Flip the broadcast settings — bridge subscribes to settings
    // changes and tears down every overlay when enabled flips off.
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      notificationOverlayEnabled: false,
    });
    store.dispatch({
      kind: "settings/apply",
      settings: pickWebSettings(merged),
    });
    expect(surfaces["s1"]!.querySelector(".tau-notif-overlay-card")).toBeNull();
  });

  test("forgetSurface removes the per-surface stack DOM", () => {
    const { store, surfaces, bridge } = setup();
    surfaces["s1"] = makeSurfaceContainer("s1");
    store.dispatch({
      kind: "notification/add",
      entry: { id: "n1", title: "x", body: "", surfaceId: "s1", at: 0 },
    });
    expect(
      surfaces["s1"]!.querySelector(".tau-notif-overlay-stack"),
    ).not.toBeNull();
    bridge.forgetSurface("s1");
    expect(
      surfaces["s1"]!.querySelector(".tau-notif-overlay-stack"),
    ).toBeNull();
  });
});
