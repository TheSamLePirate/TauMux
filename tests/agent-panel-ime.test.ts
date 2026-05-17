// P7 S27 / Cluster B U15 — IME composition guards on the agent
// panel input.
//
// Without these guards, an IME-driven `/` in the romaji buffer
// (typing Japanese with kana → kanji conversion) would open the
// slash menu mid-composition, and a synthetic Enter to commit
// the composed text would send the half-typed message. We mirror
// the command-palette pattern: track composing via the
// `compositionstart` / `compositionend` events on the textarea
// + check `e.isComposing` on the keydown event.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => GlobalRegistrator.register());
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function load() {
  return await import("../src/views/terminal/agent-panel");
}

function callbacks() {
  return {
    onSendPrompt: () => {},
    onAbort: () => {},
    onSetModel: () => {},
    onSetThinking: () => {},
    onNewSession: () => {},
    onCompact: () => {},
    onClose: () => {},
    onSplit: () => {},
    onFocus: () => {},
    onGetModels: () => {},
    onGetState: () => {},
  };
}

describe("agent-panel — IME composition guards (P7 S27)", () => {
  test("composing flips on compositionstart and clears on compositionend", async () => {
    const a = await load();
    const view = a.createAgentPaneView("agent:1", "agent-1", callbacks());
    expect(view._state.composing).toBe(false);

    const inputEl = view._elements.inputEl;
    inputEl.dispatchEvent(new Event("compositionstart"));
    expect(view._state.composing).toBe(true);
    inputEl.dispatchEvent(new Event("compositionend"));
    expect(view._state.composing).toBe(false);
  });

  test("typing `/` during composition does NOT open the slash menu", async () => {
    const a = await load();
    const view = a.createAgentPaneView("agent:1", "agent-1", callbacks());

    const inputEl = view._elements.inputEl;
    inputEl.dispatchEvent(new Event("compositionstart"));
    expect(view._state.composing).toBe(true);

    // Romaji buffer transiently contains a `/`.
    inputEl.value = "/";
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    expect(view._state.showSlashMenu).toBe(false);

    // After composition commits, the next input does open the menu.
    inputEl.dispatchEvent(new Event("compositionend"));
    expect(view._state.composing).toBe(false);
    inputEl.value = "/help";
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    expect(view._state.showSlashMenu).toBe(true);
  });

  test("Enter while composing leaves the input value untouched (no send)", async () => {
    const a = await load();
    const view = a.createAgentPaneView("agent:1", "agent-1", callbacks());

    const inputEl = view._elements.inputEl;
    inputEl.value = "hello mid-compose";

    // Manually set composing on state so the guard fires regardless
    // of whether the synthetic event carries isComposing.
    view._state.composing = true;

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    inputEl.dispatchEvent(event);

    // The input still holds the half-composed value — the send
    // pathway would have cleared it.
    expect(inputEl.value).toBe("hello mid-compose");

    // Flip composing off; the next Enter sends the message (value
    // gets cleared by the prompt pathway).
    view._state.composing = false;
    const enter2 = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    inputEl.dispatchEvent(enter2);
    expect(inputEl.value).toBe("");
  });
});
