// Unit tests for BrowserSurfaceController — the browser concern extracted
// from SurfaceManager (full_app_review_2026-05.md §3 / H10). The extraction's
// payoff: this logic is now testable in isolation with injected deps, instead
// of requiring the whole SurfaceManager (and a DOM) to be stood up.

import { describe, test, expect, beforeEach, mock } from "bun:test";

// Capture calls to the browser-pane module functions.
const calls: { fn: string; args: unknown[] }[] = [];
function rec(fn: string) {
  return (...args: unknown[]) => calls.push({ fn, args });
}

mock.module("../src/views/terminal/browser-pane", () => ({
  createBrowserPaneView: (
    _id: string,
    _url: string,
    _cb: unknown,
    searchEngine: string,
    partition?: string,
  ) => {
    calls.push({
      fn: "createBrowserPaneView",
      args: [searchEngine, partition],
    });
    return { id: _id, container: {}, titleEl: {}, chipsEl: {}, title: "" };
  },
  browserPaneNavigateTo: rec("navigateTo"),
  browserPaneGoBack: rec("goBack"),
  browserPaneGoForward: rec("goForward"),
  browserPaneReload: rec("reload"),
  browserPaneEvalJs: rec("evalJs"),
  browserPaneFindInPage: rec("findInPage"),
  browserPaneStopFind: rec("stopFind"),
  browserPaneToggleDevTools: rec("toggleDevTools"),
  browserPaneFocusAddressBar: rec("focusAddressBar"),
  browserPaneSyncDimensions: rec("syncDimensions"),
  browserPaneSetHidden: rec("setHidden"),
  browserPaneApplyDarkMode: rec("applyDarkMode"),
  browserPaneInjectCookies: rec("injectCookies"),
  browserPaneGetCookies: rec("getCookies"),
  destroyBrowserPaneView: rec("destroy"),
}));

const { BrowserSurfaceController } =
  await import("../src/views/terminal/browser-surface-controller");

// Minimal SurfaceView-ish stub: only the fields the controller touches.
function makeSurface(id: string, hasBrowser: boolean) {
  return {
    id,
    browserView: hasBrowser ? ({ id, zoom: 1.0 } as never) : null,
    title: "",
    titleEl: { textContent: "" },
  };
}

describe("BrowserSurfaceController", () => {
  let surfaces: Map<string, ReturnType<typeof makeSurface>>;
  let focused: string | null;
  let ctrl: InstanceType<typeof BrowserSurfaceController>;

  beforeEach(() => {
    calls.length = 0;
    surfaces = new Map();
    focused = null;
    ctrl = new BrowserSurfaceController({
      getSurface: (id: string) => surfaces.get(id) as never,
      getFocusedSurfaceId: () => focused,
      allSurfaces: () => surfaces.values() as never,
      activeWorkspaceSurfaceIds: () => [...surfaces.keys()],
      focusSurface: () => {},
      updateSidebar: () => {},
    });
  });

  test("an action targeting a browser surface forwards to the pane fn", () => {
    surfaces.set("b1", makeSurface("b1", true));
    ctrl.navigateTo("b1", "https://example.com");
    expect(calls).toEqual([
      {
        fn: "navigateTo",
        args: [surfaces.get("b1")!.browserView, "https://example.com"],
      },
    ]);
  });

  test("withBrowserView is a no-op when the surface has no browser view", () => {
    surfaces.set("t1", makeSurface("t1", false)); // terminal, no browserView
    ctrl.reload("t1");
    ctrl.goBack("t1");
    expect(calls).toHaveLength(0);
  });

  test("focused-or-null actions resolve the focused surface", () => {
    surfaces.set("b1", makeSurface("b1", true));
    focused = "b1";
    ctrl.goBack(); // no arg → uses focused
    ctrl.focusAddressBar();
    expect(calls.map((c) => c.fn)).toEqual(["goBack", "focusAddressBar"]);
  });

  test("zoomIn clamps to 5.0 and writes zoom onto the view", () => {
    const s = makeSurface("b1", true);
    (s.browserView as { zoom: number }).zoom = 4.95;
    surfaces.set("b1", s);
    focused = "b1";
    ctrl.zoomIn();
    expect((s.browserView as { zoom: number }).zoom).toBeCloseTo(5.0, 5);
    ctrl.zoomIn(); // already at cap
    expect((s.browserView as { zoom: number }).zoom).toBeCloseTo(5.0, 5);
  });

  test("zoomOut floors at 0.25", () => {
    const s = makeSurface("b1", true);
    (s.browserView as { zoom: number }).zoom = 0.3;
    surfaces.set("b1", s);
    focused = "b1";
    ctrl.zoomOut();
    expect((s.browserView as { zoom: number }).zoom).toBeCloseTo(0.25, 5);
  });

  test("setSearchEngine flows into the next created view", () => {
    ctrl.setSearchEngine("duckduckgo" as never);
    ctrl.createBrowserView("b1", "https://x.com", "persist:p");
    const created = calls.find((c) => c.fn === "createBrowserPaneView");
    expect(created?.args).toEqual(["duckduckgo", "persist:p"]);
  });

  test("hideAllWebviews hides every browser pane; terminals are skipped", () => {
    surfaces.set("b1", makeSurface("b1", true));
    surfaces.set("t1", makeSurface("t1", false));
    surfaces.set("b2", makeSurface("b2", true));
    ctrl.hideAllWebviews();
    expect(calls.filter((c) => c.fn === "setHidden")).toHaveLength(2);
  });
});
