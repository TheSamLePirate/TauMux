// Tests for the web mirror's dictation / mobile-keyboard input shim.
//
// These simulate the three problematic flows reported from iOS:
//   1. Apple Dictation: cumulative `compositionend` commits.
//   2. SuperWhisper / WhisperFlow: bare `beforeinput`/`insertText`
//      bursts with no composition.
//   3. IME (Pinyin / Kana style): a real composition cycle.
// And exercise the editing intents (Backspace / Enter / word-delete)
// that iOS keyboards emit via `beforeinput` instead of `keydown`.

import {
  afterAll,
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

async function loadModule() {
  return await import("../src/web-client/dictation-input");
}

function makeTextarea(): HTMLTextAreaElement {
  const ta = document.createElement("textarea");
  document.body.appendChild(ta);
  return ta;
}

// happy-dom's InputEvent constructor accepts `inputType` and `data`.
function fireBeforeInput(
  ta: HTMLTextAreaElement,
  inputType: string,
  data: string | null = null,
): InputEvent {
  const ev = new (
    globalThis as unknown as { InputEvent: typeof InputEvent }
  ).InputEvent("beforeinput", {
    inputType,
    data,
    bubbles: true,
    cancelable: true,
  });
  ta.dispatchEvent(ev);
  return ev;
}

function fireComposition(
  ta: HTMLTextAreaElement,
  type: "compositionstart" | "compositionupdate" | "compositionend",
  data = "",
): Event {
  // happy-dom aliases CompositionEvent to plain Event and drops the
  // init dict, so attach `data` manually on a real Event — mirrors how
  // tests/web-client-panel-interaction.test.ts handles WheelEvent.
  const ev = new Event(type, { bubbles: true });
  Object.assign(ev, { data });
  ta.dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("attachDictationInput — attribute hardening", () => {
  test("sets autocapitalize/autocorrect/autocomplete/spellcheck/inputmode/enterkeyhint off", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    attachDictationInput({ textarea: ta, onData: () => {} });
    expect(ta.getAttribute("autocapitalize")).toBe("off");
    expect(ta.getAttribute("autocorrect")).toBe("off");
    expect(ta.getAttribute("autocomplete")).toBe("off");
    expect(ta.getAttribute("spellcheck")).toBe("false");
    expect(ta.getAttribute("inputmode")).toBe("text");
    expect(ta.getAttribute("enterkeyhint")).toBe("send");
  });
});

describe("attachDictationInput — beforeinput bursts (SuperWhisper-style)", () => {
  test("each insertText call is forwarded as its own delta", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const onData = mock((_d: string) => {});
    attachDictationInput({ textarea: ta, onData });

    fireBeforeInput(ta, "insertText", "M");
    fireBeforeInput(ta, "insertText", "ake");
    fireBeforeInput(ta, "insertText", " sure");

    const sent = onData.mock.calls.map((c) => c[0]);
    expect(sent).toEqual(["M", "ake", " sure"]);
  });

  test("beforeinput is preventDefault'd and propagation stopped", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    attachDictationInput({ textarea: ta, onData: () => {} });
    const bubbled = mock(() => {});
    ta.addEventListener("beforeinput", bubbled);

    const ev = fireBeforeInput(ta, "insertText", "x");
    expect(ev.defaultPrevented).toBe(true);
    // stopImmediatePropagation from capture should keep the bubble-phase
    // listener from firing (xterm's own listener lives at bubble).
    expect(bubbled).toHaveBeenCalledTimes(0);
  });

  test("editing intents map to terminal control bytes", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const onData = mock((_d: string) => {});
    attachDictationInput({ textarea: ta, onData });

    fireBeforeInput(ta, "insertLineBreak");
    fireBeforeInput(ta, "deleteContentBackward");
    fireBeforeInput(ta, "deleteWordBackward");
    fireBeforeInput(ta, "deleteSoftLineBackward");
    fireBeforeInput(ta, "deleteContentForward");

    expect(onData.mock.calls.map((c) => c[0])).toEqual([
      "\r",
      "\x7f",
      "\x17",
      "\x15",
      "\x1b[3~",
    ]);
  });

  test("rich-text intents are silently dropped, not echoed", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const onData = mock((_d: string) => {});
    attachDictationInput({ textarea: ta, onData });

    fireBeforeInput(ta, "formatBold");
    fireBeforeInput(ta, "historyUndo");

    expect(onData).toHaveBeenCalledTimes(0);
  });

  test("unknown inputType falls through (lets xterm's bubble handler try)", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    attachDictationInput({ textarea: ta, onData: () => {} });
    const bubbled = mock(() => {});
    ta.addEventListener("beforeinput", bubbled);

    fireBeforeInput(ta, "insertFromYourMom" as string, "hi");
    expect(bubbled).toHaveBeenCalledTimes(1);
  });
});

