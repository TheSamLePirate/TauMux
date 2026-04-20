import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function loadFocusHelper() {
  return await import("../src/shared/xterm-focus");
}

beforeEach(() => {
  document.body.innerHTML = "";
  (globalThis as typeof globalThis & { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof requestAnimationFrame;
});

describe("focusXtermPreservingScroll", () => {
  test("focuses the helper textarea and restores terminal/document scroll", async () => {
    const { focusXtermPreservingScroll } = await loadFocusHelper();
    const scroller = document.createElement("div");
    Object.defineProperty(document, "scrollingElement", {
      configurable: true,
      value: scroller,
    });
    scroller.scrollLeft = 12;
    scroller.scrollTop = 34;

    const host = document.createElement("div");
    const viewport = document.createElement("div");
    viewport.className = "xterm-viewport";
    viewport.scrollLeft = 56;
    viewport.scrollTop = 78;
    const helper = document.createElement("textarea");
    helper.className = "xterm-helper-textarea";
    let focusCalls = 0;
    helper.focus = ((opts?: FocusOptions) => {
      focusCalls++;
      expect(opts).toEqual({ preventScroll: true });
      scroller.scrollLeft = 0;
      scroller.scrollTop = 0;
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }) as typeof helper.focus;
    host.appendChild(viewport);
    host.appendChild(helper);

    let termFocuses = 0;
    focusXtermPreservingScroll({ focus: () => termFocuses++ }, host);

    expect(focusCalls).toBe(1);
    expect(termFocuses).toBe(0);
    expect(scroller.scrollLeft).toBe(12);
    expect(scroller.scrollTop).toBe(34);
    expect(viewport.scrollLeft).toBe(56);
    expect(viewport.scrollTop).toBe(78);
  });

  test("falls back to term.focus when no helper textarea is present", async () => {
    const { focusXtermPreservingScroll } = await loadFocusHelper();
    const host = document.createElement("div");
    let termFocuses = 0;

    focusXtermPreservingScroll({ focus: () => termFocuses++ }, host);

    expect(termFocuses).toBe(1);
  });
});
