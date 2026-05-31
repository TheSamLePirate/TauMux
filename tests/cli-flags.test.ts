// §6.5 — `bin/ht` split. parseFlags + unescapeText were buried in the
// 2,361-line monolith and untestable; now they live in src/cli/flags.ts.
// These pin the CURRENT (behavior-preserving) parsing, including the known
// edge cases the split deliberately did NOT change — a per-command flag
// spec to fix those is tracked separately.

import { describe, test, expect } from "bun:test";
import { parseFlags, unescapeText } from "../src/cli/flags";

describe("parseFlags", () => {
  test("collects bare positionals", () => {
    expect(parseFlags(["a", "b", "c"])).toEqual({
      positional: ["a", "b", "c"],
      flags: {},
    });
  });

  test("--key value pairs become flags", () => {
    expect(parseFlags(["--url", "http://x", "--dir", "left"]).flags).toEqual({
      url: "http://x",
      dir: "left",
    });
  });

  test("a trailing --flag with no value is boolean 'true'", () => {
    expect(parseFlags(["--force"]).flags).toEqual({ force: "true" });
  });

  test("single-char short flags take a value", () => {
    expect(parseFlags(["-s", "browser:2"]).flags).toEqual({ s: "browser:2" });
  });

  test("mixes positionals and flags", () => {
    const r = parseFlags(["click", "#btn", "--surface", "browser:2"]);
    expect(r.positional).toEqual(["click", "#btn"]);
    expect(r.flags).toEqual({ surface: "browser:2" });
  });

  // ── documented edge cases preserved as-is (NOT fixed in the split) ──

  test("[known] a value that starts with -- is read as boolean true", () => {
    // `--reason --foo`: `--foo` looks like a flag, so `reason` becomes
    // boolean and `--foo` is parsed as its own flag.
    expect(parseFlags(["--reason", "--foo"]).flags).toEqual({
      reason: "true",
      foo: "true",
    });
  });

  test("[known] multi-char short flag falls through to positional", () => {
    // `-xy` (length 3) is NOT treated as a short flag.
    expect(parseFlags(["-xy"]).positional).toEqual(["-xy"]);
  });

  test("[known] a negative-number value after a short flag is mis-read", () => {
    // `-s` then `-5`: `-5` starts with `-`, so `s` becomes boolean and
    // `-5` is parsed as the short flag `5`.
    expect(parseFlags(["-s", "-5"]).flags).toEqual({ s: "true", "5": "true" });
  });
});

describe("unescapeText", () => {
  test("turns escape sequences into control chars", () => {
    expect(unescapeText("a\\tb")).toBe("a\tb");
    expect(unescapeText("x\\x1by")).toBe("x\x1by");
  });

  test("both \\n and \\r map to carriage return (terminal submit)", () => {
    expect(unescapeText("line\\n")).toBe("line\r");
    expect(unescapeText("line\\r")).toBe("line\r");
  });

  test("escaped backslash stays a single backslash", () => {
    expect(unescapeText("a\\\\b")).toBe("a\\b");
  });
});
