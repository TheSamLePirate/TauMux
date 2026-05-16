#!/usr/bin/env bun
/**
 * Phase 3 Step 1 — coverage gate.
 *
 * Compares the freshly-generated `coverage/lcov.info` against the
 * Phase 0 baseline at `tests/baselines/coverage-baseline.lcov`. Fails
 * if any *covered* file's lines-hit-ratio dropped below the baseline.
 *
 * Modes:
 *   bun run report:coverage:check    Gate. Exit 1 on regression.
 *   bun run baseline:coverage        Promote current lcov to baseline.
 *
 * The gate intentionally compares per-file rather than overall — an
 * overall threshold can hide regressions inside a "covered enough"
 * average. Per-file means "no file may go backwards from where it
 * stood at Phase 0 close." Promotion is the only way to lower the
 * floor, and promotion goes through code review.
 *
 * Slack defaults to 0.5 percentage points to absorb floating-point
 * rounding noise across runs (lcov ratios are floating-point
 * percentages; identical code paths can yield 86.95% vs 86.96% under
 * different test orders).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const CURRENT = resolve(REPO_ROOT, "coverage/lcov.info");
const BASELINE = resolve(REPO_ROOT, "tests/baselines/coverage-baseline.lcov");

/** Per-file coverage snapshot. */
export interface FileCoverage {
  /** Path as recorded in the lcov SF: directive. Repo-relative. */
  path: string;
  /** Lines hit (covered). */
  linesHit: number;
  /** Lines found (instrumented). */
  linesFound: number;
}

/** Ratio of hit/found. 0 when nothing was instrumented (a generated
 *  empty file). Avoids NaN on the gate side. */
export function ratio(c: FileCoverage): number {
  return c.linesFound === 0 ? 0 : c.linesHit / c.linesFound;
}

/** Parse an lcov.info string into a per-file map. lcov is a simple
 *  line-oriented format: each file starts with `SF:<path>`, has
 *  `DA:<line>,<count>` per line, `LH:<hit>` / `LF:<found>` summaries,
 *  and ends with `end_of_record`. We only need SF / LH / LF. */
export function parseLcov(raw: string): Map<string, FileCoverage> {
  const out = new Map<string, FileCoverage>();
  let current: FileCoverage | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("SF:")) {
      current = { path: line.slice(3).trim(), linesHit: 0, linesFound: 0 };
    } else if (line.startsWith("LH:") && current) {
      current.linesHit = Number(line.slice(3)) || 0;
    } else if (line.startsWith("LF:") && current) {
      current.linesFound = Number(line.slice(3)) || 0;
    } else if (line === "end_of_record" && current) {
      out.set(current.path, current);
      current = null;
    }
  }
  return out;
}

export interface Regression {
  path: string;
  baselineRatio: number;
  currentRatio: number;
  delta: number; // currentRatio - baselineRatio (negative on regression)
}

/** Compare two coverage snapshots. Returns the list of files that
 *  regressed beyond the slack tolerance. */
export function findRegressions(
  baseline: Map<string, FileCoverage>,
  current: Map<string, FileCoverage>,
  slack: number,
): Regression[] {
  const regressions: Regression[] = [];
  for (const [path, b] of baseline) {
    const c = current.get(path);
    if (!c) {
      // File present in baseline but not in current. Likely deleted
      // or renamed. We don't fail on this — the reviewer will spot a
      // missing file via the diff, and a renamed file shouldn't fail
      // the gate.
      continue;
    }
    const br = ratio(b);
    const cr = ratio(c);
    const delta = cr - br;
    if (delta < -slack) {
      regressions.push({
        path,
        baselineRatio: br,
        currentRatio: cr,
        delta,
      });
    }
  }
  return regressions;
}

function printRegression(r: Regression): void {
  const fmt = (n: number) => `${(n * 100).toFixed(2)}%`;
  console.error(
    `  ${r.path}  baseline=${fmt(r.baselineRatio)}  now=${fmt(r.currentRatio)}  Δ=${fmt(r.delta)}`,
  );
}

function main(): void {
  const mode = process.argv[2] === "--promote" ? "promote" : "check";
  const slack = parseSlack(process.argv);

  if (!existsSync(CURRENT)) {
    console.error(
      `[coverage] ${CURRENT} is missing. Run \`bun run test:coverage\` first.`,
    );
    process.exit(1);
  }

  const currentRaw = readFileSync(CURRENT, "utf-8");
  const current = parseLcov(currentRaw);

  if (mode === "promote") {
    // Promote the current lcov to the baseline. Bypasses the gate;
    // the reviewer of the resulting commit is the safety net.
    const baselineDir = dirname(BASELINE);
    if (!existsSync(baselineDir)) {
      console.error(`[coverage] ${baselineDir} does not exist.`);
      process.exit(1);
    }
    writeFileSync(BASELINE, currentRaw);
    console.log(`[coverage] promoted ${current.size} files to ${BASELINE}`);
    return;
  }

  if (!existsSync(BASELINE)) {
    console.error(
      `[coverage] ${BASELINE} is missing. Run \`bun run baseline:coverage\` to seed it.`,
    );
    process.exit(1);
  }

  const baselineRaw = readFileSync(BASELINE, "utf-8");
  const baseline = parseLcov(baselineRaw);

  const regressions = findRegressions(baseline, current, slack);
  if (regressions.length === 0) {
    console.log(
      `[coverage] all ${baseline.size} files at or above baseline (slack=${(slack * 100).toFixed(2)}pp).`,
    );
    return;
  }

  console.error(
    `[coverage] ${regressions.length} file(s) regressed below baseline (slack=${(slack * 100).toFixed(2)}pp):`,
  );
  for (const r of regressions) printRegression(r);
  console.error(
    `\nTo lower the floor intentionally: bun run baseline:coverage`,
  );
  process.exit(1);
}

function parseSlack(argv: string[]): number {
  const i = argv.indexOf("--slack");
  if (i === -1) return 0.005; // 0.5 pp default
  const v = Number(argv[i + 1]);
  if (!Number.isFinite(v)) {
    console.error(`[coverage] invalid --slack: ${argv[i + 1]}`);
    process.exit(1);
  }
  return v / 100;
}

// Run main only when invoked as a script — not when imported by tests.
if (import.meta.main) {
  main();
}
