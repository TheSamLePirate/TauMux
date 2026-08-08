/**
 * OSC 52 policy.
 *
 * The direction split is the whole design: writes are useful (a yank in
 * nvim over SSH reaching the local clipboard), reads are an
 * exfiltration primitive (any process with terminal access silently
 * reading whatever password manager just put on the clipboard). These
 * tests exist mostly to make the refusal load-bearing — someone
 * "completing" the provider later has to delete an assertion that says
 * why not.
 */
import { describe, test, expect } from "bun:test";
import {
  OSC52_MAX_CHARS,
  createOsc52Provider,
} from "../src/views/terminal/terminal-clipboard";

function provider(enabled = true) {
  const writes: string[] = [];
  const p = createOsc52Provider({
    write: (t) => writes.push(t),
    isWriteEnabled: () => enabled,
  });
  return { p, writes };
}

describe("OSC 52 reads", () => {
  test("never return clipboard contents", () => {
    const { p } = provider();
    expect(p.readText("c")).toBe("");
    expect(p.readText("p")).toBe("");
  });

  test("stay refused even with writes enabled", () => {
    // Read and write are independent capabilities; the setting governs
    // writes only, and there is deliberately no read setting.
    const { p } = provider(true);
    expect(p.readText("c")).toBe("");
  });
});

describe("OSC 52 writes", () => {
  test("reach the system clipboard", () => {
    const { p, writes } = provider();
    p.writeText("c", "yanked text");
    expect(writes).toEqual(["yanked text"]);
  });

  test("are suppressed when the setting is off", () => {
    const { p, writes } = provider(false);
    p.writeText("c", "yanked text");
    expect(writes).toEqual([]);
  });

  test("ignore the X11 primary selection", () => {
    // macOS has no primary selection. Honouring `p` would clobber the
    // real clipboard on every mouse-select inside a remote vim.
    const { p, writes } = provider();
    p.writeText("p", "mouse selection");
    expect(writes).toEqual([]);
  });

  test("ignore an empty payload", () => {
    const { p, writes } = provider();
    p.writeText("c", "");
    expect(writes).toEqual([]);
  });

  test("refuse an oversized payload rather than truncating it", () => {
    // A terminal is not a file-transfer channel, and half a payload on
    // the clipboard is worse than none.
    const { p, writes } = provider();
    p.writeText("c", "x".repeat(OSC52_MAX_CHARS + 1));
    expect(writes).toEqual([]);
  });

  test("accept a payload exactly at the limit", () => {
    const { p, writes } = provider();
    p.writeText("c", "x".repeat(OSC52_MAX_CHARS));
    expect(writes.length).toBe(1);
  });
});
