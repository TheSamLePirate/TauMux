// Plan #13 — pure-function tests for the soft-keyboard toolbar.
// The DOM-bound `createKeyboardToolbar` is exercised implicitly via
// the `encodeKey` / `encodeCtrlLetter` helpers it composes.

import { describe, expect, test } from "bun:test";
import {
  encodeCtrlLetter,
  encodeKey,
} from "../src/web-client/keyboard-toolbar";

describe("encodeKey — modifier-free", () => {
  test("Esc emits the raw byte", () => {
    expect(encodeKey("Esc", false)).toBe("\x1b");
  });

  test("Tab emits a single tab", () => {
    expect(encodeKey("Tab", false)).toBe("\t");
  });

  test("arrows emit CSI sequences", () => {
    expect(encodeKey("Up", false)).toBe("\x1b[A");
    expect(encodeKey("Down", false)).toBe("\x1b[B");
    expect(encodeKey("Right", false)).toBe("\x1b[C");
    expect(encodeKey("Left", false)).toBe("\x1b[D");
  });

  test("PageUp / PageDown / Home / End emit their xterm sequences", () => {
    expect(encodeKey("PageUp", false)).toBe("\x1b[5~");
    expect(encodeKey("PageDown", false)).toBe("\x1b[6~");
    expect(encodeKey("Home", false)).toBe("\x1b[H");
    expect(encodeKey("End", false)).toBe("\x1b[F");
  });

  test("punctuation passes through verbatim", () => {
    expect(encodeKey("Pipe", false)).toBe("|");
    expect(encodeKey("Tilde", false)).toBe("~");
    expect(encodeKey("Slash", false)).toBe("/");
    expect(encodeKey("Backslash", false)).toBe("\\");
    expect(encodeKey("Colon", false)).toBe(":");
    expect(encodeKey("Backtick", false)).toBe("`");
    expect(encodeKey("Quote", false)).toBe("'");
    expect(encodeKey("DoubleQuote", false)).toBe('"');
  });
});

describe("encodeKey — with sticky Ctrl", () => {
  test("Ctrl + arrow emits the modifier-encoded CSI", () => {
    expect(encodeKey("Up", true)).toBe("\x1b[1;5A");
    expect(encodeKey("Down", true)).toBe("\x1b[1;5B");
    expect(encodeKey("Right", true)).toBe("\x1b[1;5C");
    expect(encodeKey("Left", true)).toBe("\x1b[1;5D");
  });

  test("Ctrl + Home / End emit their modifier variants", () => {
    expect(encodeKey("Home", true)).toBe("\x1b[1;5H");
    expect(encodeKey("End", true)).toBe("\x1b[1;5F");
  });

  test("Ctrl + slash = ASCII 0x1f (US separator)", () => {
    expect(encodeKey("Slash", true)).toBe("\x1f");
  });

  test("Ctrl + backslash = ASCII 0x1c (FS separator)", () => {
    expect(encodeKey("Backslash", true)).toBe("\x1c");
  });

  test("Ctrl + Esc / Tab is unchanged (terminal expects raw byte)", () => {
    expect(encodeKey("Esc", true)).toBe("\x1b");
    expect(encodeKey("Tab", true)).toBe("\t");
  });
});

describe("encodeCtrlLetter", () => {
  test("a → \\x01", () => {
    expect(encodeCtrlLetter("a")).toBe("\x01");
  });

  test("z → \\x1a", () => {
    expect(encodeCtrlLetter("z")).toBe("\x1a");
  });

  test("uppercase mapped via lowercase fold", () => {
    expect(encodeCtrlLetter("C")).toBe("\x03");
    expect(encodeCtrlLetter("D")).toBe("\x04");
  });

  test("non-letter input is returned unchanged", () => {
    expect(encodeCtrlLetter("1")).toBe("1");
    expect(encodeCtrlLetter("!")).toBe("!");
    expect(encodeCtrlLetter("")).toBe("");
    expect(encodeCtrlLetter("ab")).toBe("ab");
  });
});
