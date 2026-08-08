/**
 * Shift+Enter → `ESC CR`.
 *
 * The sequence is not ours to choose: Claude Code's own `/terminal-setup`
 * installs `{"key":"shift+enter", …, "args":{"text":"\r"}}` for VS
 * Code and flips iTerm2's `useOptionAsMetaKey` so ⌥Return produces the
 * same bytes. These tests pin that value so a future "tidy-up" cannot
 * quietly swap it for `\n` or a CSI-u sequence xterm 6.0 cannot parse.
 */
import { describe, test, expect } from "bun:test";
import {
  META_RETURN,
  encodeKeyOverride,
  type KeyEventLike,
} from "../src/shared/terminal-key-encoding";

function key(over: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    type: "keydown",
    key: "Enter",
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...over,
  };
}

describe("encodeKeyOverride", () => {
  test("Shift+Enter produces ESC CR", () => {
    expect(encodeKeyOverride(key({ shiftKey: true }))).toBe("\x1b\r");
  });

  test("META_RETURN is exactly the two bytes Claude Code installs", () => {
    expect(META_RETURN).toBe("\x1b\r");
    expect(META_RETURN.length).toBe(2);
    expect(META_RETURN.charCodeAt(0)).toBe(0x1b);
    expect(META_RETURN.charCodeAt(1)).toBe(0x0d);
  });

  test("plain Enter is left to xterm", () => {
    expect(encodeKeyOverride(key())).toBeNull();
  });

  test("⌥Enter is left to xterm — macOptionIsMeta already emits ESC CR", () => {
    expect(encodeKeyOverride(key({ altKey: true, shiftKey: true }))).toBeNull();
    expect(encodeKeyOverride(key({ altKey: true }))).toBeNull();
  });

  test("⌃Enter and ⌘Enter keep their existing meanings", () => {
    expect(
      encodeKeyOverride(key({ ctrlKey: true, shiftKey: true })),
    ).toBeNull();
    expect(
      encodeKeyOverride(key({ metaKey: true, shiftKey: true })),
    ).toBeNull();
  });

  test("only keydown is intercepted", () => {
    // keypress / keyup for the same chord must not send a second copy.
    expect(
      encodeKeyOverride(key({ type: "keyup", shiftKey: true })),
    ).toBeNull();
    expect(
      encodeKeyOverride(key({ type: "keypress", shiftKey: true })),
    ).toBeNull();
  });

  test("other keys are untouched", () => {
    for (const k of ["a", "Tab", "Escape", "ArrowUp", "Backspace", "F5"]) {
      expect(encodeKeyOverride(key({ key: k, shiftKey: true }))).toBeNull();
    }
  });
});
