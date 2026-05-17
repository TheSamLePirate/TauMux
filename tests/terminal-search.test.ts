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

import {
  TerminalSearchBar,
  type TerminalSearchHooks,
} from "../src/views/terminal/terminal-search";

type AddonStub = {
  findNext: ReturnType<typeof mock>;
  findPrevious: ReturnType<typeof mock>;
  clearDecorations: ReturnType<typeof mock>;
};

function mkAddon(): AddonStub {
  return {
    findNext: mock(() => {}),
    findPrevious: mock(() => {}),
    clearDecorations: mock(() => {}),
  };
}

let container: HTMLElement;
let addon: AddonStub;
let hooks: TerminalSearchHooks;
let bar: TerminalSearchBar;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  addon = mkAddon();
  hooks = {
    getActiveSearchAddon: () =>
      addon as unknown as Parameters<
        TerminalSearchHooks["getActiveSearchAddon"]
      >[0] extends never
        ? never
        : ReturnType<TerminalSearchHooks["getActiveSearchAddon"]>,
    onClose: mock(() => {}),
  };
  // Phase 7 — clear persisted toggles between tests so each starts
  // from defaults. The bar reads localStorage at construction time.
  try {
    localStorage.removeItem("hyperterm-canvas.search.toggles");
  } catch {
    /* private mode */
  }
  bar = new TerminalSearchBar(container, hooks);
});

afterEach(() => {
  document.body.innerHTML = "";
  try {
    localStorage.removeItem("hyperterm-canvas.search.toggles");
  } catch {
    /* private mode */
  }
});

