/**
 * Unit tests for the module-size ratchet (§3.6,
 * doc/full_app_review_2026-08.md).
 *
 * The ratchet's whole value is that it behaves differently for a file that
 * is already oversized (may shrink, never grow) versus a brand-new one
 * (must be born under the cap). Both directions are pinned here, plus the
 * live repo check so a bad baseline can't ship green.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CAP, checkSizes, collectSizes } from "../scripts/audit-module-size";

const BASELINE = resolve(
  import.meta.dir,
  "baselines",
  "module-size-baseline.json",
);

describe("checkSizes", () => {
  test("a small unbaselined file is fine", () => {
    const r = checkSizes(new Map([["src/small.ts", 100]]), {});
    expect(r.violations).toEqual([]);
  });

  test("a NEW file over the cap is a violation", () => {
    const r = checkSizes(new Map([["src/big.ts", CAP + 1]]), {});
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.allowed).toBeNull();
  });

  test("a baselined file may sit exactly at its ceiling", () => {
    const r = checkSizes(new Map([["src/god.ts", 3000]]), {
      "src/god.ts": 3000,
    });
    expect(r.violations).toEqual([]);
  });

  test("a baselined file may NOT grow by even one line", () => {
    const r = checkSizes(new Map([["src/god.ts", 3001]]), {
      "src/god.ts": 3000,
    });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({ lines: 3001, allowed: 3000 });
  });

  test("a baselined file that shrinks is reported as improvement, not violation", () => {
    const r = checkSizes(new Map([["src/god.ts", 2500]]), {
      "src/god.ts": 3000,
    });
    expect(r.violations).toEqual([]);
    expect(r.improved).toEqual([
      { path: "src/god.ts", lines: 2500, allowed: 3000 },
    ]);
  });

  test("a baseline entry whose file is gone is stale, not a violation", () => {
    const r = checkSizes(new Map(), { "src/deleted.ts": 3000 });
    expect(r.violations).toEqual([]);
    expect(r.stale).toEqual(["src/deleted.ts"]);
  });

  test("violations are ordered biggest-first", () => {
    const r = checkSizes(
      new Map([
        ["src/a.ts", CAP + 10],
        ["src/b.ts", CAP + 900],
        ["src/c.ts", CAP + 400],
      ]),
      {},
    );
    expect(r.violations.map((v) => v.path)).toEqual([
      "src/b.ts",
      "src/c.ts",
      "src/a.ts",
    ]);
  });
});

describe("the live repository", () => {
  test("passes its own ratchet", () => {
    const baseline = JSON.parse(readFileSync(BASELINE, "utf-8")) as Record<
      string,
      number
    >;
    const { violations } = checkSizes(collectSizes(), baseline);
    expect(violations).toEqual([]);
  });

  test("every baseline entry is genuinely over the cap", () => {
    // Guards against a `--promote` run that accidentally recorded small
    // files, which would silently pin them and defeat the cap.
    const baseline = JSON.parse(readFileSync(BASELINE, "utf-8")) as Record<
      string,
      number
    >;
    const underCap = Object.entries(baseline).filter(([, n]) => n <= CAP);
    expect(underCap).toEqual([]);
  });
});
