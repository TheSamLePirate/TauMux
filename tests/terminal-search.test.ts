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
  bar = new TerminalSearchBar(container, hooks);
});

afterEach(() => {
  document.body.innerHTML = "";
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
    // Three buttons: prev, next, close.
    expect(el?.querySelectorAll("button").length).toBe(3);
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
    expect(addon.findNext).toHaveBeenCalledWith("needle");
    bar.previous();
    expect(addon.findPrevious).toHaveBeenCalledWith("needle");
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
    const [prev, next, close] = [
      ...container.querySelectorAll<HTMLButtonElement>(".search-bar-btn"),
    ];
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
    expect(addon.findNext).toHaveBeenCalledWith("abc");
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
});