describe("attachDictationInput — Apple Dictation cumulative commits", () => {
  test("successive compositionend events send only the new tail", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const onData = mock((_d: string) => {});
    attachDictationInput({ textarea: ta, onData });

    fireComposition(ta, "compositionstart", "");
    fireComposition(ta, "compositionend", "Make");
    fireComposition(ta, "compositionstart", "");
    fireComposition(ta, "compositionend", "Make sure");
    fireComposition(ta, "compositionstart", "");
    fireComposition(ta, "compositionend", "Make sure the doc");
    fireComposition(ta, "compositionstart", "");
    fireComposition(ta, "compositionend", "Make sure the docs are updated");

    const joined = onData.mock.calls.map((c) => c[0]).join("");
    expect(joined).toBe("Make sure the docs are updated");
  });

  test("composition commits without shared prefix are sent verbatim", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const onData = mock((_d: string) => {});
    attachDictationInput({ textarea: ta, onData });

    fireComposition(ta, "compositionstart");
    fireComposition(ta, "compositionend", "Make");
    fireComposition(ta, "compositionstart");
    fireComposition(ta, "compositionend", "Take"); // autocorrect rewrote it

    expect(onData.mock.calls.map((c) => c[0])).toEqual(["Make", "Take"]);
  });

  test("compositionupdate is suppressed (no partial echoes)", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const onData = mock((_d: string) => {});
    attachDictationInput({ textarea: ta, onData });

    fireComposition(ta, "compositionstart");
    fireComposition(ta, "compositionupdate", "Mak");
    fireComposition(ta, "compositionupdate", "Make");
    expect(onData).toHaveBeenCalledTimes(0);
    fireComposition(ta, "compositionend", "Make");
    expect(onData.mock.calls.map((c) => c[0])).toEqual(["Make"]);
  });
});

describe("attachDictationInput — pre-composition boundary (Ok→OOk fix)", () => {
  test("insertText then cumulative compositionend doesn't double-send the first letter", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const onData = mock((_d: string) => {});
    attachDictationInput({ textarea: ta, onData });

    // iOS Dictation: commits the first letter eagerly via insertText,
    // then fires a cumulative compositionend with the full transcript.
    fireBeforeInput(ta, "insertText", "O");
    fireComposition(ta, "compositionstart");
    fireComposition(ta, "compositionend", "Ok, it works");

    expect(onData.mock.calls.map((c) => c[0]).join("")).toBe("Ok, it works");
  });

  test("multi-char prefix from beforeinput is honored on compositionend", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const onData = mock((_d: string) => {});
    attachDictationInput({ textarea: ta, onData });

    fireBeforeInput(ta, "insertText", "He");
    fireBeforeInput(ta, "insertText", "ll");
    fireComposition(ta, "compositionstart");
    fireComposition(ta, "compositionend", "Hello world");

    expect(onData.mock.calls.map((c) => c[0]).join("")).toBe("Hello world");
  });

  test("backspace shrinks the prefix tracker so the next composition diffs correctly", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const onData = mock((_d: string) => {});
    attachDictationInput({ textarea: ta, onData });

    fireBeforeInput(ta, "insertText", "Hello");
    fireBeforeInput(ta, "deleteContentBackward"); // "Hell"
    fireComposition(ta, "compositionstart");
    fireComposition(ta, "compositionend", "Hell world");

    expect(onData.mock.calls.map((c) => c[0])).toEqual([
      "Hello",
      "\x7f",
      " world",
    ]);
  });

  test("Enter resets the prefix tracker so a fresh utterance isn't diffed against the previous line", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const onData = mock((_d: string) => {});
    attachDictationInput({ textarea: ta, onData });

    fireBeforeInput(ta, "insertText", "Hello");
    fireBeforeInput(ta, "insertLineBreak");
    fireComposition(ta, "compositionstart");
    fireComposition(ta, "compositionend", "Hello again");

    expect(onData.mock.calls.map((c) => c[0])).toEqual([
      "Hello",
      "\r",
      "Hello again",
    ]);
  });
});

