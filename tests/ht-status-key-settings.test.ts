// Coverage for `applyHtStatusKeySettings` — the pure resolver that
// composes the user's `htStatusKeyOrder` / `htStatusKeyHidden`
// preferences with the bun-discovered `htKeysSeen` set into the final
// rendered list. Both the bottom-bar `ht-all` renderer and the
// sidebar workspace card go through this function so a single set of
// table-driven tests covers both surfaces.

import { describe, expect, test } from "bun:test";
import { applyHtStatusKeySettings } from "../src/shared/settings";

describe("applyHtStatusKeySettings", () => {
  test("returns insertion order when no preferences are set", () => {
    const out = applyHtStatusKeySettings(["b", "a", "c"], [], []);
    expect(out).toEqual(["b", "a", "c"]);
  });

  test("custom order wins for keys it covers", () => {
    const out = applyHtStatusKeySettings(["a", "b", "c"], ["c", "a"], []);
    // c first, a second, b last (not in custom order, falls to insertion).
    expect(out).toEqual(["c", "a", "b"]);
  });

  test("hidden keys are filtered out", () => {
    const out = applyHtStatusKeySettings(["a", "b", "c"], [], ["b"]);
    expect(out).toEqual(["a", "c"]);
  });

  test("hidden + ordered work together", () => {
    const out = applyHtStatusKeySettings(["a", "b", "c"], ["c", "a"], ["a"]);
    // a is hidden; c stays first because order survives filtering;
    // b appended via insertion-order fallback.
    expect(out).toEqual(["c", "b"]);
  });

  test("stale order entries (not in seen) are dropped", () => {
    const out = applyHtStatusKeySettings(["b", "c"], ["x", "b"], []);
    // x isn't in seen — drop. b first via order. c via insertion.
    expect(out).toEqual(["b", "c"]);
  });

  test("duplicate entries in order are deduplicated", () => {
    const out = applyHtStatusKeySettings(["a", "b"], ["a", "a", "b"], []);
    expect(out).toEqual(["a", "b"]);
  });

  test("empty seen → empty output regardless of preferences", () => {
    const out = applyHtStatusKeySettings([], ["a", "b"], ["c"]);
    expect(out).toEqual([]);
  });

  test("full overlap of hidden = empty output", () => {
    const out = applyHtStatusKeySettings(["a", "b"], [], ["a", "b"]);
    expect(out).toEqual([]);
  });

  test("preserves insertion order of newly-seen keys (appended last)", () => {
    // User customised order has just a and b; c later appears.
    const out = applyHtStatusKeySettings(["a", "b", "c", "d"], ["b", "a"], []);
    expect(out).toEqual(["b", "a", "c", "d"]);
  });
});
