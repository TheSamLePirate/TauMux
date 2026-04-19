// Dictation / mobile-keyboard input shim for the xterm.js helper textarea.
//
// xterm.js's keyboard handling is built around hardware keyboards plus
// IME composition. iOS Dictation, SuperWhisper / WhisperFlow keyboards,
// and similar voice flows route input through paths xterm wasn't
// designed for, with three observed failure modes:
//
//   1. iOS Dictation — fires successive `compositionend` events whose
//      `data` is the *cumulative* transcription. xterm's
//      `_finalizeComposition` re-sends the whole textarea on each
//      commit, producing
//        "Make Make sure Make sure the doc Make sure the docs are updated"
//      instead of a single clean line.
//
//   2. SuperWhisper / WhisperFlow iOS keyboards — push text via
//      `beforeinput`/`input` (`insertText`) with no `keydown` and no
//      composition events. xterm clears the helper textarea after the
//      first burst, so only the first character ever reaches stdin.
//
//   3. iOS Safari mid-composition keystrokes — if a non-`Process`
//      keydown reaches xterm while `_isComposing` is true, xterm calls
//      `_finalizeComposition(false)` synchronously and emits whatever
//      the textarea currently holds, in addition to the cumulative
//      `compositionend` we get a moment later. Result: the first
//      letter of "Ok, it works" is duplicated → "OOk, it works".
//
// The fix is structural rather than reactive: take xterm out of the
// text-input business entirely. We install a `customKeyEventHandler`
// that returns `false` for every key that would feed text to stdin
// (printable characters, Enter, Tab, Backspace, Delete) so xterm
// treats them as "not handled here." Navigation, function and
// modifier-shortcut keys (arrows, Home/End, Ctrl-C, Cmd-K, F1..F12,
// Esc) still flow through xterm's keymap so the terminal behaves as
// users expect.
//
// All character input then goes through capture-phase listeners on
// xterm's hidden helper textarea: `beforeinput` for one-shot inserts /
// deletes, `compositionend` (with cumulative-prefix diffing) for IME
// and Apple Dictation, and a blanket capture-phase `input` listener
// that swallows the event so xterm's `_inputEvent` never fires.
//
// Together these guarantee xterm cannot emit text bytes to stdin —
// every character byte the PTY sees comes from the shim's `onData`
// callback, computed from a single source of truth.

export interface DictationInputOptions {
  /** xterm's hidden helper textarea (`.xterm-helper-textarea`). */
  textarea: HTMLTextAreaElement;
  /** Called with bytes destined for the PTY's stdin. */
  onData: (data: string) => void;
  /** xterm Terminal instance. If provided, we install
   *  `attachCustomKeyEventHandler` to keep xterm out of the
   *  text-input path. The shim still works without this (degraded:
   *  xterm may double-send first dictation character on iOS), so
   *  we accept `null` for tests / call sites that don't have the
   *  Terminal handle yet. */
  term?: {
    attachCustomKeyEventHandler: (h: (e: KeyboardEvent) => boolean) => void;
  } | null;
}

export interface DictationInput {
  dispose(): void;
}

// Treat successive composition commits as the same utterance when they
// arrive within this window. Past it, the prefix tracker resets so a
// new dictation pass starts from an empty diff baseline. 600 ms covers
// typical Apple Dictation cadence (~250 ms between bursts) without
// gluing together genuinely separate utterances.
const UTTERANCE_QUIET_MS = 600;

// Keys whose handling we leave to xterm (it sends the right escape
// sequence and we don't need to track them, since they never appear at
// the head of a future dictation payload).
function isNavOrFunctionKey(key: string): boolean {
  if (
    key === "Escape" ||
    key === "Home" ||
    key === "End" ||
    key === "PageUp" ||
    key === "PageDown" ||
    key === "Insert"
  )
    return true;
  if (key.startsWith("Arrow")) return true;
  if (/^F\d{1,2}$/.test(key)) return true;
  return false;
}

