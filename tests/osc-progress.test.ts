// Pure-function coverage for the OSC 9;4 progress parser. Table-
// driven so adding new state codes / edge cases is one row.

import { describe, expect, test } from "bun:test";
import {
  describeOsc94State,
  parseOsc94Payload,
  type Osc94Update,
} from "../src/views/terminal/osc-progress";

describe("parseOsc94Payload", () => {
  // [body, expected]
  const cases: [string, Osc94Update | null][] = [
    // Happy path: state + value.
    ["4;1;42", { state: "normal", value: 42 }],
    ["4;1;0", { state: "normal", value: 0 }],
    ["4;1;100", { state: "normal", value: 100 }],
    // Clamp out-of-range values.
    ["4;1;250", { state: "normal", value: 100 }],
    ["4;1;-5", { state: "normal", value: 0 }],
    // Round fractional input (some emitters cheat with floats).
    ["4;1;42.7", { state: "normal", value: 43 }],
    // Error state, with and without value.
    ["4;2;75", { state: "error", value: 75 }],
    ["4;2", { state: "error", value: null }],
    ["4;2;", { state: "error", value: null }],
    // Paused state.
    ["4;4;33", { state: "paused", value: 33 }],
    ["4;4", { state: "paused", value: null }],
    // Remove ignores any attached value.
    ["4;0", { state: "remove", value: null }],
    ["4;0;42", { state: "remove", value: null }],
    // Indeterminate ignores any attached value.
    ["4;3", { state: "indeterminate", value: null }],
    ["4;3;88", { state: "indeterminate", value: null }],
    // Bare "4" without state — reject.
    ["4", null],
    ["4;", null],
    // Unknown state code — reject so we don't paint random colours.
    ["4;9;42", null],
    // Garbage / non-numeric value — reject.
    ["4;1;NaN", null],
    ["4;1;abc", null],
    // Different OSC 9 sub-command (e.g. ConEmu cwd) — reject.
    ["1;~/Projects", null],
    ["", null],
    [";", null],
    // Trailing junk — we only look at the first three segments,
    // anything beyond is permissive (some tools append fields).
    ["4;1;42;extra", { state: "normal", value: 42 }],
  ];

  for (const [body, expected] of cases) {
    test(`parseOsc94Payload(${JSON.stringify(body)})`, () => {
      const got = parseOsc94Payload(body);
      expect(got).toEqual(expected);
    });
  }
});

describe("describeOsc94State", () => {
  test("normal returns null so the user-set label survives", () => {
    expect(describeOsc94State("normal")).toBeNull();
  });
  test("remove returns null", () => {
    expect(describeOsc94State("remove")).toBeNull();
  });
  test("error / indeterminate / paused stamp a label", () => {
    expect(describeOsc94State("error")).toBe("error");
    expect(describeOsc94State("indeterminate")).toBe("working…");
    expect(describeOsc94State("paused")).toBe("paused");
  });
});
