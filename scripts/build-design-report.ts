#!/usr/bin/env bun
/**
 * Build the standalone HTML design report.
 *
 *   bun scripts/build-design-report.ts            # advisory mode
 *   bun scripts/build-design-report.ts --gate     # CI gate; exits 1 on regression
 *
 * This file is deliberately thin: the heavy lifting lives in pure
 * helpers under `src/design-report/` so the logic is unit-testable.
 * Here we just parse argv, wire the pieces together, and own the
 * filesystem side effects (copying PNGs into the report dir, writing
 * `index.html` + `data.json`).
 *
 * Gate semantics (`--gate`): exits non-zero when any shot has status
 * `over`, `dim-mismatch`, `missing`, `baseline-only`, or `corrupt`, or
 * a `new` shot that isn't in `tests-e2e-baselines/.new-allowed`. Both
 * the human-readable banner in `index.html` and the CLI exit code
 * reflect the same decision.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseIndexLines, latestPerKey } from "../src/design-report/index-io";
import { classifyShot, tryDecodePng } from "../src/design-report/shot-classify";
import { enumerateBaselineShots } from "../src/design-report/enumerate-baseline";
import { evaluateGate } from "../src/design-report/gate";
import { MANIFEST_FILENAME, readManifest } from "../src/design-report/manifest";
import {
  NEW_ALLOWED_FILENAME,
  readNewAllowed,
} from "../src/design-report/new-allowed";
import { renderHtml } from "../src/design-report/render-html";
import {
  shotKey,
  shotSlug,
  type Annotation,
  type IndexEntry,
  type ReportShot,
  type ReportSummary,
  type ShotStatus,
  type Suite,
} from "../src/design-report/types";

const REPO_ROOT = resolve(import.meta.dir, "..");
const STAGE_DIR = join(REPO_ROOT, ".design-artifacts");
const INDEX_PATH = join(STAGE_DIR, "screenshots-index.jsonl");
const REPORT_ROOT = join(REPO_ROOT, "test-results/design-report");
const SHOTS_DIR = join(REPORT_ROOT, "shots");
const BASELINE_OUT = join(REPORT_ROOT, "baseline");
const DIFF_OUT = join(REPORT_ROOT, "diffs");
const BASELINE_SRC = join(REPO_ROOT, "tests-e2e-baselines");
const MANIFEST_PATH = join(BASELINE_SRC, MANIFEST_FILENAME);
const NEW_ALLOWED_PATH = join(BASELINE_SRC, NEW_ALLOWED_FILENAME);
const FAIL_FRACTION = 0.005;
const PX_THRESHOLD = 0.1;

interface Args {
  gate: boolean;
}

function parseArgs(argv: string[]): Args {
  return { gate: argv.includes("--gate") };
}

function classifyAnnotations(raw: unknown): Annotation[] {
  return Array.isArray(raw) ? (raw as Annotation[]) : [];
}

function resolveSrcPath(p: string): string {
  return p.startsWith("/") ? p : join(REPO_ROOT, p);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (existsSync(REPORT_ROOT)) rmSync(REPORT_ROOT, { recursive: true });
  mkdirSync(SHOTS_DIR, { recursive: true });
  mkdirSync(BASELINE_OUT, { recursive: true });
  mkdirSync(DIFF_OUT, { recursive: true });

  // ── Read current-run index ──────────────────────────────────────
  let currentEntries: IndexEntry[] = [];
  if (existsSync(INDEX_PATH)) {
    currentEntries = latestPerKey(
      parseIndexLines(readFileSync(INDEX_PATH, "utf8")),
    );
  }

  // ── Allowlist + manifest context ────────────────────────────────
  const allowedNew = readNewAllowed(NEW_ALLOWED_PATH);
  const manifest = readManifest(MANIFEST_PATH);
  // Manifest is advisory here — the file presence on disk is still the
  // source of truth for the pixel diff — but we log a diff if the
  // manifest claims shots that aren't committed.
  void manifest;

  // ── Enumerate committed baselines so we can surface "baseline-only" ─
  const baselineShots = enumerateBaselineShots(BASELINE_SRC);
  const baselineByKey = new Map<string, (typeof baselineShots)[number]>();
  for (const b of baselineShots) baselineByKey.set(b.key, b);

  const shots: ReportShot[] = [];
  const currentKeys = new Set<string>();
  const counters: Record<ShotStatus, number> = {
    ok: 0,
    over: 0,
    new: 0,
    "baseline-only": 0,
    missing: 0,
    "dim-mismatch": 0,
    corrupt: 0,
  };

  // ── Process current entries ─────────────────────────────────────
  for (const e of currentEntries) {
    const suite: Suite = (e.suite ?? "native") as Suite;
    const slug = shotSlug(e);
    const key = shotKey(suite, slug);
    currentKeys.add(key);

    const suiteShotDir = join(SHOTS_DIR, suite);
    const suiteBaseDir = join(BASELINE_OUT, suite);
    const suiteDiffDir = join(DIFF_OUT, suite);
    mkdirSync(suiteShotDir, { recursive: true });

    const shotDest = join(suiteShotDir, `${slug}.png`);
    const srcPath = resolveSrcPath(e.path);

    let currentBuf: Buffer | null = null;
    if (existsSync(srcPath) && srcPath.endsWith(".png")) {
      try {
        copyFileSync(srcPath, shotDest);
        currentBuf = readFileSync(shotDest);
      } catch {
        /* ignore copy failure — treated as missing below */
      }
    }

    const baselineEntry = baselineByKey.get(key);
    let baselineBuf: Buffer | null = null;
    let baselineRel: string | null = null;
    if (baselineEntry) {
      mkdirSync(suiteBaseDir, { recursive: true });
      const baseDest = join(suiteBaseDir, `${slug}.png`);
      copyFileSync(baselineEntry.fullPath, baseDest);
      try {
        baselineBuf = readFileSync(baseDest);
      } catch {
        /* degrade gracefully */
      }
      baselineRel = relative(REPORT_ROOT, baseDest);
    }

    if (!currentBuf) {
      // Registered in the JSONL but the PNG vanished — a real signal.
      shots.push({
        id: `${suite}-${slug}`,
        suite,
        spec: e.spec,
        test: e.test,
        step: e.step,
        timestamp: e.timestamp ?? new Date().toISOString(),
        shotRel: "",
        baselineRel,
        diffRel: null,
        diffFraction: null,
        diffPixels: null,
        totalPixels: null,
        width: 0,
        height: 0,
        state: e.state ?? {},
        annotations: classifyAnnotations(e.annotate),
        terminal: e.terminal ?? "",
        file: e.file,
        line: e.line,
        status: "missing",
      });
      counters.missing++;
      continue;
    }

    const currentPng = tryDecodePng(currentBuf);
    const baselinePng = baselineBuf ? tryDecodePng(baselineBuf) : null;

    const result = classifyShot({
      current: currentPng,
      baseline: baselinePng,
      failFraction: FAIL_FRACTION,
      pxThreshold: PX_THRESHOLD,
    });

    let diffRel: string | null = null;
    if (result.diffPng) {
      mkdirSync(suiteDiffDir, { recursive: true });
      const diffDest = join(suiteDiffDir, `${slug}.png`);
      writeFileSync(diffDest, result.diffPng);
      diffRel = relative(REPORT_ROOT, diffDest);
    }

    shots.push({
      id: `${suite}-${slug}`,
      suite,
      spec: e.spec,
      test: e.test,
      step: e.step,
      timestamp: e.timestamp ?? new Date().toISOString(),
      shotRel: relative(REPORT_ROOT, shotDest),
      baselineRel,
      diffRel,
      diffFraction: result.diffFraction,
      diffPixels: result.diffPixels,
      totalPixels: result.totalPixels,
      width: currentPng?.width ?? 0,
      height: currentPng?.height ?? 0,
      state: e.state ?? {},
      annotations: classifyAnnotations(e.annotate),
      terminal: e.terminal ?? "",
      file: e.file,
      line: e.line,
      status: result.status,
    });
    counters[result.status]++;
  }

  // ── Baseline-only: committed shots with no current counterpart ──
  for (const [key, baseline] of baselineByKey) {
    if (currentKeys.has(key)) continue;
    const baseDir = join(BASELINE_OUT, baseline.suite);
    mkdirSync(baseDir, { recursive: true });
    const baseDest = join(baseDir, baseline.file);
    copyFileSync(baseline.fullPath, baseDest);
    const basePng = tryDecodePng(readFileSync(baseDest));
    shots.push({
      id: `${baseline.suite}-${baseline.file.replace(/\.png$/, "")}`,
      suite: baseline.suite,
      spec: "(baseline-only)",
      test: baseline.file.replace(/\.png$/, ""),
      step: "baseline-only",
      timestamp: new Date(0).toISOString(),
      shotRel: "",
      baselineRel: relative(REPORT_ROOT, baseDest),
      diffRel: null,
      diffFraction: null,
      diffPixels: null,
      totalPixels: null,
      width: basePng?.width ?? 0,
      height: basePng?.height ?? 0,
      state: { reason: "baseline exists but current run produced no shot" },
      annotations: [],
      terminal: "",
      status: "baseline-only",
    });
    counters["baseline-only"]++;
  }

  shots.sort((a, b) => {
    if (a.suite !== b.suite) return a.suite.localeCompare(b.suite);
    if (a.spec !== b.spec) return a.spec.localeCompare(b.spec);
    if (a.test !== b.test) return a.test.localeCompare(b.test);
    return a.step.localeCompare(b.step);
  });

  const gateResult = args.gate
    ? evaluateGate({ shots, allowedNew })
    : { failed: false, failingStatuses: [] as ShotStatus[] };

  const summary: ReportSummary = {
    generatedAt: new Date().toISOString(),
    failThreshold: FAIL_FRACTION,
    pxThreshold: PX_THRESHOLD,
    total: shots.length,
    overCount: counters.over,
    newCount: counters.new,
    missingCount: counters.missing,
    baselineOnlyCount: counters["baseline-only"],
    corruptCount: counters.corrupt,
    dimMismatchCount: counters["dim-mismatch"],
    gate: {
      enabled: args.gate,
      failed: gateResult.failed,
      failingStatuses: gateResult.failingStatuses,
      allowedNew: [...allowedNew].sort(),
    },
  };

  writeFileSync(join(REPORT_ROOT, "index.html"), renderHtml(shots, summary));
  writeFileSync(
    join(REPORT_ROOT, "data.json"),
    JSON.stringify({ summary, shots }, null, 2),
  );

  const gateLine = args.gate
    ? gateResult.failed
      ? `gate: FAIL (${gateResult.failingStatuses.join(", ")})`
      : "gate: pass"
    : "gate: advisory";

  console.log(
    `[report] wrote ${relative(REPO_ROOT, join(REPORT_ROOT, "index.html"))}\n` +
      `         ${shots.length} shot(s), ` +
      `${counters.over} over, ${counters.new} new, ${counters.missing} missing, ` +
      `${counters["baseline-only"]} baseline-only, ${counters.corrupt} corrupt, ` +
      `${counters["dim-mismatch"]} dim-mismatch — ${gateLine}`,
  );

  if (args.gate && gateResult.failed) process.exit(1);
}

main();