// Tighten textarea attributes so iOS soft keyboards don't inject
// autocorrect / autocap mutations into the terminal stream. Set them
// idempotently; xterm sets some of these too but we override.
function harden(textarea: HTMLTextAreaElement): void {
  textarea.setAttribute("autocapitalize", "off");
  textarea.setAttribute("autocorrect", "off");
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("spellcheck", "false");
  textarea.setAttribute("inputmode", "text");
  textarea.setAttribute("enterkeyhint", "send");
}

export function attachDictationInput(
  opts: DictationInputOptions,
): DictationInput {
  const { textarea, onData, term } = opts;
  harden(textarea);

  // Take xterm out of the text-input path. Returning `false` from
  // customKeyEventHandler aborts xterm's `_keyDown` before it can
  // emit data or call `preventDefault`, and it sets `_keyDownSeen=true`
  // which (combined with our capture-phase `input` swallower) keeps
  // xterm's `_inputEvent` dormant too. xterm still sees navigation /
  // modifier keys and emits the right escape sequences for them.
  if (term) {
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      const key = e.key;
      // Modifier shortcuts (Ctrl-C, Cmd-K, Alt-b, etc.) → xterm.
      if (e.ctrlKey || e.metaKey || e.altKey) return true;
      if (typeof key !== "string") return true;
      if (isNavOrFunctionKey(key)) return true;
      // Everything else — printable chars, Enter, Tab, Backspace,
      // Delete, Process (IME), Unidentified (iOS dictation) — is
      // handled by the shim. xterm: hands off.
      return false;
    });
  }

  // Cumulative *visible* text we've forwarded for the current
  // utterance — every `insertText`, paste, and `compositionend` delta
  // gets appended; Backspace shrinks it; Enter / quiet / blur clear
  // it. This is the prefix we diff `compositionend` payloads against.
  let utteranceBuffer = "";
  let composing = false;
  let lastSendAt = 0;

  function maybeResetUtterance(): void {
    if (Date.now() - lastSendAt > UTTERANCE_QUIET_MS) utteranceBuffer = "";
  }

  // Update the prefix tracker to reflect bytes we just sent. Plain
  // text appends; Backspace shrinks; Enter / Ctrl-C / Ctrl-U clear
  // (the shell echoes a fresh prompt so any prior dictation context
  // is now irrelevant). Other control bytes (Ctrl-W, arrows, etc.)
  // leave the buffer alone — we don't model word boundaries.
  function recordSent(data: string): void {
    if (data === "\r" || data === "\n") {
      utteranceBuffer = "";
      return;
    }
    if (data === "\x03" || data === "\x15") {
      utteranceBuffer = "";
      return;
    }
    if (data === "\x7f") {
      utteranceBuffer = utteranceBuffer.slice(0, -1);
      return;
    }
    if (data.charCodeAt(0) < 0x20 || data.startsWith("\x1b")) return;
    utteranceBuffer += data;
  }

  function send(data: string): void {
    if (!data) return;
    onData(data);
    recordSent(data);
    lastSendAt = Date.now();
  }

  // Drain the textarea on the next tick so the browser's pending
  // composition / insertion side-effects have settled. iOS soft
  // keyboards land in an empty buffer for the next burst.
  function clearTextareaSoon(): void {
    queueMicrotask(() => {
      try {
        if (textarea.value !== "") textarea.value = "";
      } catch {
        /* read-only or disposed — fine to ignore */
      }
    });
  }

  function handleBeforeInput(e: Event): void {
    const ie = e as InputEvent;
    // While an IME composition is active, let the browser keep
    // building its provisional text and act only on `compositionend`.
    if (composing) return;

    const inputType = ie.inputType;
    let consumed = true;

    switch (inputType) {
      case "insertText":
      case "insertReplacementText":
      case "insertFromPaste":
      case "insertFromYank":
      case "insertFromDrop":
      case "insertFromComposition": {
        const data = ie.data ?? "";
        if (data) send(data);
        break;
      }
      case "insertCompositionText":
        // Provisional composition text — wait for compositionend so we
        // don't echo every keystroke of an IME candidate.
        consumed = false;
        break;
      case "insertLineBreak":
      case "insertParagraph":
        send("\r");
        break;
      case "deleteContentBackward":
      case "deleteContent":
      case "deleteByCut":
        send("\x7f");
        break;
      case "deleteContentForward":
        send("\x1b[3~");
        break;
      case "deleteWordBackward":
        send("\x17"); // Ctrl-W
        break;
      case "deleteWordForward":
        send("\x1bd"); // Meta-d
        break;
      case "deleteSoftLineBackward":
      case "deleteHardLineBackward":
        send("\x15"); // Ctrl-U
        break;
      case "deleteSoftLineForward":
      case "deleteHardLineForward":
        send("\x0b"); // Ctrl-K
        break;
      case "historyUndo":
      case "historyRedo":
      case "formatBold":
      case "formatItalic":
      case "formatUnderline":
        // Quietly drop rich-text intents — they have no terminal
        // equivalent and we don't want them leaking as plain text.
        break;
      default:
        consumed = false;
        break;
    }

    if (consumed) {
      if (ie.cancelable) ie.preventDefault();
      ie.stopImmediatePropagation();
      clearTextareaSoon();
    }
  }

  // Blanket-swallow `input` events. xterm's `_inputEvent` would
  // otherwise re-emit `insertText` data we already handled at
  // `beforeinput`, and on iOS Safari it can fire even when
  // `beforeinput` was preventDefault'd. We don't need `input` for any
  // of our own logic.
  function handleInputSwallow(e: Event): void {
    e.stopImmediatePropagation();
  }

  function handleCompositionStart(): void {
    composing = true;
    maybeResetUtterance();
  }

  function handleCompositionUpdate(e: Event): void {
    // Suppress xterm's `_compositionView` overlay path. We act only on
    // the final commit.
    e.stopImmediatePropagation();
  }

  function handleCompositionEnd(e: Event): void {
    const ce = e as CompositionEvent;
    composing = false;
    maybeResetUtterance();

    const full = ce.data ?? "";
    let delta = full;
    if (utteranceBuffer.length > 0 && full.startsWith(utteranceBuffer)) {
      // Apple Dictation: cumulative commit. Send only the tail not
      // yet sent — covers both pure-composition cycles AND the
      // insertText("O") → compositionend("Ok, it works") boundary.
      delta = full.slice(utteranceBuffer.length);
    }
    // Fallback: commit doesn't extend the buffer. The terminal can't
    // do mid-line replacement so we just send the new transcription.
    if (delta) {
      onData(delta);
      lastSendAt = Date.now();
    }
    utteranceBuffer = full;

    e.stopImmediatePropagation();
    clearTextareaSoon();
  }

  function handleBlur(): void {
    utteranceBuffer = "";
    composing = false;
  }

  // Capture phase so we run before xterm.js's listeners (which attach
  // at bubble phase). `stopImmediatePropagation` from a capture-phase
  // listener at the target node also cancels bubble-phase listeners
  // on that same node — that's how we keep xterm's textarea-driven
  // paths dormant.
  textarea.addEventListener("beforeinput", handleBeforeInput, true);
  textarea.addEventListener("input", handleInputSwallow, true);
  textarea.addEventListener("compositionstart", handleCompositionStart, true);
  textarea.addEventListener("compositionupdate", handleCompositionUpdate, true);
  textarea.addEventListener("compositionend", handleCompositionEnd, true);
  textarea.addEventListener("blur", handleBlur, true);

  return {
    dispose() {
      textarea.removeEventListener("beforeinput", handleBeforeInput, true);
      textarea.removeEventListener("input", handleInputSwallow, true);
      textarea.removeEventListener(
        "compositionstart",
        handleCompositionStart,
        true,
      );
      textarea.removeEventListener(
        "compositionupdate",
        handleCompositionUpdate,
        true,
      );
      textarea.removeEventListener(
        "compositionend",
        handleCompositionEnd,
        true,
      );
      textarea.removeEventListener("blur", handleBlur, true);
      // We can't easily uninstall customKeyEventHandler — xterm's API
      // only supports replacing it. Setting a passthrough handler is
      // the closest thing.
      if (term) term.attachCustomKeyEventHandler(() => true);
    },
  };
}
