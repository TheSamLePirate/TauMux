// Agent-authored Atlas annotations.
//
// This is the one channel where the thing doing the work says something
// observation cannot reach, so the rules that matter are the ones that
// keep it honest: bounded (a looping agent cannot grow it), forgiving
// about units (a caller reporting 62 means 62 %), and self-cleaning (an
// entry saying nothing is not an annotation).

import { beforeEach, describe, expect, test } from "bun:test";
import { AtlasAnnotationStore } from "../src/bun/atlas-annotations";

const T0 = 1_700_000_000_000;
let clock = T0;
const now = () => clock;

function store() {
  clock = T0;
  return new AtlasAnnotationStore(now);
}

describe("AtlasAnnotationStore", () => {
  let s: AtlasAnnotationStore;
  beforeEach(() => {
    s = store();
  });

  test("an empty store says nothing", () => {
    expect(s.snapshot()).toEqual({ annotations: [], marks: [] });
  });

  test("pin / unpin round-trips and cleans up after itself", () => {
    s.pin("surface:1");
    expect(s.snapshot().annotations[0]).toMatchObject({
      target: "surface:1",
      pinned: true,
    });
    s.pin("surface:1", false);
    // An entry carrying nothing is not an annotation.
    expect(s.snapshot().annotations).toEqual([]);
  });

  test("a note is trimmed, capped, and clearable by emptying it", () => {
    s.note("surface:1", "  waiting on CI  ");
    expect(s.snapshot().annotations[0]!.note).toBe("waiting on CI");
    s.note("surface:1", "x".repeat(500));
    expect(s.snapshot().annotations[0]!.note!.length).toBe(200);
    s.note("surface:1", "   ");
    expect(s.snapshot().annotations).toEqual([]);
  });

  test("meters clamp rather than refuse", () => {
    s.meter("surface:1", "build", 1.4);
    expect(s.snapshot().annotations[0]!.meters[0]!.value).toBe(1);
    s.meter("surface:1", "build", -3);
    expect(s.snapshot().annotations[0]!.meters[0]!.value).toBe(0);
    s.meter("surface:1", "build", Number.NaN);
    expect(s.snapshot().annotations[0]!.meters[0]!.value).toBe(0);
  });

  test("re-publishing a meter updates in place, keeping its label", () => {
    s.meter("surface:1", "build", 0.2, "compiling");
    s.meter("surface:1", "build", 0.9);
    const meters = s.snapshot().annotations[0]!.meters;
    expect(meters).toHaveLength(1);
    expect(meters[0]).toMatchObject({ value: 0.9, label: "compiling" });
  });

  test("a looping agent cannot grow the meter list without bound", () => {
    for (let i = 0; i < 12; i++) s.meter("surface:1", `k${i}`, 0.5);
    const meters = s.snapshot().annotations[0]!.meters;
    expect(meters).toHaveLength(4);
    // Oldest-out: a fifth meter means the fifth one, not "ignore me".
    expect(meters.map((m) => m.key)).toEqual(["k8", "k9", "k10", "k11"]);
  });

  test("clearing one meter leaves the others", () => {
    s.meter("surface:1", "a", 0.1);
    s.meter("surface:1", "b", 0.2);
    s.clearMeter("surface:1", "a");
    expect(s.snapshot().annotations[0]!.meters.map((m) => m.key)).toEqual(["b"]);
  });

  test("marks are timestamped, capped and expire", () => {
    s.mark("first");
    expect(s.snapshot().marks[0]).toMatchObject({ text: "first", at: T0 });

    for (let i = 0; i < 80; i++) s.mark(`m${i}`);
    expect(s.snapshot().marks.length).toBeLessThanOrEqual(50);

    // They annotate the recent past, not a history.
    clock = T0 + 11 * 60_000;
    expect(s.snapshot().marks).toEqual([]);
  });

  test("an empty mark is refused rather than stored blank", () => {
    expect(s.mark("   ")).toBeNull();
    expect(s.snapshot().marks).toEqual([]);
  });

  test("clear scopes to one target, or drops everything", () => {
    s.pin("a");
    s.note("b", "hi");
    s.mark("for-a", { target: "a" });
    s.clear("a");
    expect(s.snapshot().annotations.map((x) => x.target)).toEqual(["b"]);
    expect(s.snapshot().marks).toEqual([]);
    s.clear();
    expect(s.snapshot().annotations).toEqual([]);
  });

  test("subscribers see every mutation", () => {
    let hits = 0;
    const off = s.subscribe(() => hits++);
    s.pin("a");
    s.note("a", "x");
    s.mark("m");
    expect(hits).toBe(3);
    off();
    s.pin("b");
    expect(hits).toBe(3);
  });

  test("a listener that throws cannot break the store", () => {
    s.subscribe(() => {
      throw new Error("boom");
    });
    expect(() => s.pin("a")).not.toThrow();
    expect(s.snapshot().annotations).toHaveLength(1);
  });

  test("forgetting a closed pane drops only its entry", () => {
    s.pin("a");
    s.pin("b");
    s.forget("a");
    expect(s.snapshot().annotations.map((x) => x.target)).toEqual(["b"]);
  });
});
