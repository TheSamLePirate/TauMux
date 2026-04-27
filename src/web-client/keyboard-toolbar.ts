// τ-mux web mirror — soft-keyboard toolbar.
//
// Mobile / tablet keyboards are missing the keys terminal users depend
// on: Esc, Tab, Ctrl, arrows, |, ~, /, :. This module renders a row of
// buttons above the on-screen keyboard that emit those keys on tap. A
// sticky Ctrl button modifies the next non-modifier press into the
// matching control character (Ctrl-A → \x01, Ctrl-C → \x03, …).
//
// The toolbar is purely an input source: tapping a key invokes the
// caller-supplied `onKey(seq)` with the bytes the user would have
// pressed on a hardware keyboard. The mirror's existing `term.onData`
// path already routes those bytes to the server's stdin handler, so
// the toolbar slots into the same pipe.
//
// Pure key-encoding lives in `encodeKey` so it can be unit-tested
// without spinning the DOM.

/** All the keys the toolbar can emit. */
export type SoftKey =
  | "Esc"
  | "Tab"
  | "Up"
  | "Down"
  | "Left"
  | "Right"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown"
  | "Pipe"
  | "Tilde"
  | "Slash"
  | "Backslash"
  | "Colon"
  | "Backtick"
  | "Quote"
  | "DoubleQuote";

/** Pure: encode a soft key into the byte sequence a hardware keyboard
 *  would produce (with optional Ctrl). Returns the empty string for
 *  no-op combinations (e.g. Ctrl + an arrow when the terminal expects
 *  the bare arrow CSI). */
export function encodeKey(key: SoftKey, ctrl: boolean): string {
  switch (key) {
    case "Esc":
      return "\x1b";
    case "Tab":
      return "\t";
    case "Up":
      return ctrl ? "\x1b[1;5A" : "\x1b[A";
    case "Down":
      return ctrl ? "\x1b[1;5B" : "\x1b[B";
    case "Right":
      return ctrl ? "\x1b[1;5C" : "\x1b[C";
    case "Left":
      return ctrl ? "\x1b[1;5D" : "\x1b[D";
    case "Home":
      return ctrl ? "\x1b[1;5H" : "\x1b[H";
    case "End":
      return ctrl ? "\x1b[1;5F" : "\x1b[F";
    case "PageUp":
      return "\x1b[5~";
    case "PageDown":
      return "\x1b[6~";
    case "Pipe":
      return "|";
    case "Tilde":
      return "~";
    case "Slash":
      return ctrl ? "\x1f" : "/";
    case "Backslash":
      return ctrl ? "\x1c" : "\\";
    case "Colon":
      return ":";
    case "Backtick":
      return "`";
    case "Quote":
      return "'";
    case "DoubleQuote":
      return '"';
  }
}

/** Pure: encode a printable letter under Ctrl (a→\x01 .. z→\x1a). For
 *  non-letter input the original character is returned unchanged. */
export function encodeCtrlLetter(letter: string): string {
  if (letter.length !== 1) return letter;
  const code = letter.toLowerCase().charCodeAt(0);
  if (code < 97 || code > 122) return letter;
  // a=97 → 1, z=122 → 26
  return String.fromCharCode(code - 96);
}

// ── DOM ──────────────────────────────────────────────────────

interface ToolbarKeyDef {
  key: SoftKey;
  label: string;
  /** Optional aria-label override. */
  aria?: string;
}

const KEYS: ToolbarKeyDef[] = [
  { key: "Esc", label: "Esc" },
  { key: "Tab", label: "Tab" },
  { key: "Up", label: "↑" },
  { key: "Down", label: "↓" },
  { key: "Left", label: "←" },
  { key: "Right", label: "→" },
  { key: "Pipe", label: "|" },
  { key: "Tilde", label: "~" },
  { key: "Slash", label: "/" },
  { key: "Backslash", label: "\\", aria: "Backslash" },
  { key: "Colon", label: ":" },
  { key: "Backtick", label: "`" },
  { key: "Quote", label: "'", aria: "Apostrophe" },
  { key: "DoubleQuote", label: '"', aria: "Double quote" },
  { key: "Home", label: "Hm" },
  { key: "End", label: "End" },
  { key: "PageUp", label: "PgUp" },
  { key: "PageDown", label: "PgDn" },
];

