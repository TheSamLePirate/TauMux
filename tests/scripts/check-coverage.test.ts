// Phase 3 Step 1 — coverage gate parser + comparator.
//
// Hermetic tests against synthetic lcov fragments. The gate itself
// is intentionally simple — most of the value is in `parseLcov` and
// `findRegressions` doing the right thing on edge cases.

import { describe, expect, it } from "bun:test";
import {
  findRegressions,
  parseLcov,
  ratio,
} from "../../scripts/check-coverage";

function lcov(files: { path: string; hit: number; found: number }[]): string {
  return (
    files
      .map(
        (f) =>
          `TN:\nSF:${f.path}\nFNF:0\nFNH:0\nBRF:0\nBRH:0\nLF:${f.found}\nLH:${f.hit}\nend_of_record`,
      )
      .join("\n") + "\n"
  );
}

describe("[Phase 3] check-coverage — parseLcov", () => {
  it("returns an empty map for empty input", () => {
    expect(parseLcov("").size).toBe(0);
  });

  it("parses a single-file record", () => {
    const map = parseLcov(lcov([{ path: "src/foo.ts", hit: 5, found: 10 }]));
    expect(map.size).toBe(1);
    const c = map.get("src/foo.ts");
    expect(c).toBeDefined();
    expect(c!.linesHit).toBe(5);
    expect(c!.linesFound).toBe(10);
  });

  it("parses multiple records", () => {
    const map = parseLcov(
      lcov([
        { path: "src/a.ts", hit: 1, found: 4 },
        { path: "src/b.ts", hit: 3, found: 3 },
      ]),
    );
    expect(map.size).toBe(2);
    expect(map.get("src/a.ts")!.linesHit).toBe(1);
    expect(map.get("src/b.ts")!.linesHit).toBe(3);
  });

  it("tolerates DA lines (per-line counts) and ignores other records", () => {
    const raw = [
      "TN:",
      "SF:src/foo.ts",
      "DA:1,1",
      "DA:2,0",
      "DA:3,1",
      "FN:1,foo",
      "LF:3",
      "LH:2",
      "end_of_record",
    ].join("\n");
    const map = parseLcov(raw);
    expect(map.size).toBe(1);
    expect(map.get("src/foo.ts")!.linesHit).toBe(2);
    expect(map.get("src/foo.ts")!.linesFound).toBe(3);
  });
});

describe("[Phase 3] check-coverage — ratio()", () => {
  it("returns 0 when nothing was instrumented (avoids NaN)", () => {
    expect(ratio({ path: "x", linesHit: 0, linesFound: 0 })).toBe(0);
  });

  it("returns hit/found", () => {
    expect(ratio({ path: "x", linesHit: 50, linesFound: 100 })).toBe(0.5);
  });
});

describe("[Phase 3] check-coverage — findRegressions", () => {
  it("returns [] when current matches baseline", () => {
    const baseline = parseLcov(lcov([{ path: "src/a.ts", hit: 5, found: 10 }]));
    const current = parseLcov(lcov([{ path: "src/a.ts", hit: 5, found: 10 }]));
    expect(findRegressions(baseline, current, 0.005)).toEqual([]);
  });

  it("returns [] when current improves over baseline", () => {
    const baseline = parseLcov(lcov([{ path: "src/a.ts", hit: 5, found: 10 }]));
    const current = parseLcov(lcov([{ path: "src/a.ts", hit: 9, found: 10 }]));
    expect(findRegressions(baseline, current, 0.005)).toEqual([]);
  });

  it("flags a real regression beyond the slack window", () => {
    const baseline = parseLcov(lcov([{ path: "src/a.ts", hit: 8, found: 10 }]));
    const current = parseLcov(lcov([{ path: "src/a.ts", hit: 5, found: 10 }]));
    const r = findRegressions(baseline, current, 0.005);
    expect(r.length).toBe(1);
    expect(r[0].path).toBe("src/a.ts");
    expect(r[0].baselineRatio).toBe(0.8);
    expect(r[0].currentRatio).toBe(0.5);
    expect(r[0].delta).toBeCloseTo(-0.3, 5);
  });

  it("absorbs sub-slack noise (no spurious regressions)", () => {
    // 0.5 pp slack absorbs the typical lcov floating-point jitter.
    const baseline = parseLcov(
      lcov([{ path: "src/a.ts", hit: 870, found: 1000 }]),
    );
    const current = parseLcov(
      lcov([{ path: "src/a.ts", hit: 868, found: 1000 }]), // -0.2 pp
    );
    expect(findRegressions(baseline, current, 0.005)).toEqual([]);
  });

  it("ignores files present in baseline but missing from current (rename / delete)", () => {
    // We don't fail the gate on missing files — the reviewer catches
    // a rename via the diff, and a deletion is a deliberate action.
    const baseline = parseLcov(
      lcov([
        { path: "src/a.ts", hit: 5, found: 10 },
        { path: "src/b.ts", hit: 5, found: 10 },
      ]),
    );
    const current = parseLcov(lcov([{ path: "src/a.ts", hit: 5, found: 10 }]));
    expect(findRegressions(baseline, current, 0.005)).toEqual([]);
  });

  it("ignores new files added to current (only-baseline-direction gate)", () => {
    const baseline = parseLcov(lcov([{ path: "src/a.ts", hit: 5, found: 10 }]));
    const current = parseLcov(
      lcov([
        { path: "src/a.ts", hit: 5, found: 10 },
        { path: "src/new.ts", hit: 0, found: 10 },
      ]),
    );
    expect(findRegressions(baseline, current, 0.005)).toEqual([]);
  });
});