describe("TerminalSearchBar", () => {
  test("starts hidden — no DOM built, visible flag false", () => {
    expect(bar.isVisible).toBe(false);
    expect(container.querySelector(".search-bar")).toBeNull();
  });

  test("show() builds the bar DOM and marks it visible", () => {
    bar.show();
    expect(bar.isVisible).toBe(true);
    const el = container.querySelector(".search-bar");
    expect(el).not.toBeNull();
    expect(el?.classList.contains("search-bar-visible")).toBe(true);
    expect(el?.querySelector(".search-bar-input")).not.toBeNull();
    // Phase 7 — five buttons: case toggle, regex toggle, prev, next, close.
    expect(el?.querySelectorAll("button").length).toBe(5);
  });

  test("calling show() a second time just refocuses the input — no re-mount", () => {
    bar.show();
    const firstEl = container.querySelector(".search-bar");
    bar.show();
    expect(container.querySelectorAll(".search-bar").length).toBe(1);
    expect(container.querySelector(".search-bar")).toBe(firstEl);
  });

  test("hide() clears decorations via the active addon and fires onClose", () => {
    bar.show();
    bar.hide();
    expect(bar.isVisible).toBe(false);
    expect(addon.clearDecorations).toHaveBeenCalledTimes(1);
    expect(hooks.onClose).toHaveBeenCalledTimes(1);
    const el = container.querySelector(".search-bar");
    expect(el?.classList.contains("search-bar-visible")).toBe(false);
  });

  test("hide() is a no-op when not visible — no addon calls, no onClose", () => {
    bar.hide();
    expect(addon.clearDecorations).not.toHaveBeenCalled();
    expect(hooks.onClose).not.toHaveBeenCalled();
  });

  test("toggle() flips visibility each call", () => {
    bar.toggle();
    expect(bar.isVisible).toBe(true);
    bar.toggle();
    expect(bar.isVisible).toBe(false);
    bar.toggle();
    expect(bar.isVisible).toBe(true);
  });

  test("next() / previous() delegate to the resolver's current addon", () => {
    bar.show();
    const input =
      container.querySelector<HTMLInputElement>(".search-bar-input")!;
    input.value = "needle";
    bar.next();
    // Phase 7 — findNext now also receives an ISearchOptions arg
    // carrying the persisted case/regex toggles.
    expect(addon.findNext).toHaveBeenCalledWith("needle", {
      caseSensitive: false,
      regex: false,
    });
    bar.previous();
    expect(addon.findPrevious).toHaveBeenCalledWith("needle", {
      caseSensitive: false,
      regex: false,
    });
  });

  test("empty query short-circuits — no addon call", () => {
    bar.show();
    bar.next();
    bar.previous();
    expect(addon.findNext).not.toHaveBeenCalled();
    expect(addon.findPrevious).not.toHaveBeenCalled();
  });

  test("next/previous always ask the resolver for the addon — so focus changes are reflected", () => {
    const resolver = mock(() => addon);
    const freshHooks: TerminalSearchHooks = {
      getActiveSearchAddon:
        resolver as unknown as TerminalSearchHooks["getActiveSearchAddon"],
    };
    const b = new TerminalSearchBar(container, freshHooks);
    b.show();
    const input =
      container.querySelector<HTMLInputElement>(".search-bar-input")!;
    input.value = "q";
    b.next();
    b.next();
    b.previous();
    // Resolver called per search invocation + once on hide(), but only
    // the three searches count here since we haven't hidden.
    expect(resolver).toHaveBeenCalledTimes(3);
  });

  test("next() / previous() tolerate a null addon (no focused terminal)", () => {
    const b = new TerminalSearchBar(container, {
      getActiveSearchAddon: () => null,
    });
    b.show();
    const input =
      container.querySelector<HTMLInputElement>(".search-bar-input")!;
    input.value = "q";
    expect(() => b.next()).not.toThrow();
    expect(() => b.previous()).not.toThrow();
  });

  test("prev/next/close buttons dispatch the corresponding actions", () => {
    bar.show();
    // Phase 7 — the bar gained two leading toggle buttons (case + regex)
    // before prev/next/close. Select by their specific classes to stay
    // robust against future button additions.
    const prev = container.querySelector<HTMLButtonElement>(
      ".search-bar-btn:not(.search-bar-toggle):not(.search-bar-close)",
    )!;
    const allBtns = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".search-bar-btn:not(.search-bar-toggle)",
      ),
    ];
    const next = allBtns[1];
    const close =
      container.querySelector<HTMLButtonElement>(".search-bar-close")!;
    const input =
      container.querySelector<HTMLInputElement>(".search-bar-input")!;
    input.value = "hit";
    prev.click();
    expect(addon.findPrevious).toHaveBeenCalledTimes(1);
    next.click();
    expect(addon.findNext).toHaveBeenCalledTimes(1);
    close.click();
    expect(bar.isVisible).toBe(false);
  });

  test("Enter searches next, Shift+Enter searches previous, Escape hides", () => {
    bar.show();
    const input =
      container.querySelector<HTMLInputElement>(".search-bar-input")!;
    input.value = "k";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(addon.findNext).toHaveBeenCalledTimes(1);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }),
    );
    expect(addon.findPrevious).toHaveBeenCalledTimes(1);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(bar.isVisible).toBe(false);
  });

  test("typing (input event) triggers an incremental next-search", () => {
    bar.show();
    const input =
      container.querySelector<HTMLInputElement>(".search-bar-input")!;
    input.value = "abc";
    input.dispatchEvent(new Event("input"));
    // Phase 7 — findNext now takes an ISearchOptions arg.
    expect(addon.findNext).toHaveBeenCalledWith("abc", {
      caseSensitive: false,
      regex: false,
    });
  });

  test("show() resets input value to empty even if user left text from a prior open", () => {
    bar.show();
    const input =
      container.querySelector<HTMLInputElement>(".search-bar-input")!;
    input.value = "leftover";
    bar.hide();
    bar.show();
    expect(
      container.querySelector<HTMLInputElement>(".search-bar-input")!.value,
    ).toBe("");
  });

  // ────────────────────────────────────────────────────────────────
  // Phase 7 — case + regex toggle buttons + localStorage persistence
  // ────────────────────────────────────────────────────────────────

  test("toggles default to off; case + regex buttons render with aria-pressed=false", () => {
    bar.show();
    const caseBtn =
      container.querySelector<HTMLButtonElement>(".search-bar-toggle");
    expect(caseBtn).not.toBeNull();
    expect(caseBtn!.getAttribute("aria-pressed")).toBe("false");
    expect(caseBtn!.classList.contains("search-bar-toggle-active")).toBe(false);
    expect(bar.getOptions()).toEqual({
      caseSensitive: false,
      regex: false,
    });
  });

  test("clicking the case toggle flips state, persists, and re-runs the search", () => {
    bar.show();
    const input =
      container.querySelector<HTMLInputElement>(".search-bar-input")!;
    input.value = "hello";
    const [caseBtn] = [
      ...container.querySelectorAll<HTMLButtonElement>(".search-bar-toggle"),
    ];
    caseBtn.click();
    expect(bar.getOptions().caseSensitive).toBe(true);
    expect(caseBtn.getAttribute("aria-pressed")).toBe("true");
    expect(caseBtn.classList.contains("search-bar-toggle-active")).toBe(true);
    // Re-runs the search with the new options.
    expect(addon.findNext).toHaveBeenLastCalledWith("hello", {
      caseSensitive: true,
      regex: false,
    });
  });

  test("toggle state persists across bar instances via localStorage", () => {
    bar.show();
    const [caseBtn, regexBtn] = [
      ...container.querySelectorAll<HTMLButtonElement>(".search-bar-toggle"),
    ];
    caseBtn.click();
    regexBtn.click();
    expect(bar.getOptions()).toEqual({ caseSensitive: true, regex: true });

    // Tear down and recreate — same hooks, fresh DOM.
    bar.hide();
    container.innerHTML = "";
    const fresh = new TerminalSearchBar(container, hooks);
    expect(fresh.getOptions()).toEqual({
      caseSensitive: true,
      regex: true,
    });
    fresh.show();
    const freshCaseBtn =
      container.querySelector<HTMLButtonElement>(".search-bar-toggle")!;
    expect(freshCaseBtn.getAttribute("aria-pressed")).toBe("true");

    // Reset for the next test.
    freshCaseBtn.click();
    const allToggles = [
      ...container.querySelectorAll<HTMLButtonElement>(".search-bar-toggle"),
    ];
    allToggles[1].click();
  });
});
