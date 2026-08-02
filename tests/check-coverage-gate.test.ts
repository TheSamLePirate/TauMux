/**
 * Unit tests for the per-file coverage gate (`scripts/check-coverage.ts`).
 *
 * The gate is the thing that stops coverage silently rotting, so its own
 * logic needs to be pinned — especially the blind spot found in §3.2 of
 * doc/full_app_review_2026-08.md: `findRegressions` iterates the BASELINE,
 * so any file added after the last promotion was never examined and the
 * gate quietly narrowed to a shrinking subset of the codebase while
 * reporting success.
 */

import { describe, expect, test } from "bun:test";
import {
  findRegressions,
  findUnbaselined,
  parseLcov,
  ratio,
} from "../scripts/check-coverage";

/** Build a minimal lcov body: [path, linesFound, linesHit][]. */
function lcov(rows: [string, number, number][]): string {
  return rows
    .map(([path, lf, lh]) => `SF:${path}\nLF:${lf}\nLH:${lh}\nend_of_record`)
    .join("\n");
}

describe("parseLcov", () => {
  test("reads path / found / hit per record", () => {
    const m = parseLcov(lcov([["src/a.ts", 100, 75]]));
    expect(m.size).toBe(1);
    expect(m.get("src/a.ts")).toEqual({
      path: "src/a.ts",
      linesFound: 100,
      linesHit: 75,
    });
    expect(ratio(m.get("src/a.ts")!)).toBeCloseTo(0.75, 5);
  });

  test("a file with no measurable lines is not a division by zero", () => {
    const m = parseLcov(lcov([["src/empty.ts", 0, 0]]));
    expect(Number.isFinite(ratio(m.get("src/empty.ts")!))).toBe(true);
  });
});

describe("findRegressions", () => {
  const slack = 0.005; // 0.5 pp, the script's default

  test("flags a file that dropped beyond slack", () => {
    const base = parseLcov(lcov([["src/a.ts", 100, 90]]));
    const now = parseLcov(lcov([["src/a.ts", 100, 70]]));
    const regs = findRegressions(base, now, slack);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.path).toBe("src/a.ts");
    expect(regs[0]!.delta).toBeCloseTo(-0.2, 5);
  });

  test("tolerates a drop within slack", () => {
    const base = parseLcov(lcov([["src/a.ts", 1000, 900]]));
    const now = parseLcov(lcov([["src/a.ts", 1000, 897]])); // -0.3 pp
    expect(findRegressions(base, now, slack)).toEqual([]);
  });

  test("an improvement is never a regression", () => {
    const base = parseLcov(lcov([["src/a.ts", 100, 50]]));
    const now = parseLcov(lcov([["src/a.ts", 100, 95]]));
    expect(findRegressions(base, now, slack)).toEqual([]);
  });

  test("a deleted / renamed file does not fail the gate", () => {
    const base = parseLcov(lcov([["src/gone.ts", 100, 90]]));
    const now = parseLcov(lcov([["src/kept.ts", 100, 90]]));
    expect(findRegressions(base, now, slack)).toEqual([]);
  });

  test("§3.2 — a brand-new file is invisible to the regression check", () => {
    // This is the documented behaviour, not a bug: there is no "before"
    // to regress from. It is *why* findUnbaselined has to exist.
    const base = parseLcov(lcov([["src/a.ts", 100, 90]]));
    const now = parseLcov(
      lcov([
        ["src/a.ts", 100, 90],
        ["src/brand-new.ts", 900, 0], // 0 % and 900 lines — still passes
      ]),
    );
    expect(findRegressions(base, now, slack)).toEqual([]);
  });
});

describe("findUnbaselined (§3.2)", () => {
  test("reports files measured now but absent from the baseline", () => {
    const base = parseLcov(lcov([["src/a.ts", 100, 90]]));
    const now = parseLcov(
      lcov([
        ["src/a.ts", 100, 90],
        ["src/new.ts", 200, 10],
      ]),
    );
    const drift = findUnbaselined(base, now);
    expect(drift.map((f) => f.path)).toEqual(["src/new.ts"]);
  });

  test("orders by size so the biggest blind spot is reported first", () => {
    const base = parseLcov(lcov([["src/a.ts", 10, 10]]));
    const now = parseLcov(
      lcov([
        ["src/a.ts", 10, 10],
        ["src/small.ts", 50, 0],
        ["src/huge.ts", 900, 0],
        ["src/mid.ts", 300, 0],
      ]),
    );
    expect(findUnbaselined(base, now).map((f) => f.path)).toEqual([
      "src/huge.ts",
      "src/mid.ts",
      "src/small.ts",
    ]);
  });

  test("a fully-promoted baseline reports no drift", () => {
    const rows: [string, number, number][] = [
      ["src/a.ts", 100, 90],
      ["src/b.ts", 50, 25],
    ];
    expect(
      findUnbaselined(parseLcov(lcov(rows)), parseLcov(lcov(rows))),
    ).toEqual([]);
  });

  test("a file dropped from the build is not reported as drift", () => {
    const base = parseLcov(lcov([["src/gone.ts", 100, 90]]));
    const now = parseLcov(lcov([]));
    expect(findUnbaselined(base, now)).toEqual([]);
  });
});