export interface KeyboardToolbarView {
  /** Toggle the toolbar visibility. */
  toggle(): void;
  /** Force-show or hide. */
  setVisible(visible: boolean): void;
  /** True when the toolbar is on screen. */
  isVisible(): boolean;
  /** Whether Ctrl is currently sticky-held. */
  isCtrlActive(): boolean;
  /** Programmatically clear the sticky Ctrl latch. */
  clearCtrl(): void;
  /** Wraps a single ASCII letter from the system keyboard so callers
   *  can route it through the latched Ctrl modifier — returns the
   *  encoded byte sequence (and clears the latch). */
  wrapLetter(letter: string): string;
}

export interface KeyboardToolbarDeps {
  /** Element the toolbar is appended to (typically `document.body`). */
  hostEl: HTMLElement;
  /** Toggle button so we can flip its `.active` class. */
  toggleBtn: HTMLElement;
  /** Called whenever the user presses a key on the toolbar with the
   *  encoded byte sequence (already Ctrl-folded if Ctrl was sticky). */
  onKey: (seq: string) => void;
}

export function createKeyboardToolbar(
  deps: KeyboardToolbarDeps,
): KeyboardToolbarView {
  const { hostEl, toggleBtn, onKey } = deps;
  let visible = false;
  let ctrlActive = false;
  let toolbarEl: HTMLElement | null = null;
  let ctrlBtnEl: HTMLButtonElement | null = null;

  function setCtrl(active: boolean) {
    ctrlActive = active;
    if (ctrlBtnEl) ctrlBtnEl.classList.toggle("active", active);
  }

  function build(): HTMLElement {
    const root = document.createElement("div");
    root.className = "wm-kbd-toolbar";
    root.setAttribute("role", "toolbar");
    root.setAttribute("aria-label", "Soft keyboard toolbar");
    // The Ctrl button is the only one with persistent state.
    const ctrlBtn = document.createElement("button");
    ctrlBtn.type = "button";
    ctrlBtn.className = "wm-kbd-key wm-kbd-ctrl";
    ctrlBtn.textContent = "Ctrl";
    ctrlBtn.setAttribute("aria-label", "Sticky control");
    ctrlBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      setCtrl(!ctrlActive);
    });
    ctrlBtnEl = ctrlBtn;
    root.appendChild(ctrlBtn);

    for (const def of KEYS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wm-kbd-key";
      btn.textContent = def.label;
      btn.setAttribute("aria-label", def.aria ?? def.label);
      btn.addEventListener("pointerdown", (e) => {
        // Suppress the synthesized click so xterm doesn't lose focus.
        e.preventDefault();
        const seq = encodeKey(def.key, ctrlActive);
        if (seq) onKey(seq);
        // Auto-clear Ctrl after a single non-modifier press — matches
        // sticky-key behaviour on iOS / Android system keyboards.
        if (ctrlActive) setCtrl(false);
      });
      root.appendChild(btn);
    }
    return root;
  }

  function setVisible(v: boolean) {
    if (v === visible) return;
    visible = v;
    if (v) {
      toolbarEl = build();
      hostEl.appendChild(toolbarEl);
      document.body.classList.add("wm-kbd-active");
      toggleBtn.classList.add("active");
    } else {
      if (toolbarEl && toolbarEl.parentNode) {
        toolbarEl.parentNode.removeChild(toolbarEl);
      }
      toolbarEl = null;
      ctrlBtnEl = null;
      ctrlActive = false;
      document.body.classList.remove("wm-kbd-active");
      toggleBtn.classList.remove("active");
    }
  }

  function toggle() {
    setVisible(!visible);
  }

  function wrapLetter(letter: string): string {
    if (!ctrlActive) return letter;
    const out = encodeCtrlLetter(letter);
    setCtrl(false);
    return out;
  }

  return {
    toggle,
    setVisible,
    isVisible: () => visible,
    isCtrlActive: () => ctrlActive,
    clearCtrl: () => setCtrl(false),
    wrapLetter,
  };
}