describe("attachDictationInput — xterm hand-off via customKeyEventHandler", () => {
  function makeFakeTerm() {
    let handler: ((e: KeyboardEvent) => boolean) | null = null;
    return {
      attachCustomKeyEventHandler: (h: (e: KeyboardEvent) => boolean) => {
        handler = h;
      },
      ask: (e: KeyboardEvent) => handler?.(e) ?? true,
    };
  }

  test("printable keys are NOT handled by xterm (shim owns text input)", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const term = makeFakeTerm();
    attachDictationInput({ textarea: ta, term, onData: () => {} });

    expect(term.ask(new KeyboardEvent("keydown", { key: "a" }))).toBe(false);
    expect(term.ask(new KeyboardEvent("keydown", { key: "Z" }))).toBe(false);
    expect(term.ask(new KeyboardEvent("keydown", { key: "5" }))).toBe(false);
    expect(term.ask(new KeyboardEvent("keydown", { key: " " }))).toBe(false);
    // Enter / Tab / Backspace / Delete also flow through our beforeinput.
    expect(term.ask(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(
      false,
    );
    expect(term.ask(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(false);
    expect(term.ask(new KeyboardEvent("keydown", { key: "Backspace" }))).toBe(
      false,
    );
    expect(term.ask(new KeyboardEvent("keydown", { key: "Delete" }))).toBe(
      false,
    );
    // iOS dictation placeholder keys.
    expect(term.ask(new KeyboardEvent("keydown", { key: "Process" }))).toBe(
      false,
    );
    expect(
      term.ask(new KeyboardEvent("keydown", { key: "Unidentified" })),
    ).toBe(false);
  });

  test("navigation, function and modifier-shortcut keys ARE handled by xterm", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const term = makeFakeTerm();
    attachDictationInput({ textarea: ta, term, onData: () => {} });

    expect(term.ask(new KeyboardEvent("keydown", { key: "Escape" }))).toBe(
      true,
    );
    expect(term.ask(new KeyboardEvent("keydown", { key: "ArrowUp" }))).toBe(
      true,
    );
    expect(term.ask(new KeyboardEvent("keydown", { key: "ArrowDown" }))).toBe(
      true,
    );
    expect(term.ask(new KeyboardEvent("keydown", { key: "Home" }))).toBe(true);
    expect(term.ask(new KeyboardEvent("keydown", { key: "End" }))).toBe(true);
    expect(term.ask(new KeyboardEvent("keydown", { key: "PageUp" }))).toBe(
      true,
    );
    expect(term.ask(new KeyboardEvent("keydown", { key: "F1" }))).toBe(true);
    expect(term.ask(new KeyboardEvent("keydown", { key: "F12" }))).toBe(true);
    // Modifier shortcuts (Ctrl-C, Cmd-K, Alt-b) → xterm sends the
    // appropriate control byte / escape sequence.
    expect(
      term.ask(new KeyboardEvent("keydown", { key: "c", ctrlKey: true })),
    ).toBe(true);
    expect(
      term.ask(new KeyboardEvent("keydown", { key: "k", metaKey: true })),
    ).toBe(true);
    expect(
      term.ask(new KeyboardEvent("keydown", { key: "b", altKey: true })),
    ).toBe(true);
  });

  test("input events on the textarea are swallowed so xterm._inputEvent never fires", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    attachDictationInput({ textarea: ta, onData: () => {} });
    const xtermBubble = mock(() => {});
    ta.addEventListener("input", xtermBubble);
    const ev = new (
      globalThis as unknown as { InputEvent: typeof InputEvent }
    ).InputEvent("input", {
      inputType: "insertText",
      data: "x",
      bubbles: true,
    });
    ta.dispatchEvent(ev);
    expect(xtermBubble).toHaveBeenCalledTimes(0);
  });

  test("dispose neutralises the customKeyEventHandler (reverts to passthrough)", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const term = makeFakeTerm();
    const handle = attachDictationInput({
      textarea: ta,
      term,
      onData: () => {},
    });
    expect(term.ask(new KeyboardEvent("keydown", { key: "a" }))).toBe(false);
    handle.dispose();
    expect(term.ask(new KeyboardEvent("keydown", { key: "a" }))).toBe(true);
  });
});

describe("attachDictationInput — IME and mixed flows", () => {
  test("insertCompositionText beforeinput is ignored — compositionend drives output", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const onData = mock((_d: string) => {});
    attachDictationInput({ textarea: ta, onData });

    fireComposition(ta, "compositionstart");
    fireBeforeInput(ta, "insertCompositionText", "你");
    fireBeforeInput(ta, "insertCompositionText", "你好");
    fireComposition(ta, "compositionend", "你好");

    expect(onData.mock.calls.map((c) => c[0])).toEqual(["你好"]);
  });

  test("blur resets the cumulative prefix tracker", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const onData = mock((_d: string) => {});
    attachDictationInput({ textarea: ta, onData });

    fireComposition(ta, "compositionstart");
    fireComposition(ta, "compositionend", "Make sure");
    ta.dispatchEvent(new Event("blur", { bubbles: false }));
    fireComposition(ta, "compositionstart");
    fireComposition(ta, "compositionend", "Make sure");

    // Without blur reset the second commit would diff to "" — with reset
    // it sends the full string twice.
    expect(onData.mock.calls.map((c) => c[0])).toEqual([
      "Make sure",
      "Make sure",
    ]);
  });
});

describe("attachDictationInput — lifecycle", () => {
  test("dispose detaches all listeners", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    const onData = mock((_d: string) => {});
    const handle = attachDictationInput({ textarea: ta, onData });
    handle.dispose();

    fireBeforeInput(ta, "insertText", "x");
    fireComposition(ta, "compositionstart");
    fireComposition(ta, "compositionend", "Make");

    expect(onData).toHaveBeenCalledTimes(0);
  });

  test("textarea is drained after a forwarded event", async () => {
    const { attachDictationInput } = await loadModule();
    const ta = makeTextarea();
    attachDictationInput({ textarea: ta, onData: () => {} });

    ta.value = "stale";
    fireBeforeInput(ta, "insertText", "y");
    // The drain runs in a microtask.
    await Promise.resolve();
    expect(ta.value).toBe("");
  });
});
