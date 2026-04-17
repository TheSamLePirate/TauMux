#!/usr/bin/env bun
/**
 * Pixel-diff the current screenshot set against a frozen baseline.
 *
 *   bun run screenshots:baseline   # once
 *   # ... changes ...
 *   bun run test:native:design-review
 *   bun run screenshots:diff
 *
 * Emits `test-results/screenshot-diff/index.md` with one section per
 * test, embedding baseline + current + diff PNGs side-by-side and
 * reporting the percentage of mismatched pixels. Exit code is 1 when
 * any image exceeds `--threshold` (default 1% of pixels).
 *
 * Designed as the backing script for a `[screenshot-diff]` PR label
 * (doc/native-e2e-plan.md §7.6). Behind an opt-in label because pixel
 * comparisons are noisy on CI — font smoothing and accent-colour drift
 * alone can produce sub-1% false positives that aren't worth surfacing
 * by default.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const REPO_ROOT = resolve(import.meta.dir, "..");
// Matches scripts/baseline-screenshots.ts — baseline lives outside
// test-results/ to survive Playwright's per-run wipe.
const BASELINE_INDEX = join(REPO_ROOT, ".screenshot-baseline/index.jsonl");
const CURRENT_INDEX = join(REPO_ROOT, "test-results/screenshots-index.jsonl");
const OUT_DIR = join(REPO_ROOT, "test-results/screenshot-diff");
const OUT_IMAGES = join(OUT_DIR, "images");
const OUT_MD = join(OUT_DIR, "index.md");

const args = process.argv.slice(2);
const thresholdArg = args.find((a) => a.startsWith("--threshold="));
// Default threshold: 1% of pixels. Below this, report but don't fail.
const failThreshold = thresholdArg
  ? parseFloat(thresholdArg.slice("--threshold=".length))
  : 0.01;
// pixelmatch's per-pixel colour threshold (0..1). 0.1 tolerates small
// anti-aliasing drift; raise for very noisy renderers.
const pxThreshold = 0.1;

interface IndexEntry {
  timestamp?: string;
  spec: string;
  test: string;
  testSlug: string;
  step: string;
  path: string;
}

if (!existsSync(BASELINE_INDEX)) {
  console.error(
    `[diff] no baseline at ${relative(REPO_ROOT, BASELINE_INDEX)} — ` +
      `run \`bun run screenshots:baseline\` first`,
  );
  process.exit(1);
}
if (!existsSync(CURRENT_INDEX)) {
  console.error(
    `[diff] no current index — run \`bun run test:native:design-review\` first`,
  );
  process.exit(1);
}

mkdirSync(OUT_IMAGES, { recursive: true });

function readIndex(path: string): Map<string, IndexEntry> {
  const map = new Map<string, IndexEntry>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed) as IndexEntry;
      const key = `${e.spec}::${e.test}::${e.step}`;
      const prior = map.get(key);
      if (
        !prior ||
        (e.timestamp &&
          prior.timestamp &&
          new Date(prior.timestamp) < new Date(e.timestamp))
      ) {
        map.set(key, e);
      }
    } catch {
      /* skip */
    }
  }
  return map;
}

const baseline = readIndex(BASELINE_INDEX);
const current = readIndex(CURRENT_INDEX);

// Resolve paths relative to REPO_ROOT; baseline index stores relative
// paths, current stores absolute.
const resolvePath = (p: string): string =>
  p.startsWith("/") ? p : join(REPO_ROOT, p);

interface DiffResult {
  key: string;
  spec: string;
  test: string;
  step: string;
  mismatchedPixels: number;
  totalPixels: number;
  mismatchFraction: number;
  baselinePath: string;
  currentPath: string;
  diffPath: string;
}

const results: DiffResult[] = [];
const missingInCurrent: string[] = [];
const missingInBaseline: string[] = [];
const failures: DiffResult[] = [];

for (const [key, base] of baseline) {
  const cur = current.get(key);
  if (!cur) {
    missingInCurrent.push(key);
    continue;
  }
  const basePath = resolvePath(base.path);
  const curPath = resolvePath(cur.path);
  if (!existsSync(basePath) || !existsSync(curPath)) {
    missingInCurrent.push(key);
    continue;
  }
  if (!basePath.endsWith(".png") || !curPath.endsWith(".png")) {
    // Placeholder (text) — can't diff; record as "no diff possible".
    continue;
  }

  const basePng = PNG.sync.read(readFileSync(basePath));
  const curPng = PNG.sync.read(readFileSync(curPath));
  // Dimensional mismatch (window resized, retina factor change) is a
  // regression signal in itself. Report it as 100% mismatch so reviewers
  // see it at the top of the list.
  if (basePng.width !== curPng.width || basePng.height !== curPng.height) {
    const diffPath = copyBoth(basePath, curPath, base, "dim-mismatch");
    const result: DiffResult = {
      key,
      spec: base.spec,
      test: base.test,
      step: base.step,
      mismatchedPixels: basePng.width * basePng.height,
      totalPixels: basePng.width * basePng.height,
      mismatchFraction: 1,
      baselinePath: basePath,
      currentPath: curPath,
      diffPath,
    };
    results.push(result);
    failures.push(result);
    continue;
  }

  const { width, height } = basePng;
  const diff = new PNG({ width, height });
  const mismatchedPixels = pixelmatch(
    basePng.data,
    curPng.data,
    diff.data,
    width,
    height,
    { threshold: pxThreshold },
  );
  const totalPixels = width * height;
  const fraction = mismatchedPixels / totalPixels;
  const slug = `${base.spec.replace(/\W+/g, "_")}-${base.testSlug}-${base.step}`;
  const diffOutPath = join(OUT_IMAGES, `${slug}.diff.png`);
  writeFileSync(diffOutPath, PNG.sync.write(diff));
  // Also copy the baseline + current in so the markdown can reference
  // them relative to the report.
  copyFileSync(basePath, join(OUT_IMAGES, `${slug}.baseline.png`));
  copyFileSync(curPath, join(OUT_IMAGES, `${slug}.current.png`));
  const result: DiffResult = {
    key,
    spec: base.spec,
    test: base.test,
    step: base.step,
    mismatchedPixels,
    totalPixels,
    mismatchFraction: fraction,
    baselinePath: basePath,
    currentPath: curPath,
    diffPath: diffOutPath,
  };
  results.push(result);
  if (fraction > failThreshold) failures.push(result);
}

for (const key of current.keys()) {
  if (!baseline.has(key)) missingInBaseline.push(key);
}

results.sort((a, b) => b.mismatchFraction - a.mismatchFraction);

const md: string[] = [];
md.push(`# Screenshot diff — ${new Date().toISOString()}`);
md.push("");
md.push(
  `${results.length} comparison(s) · ${failures.length} over threshold ` +
    `(> ${(failThreshold * 100).toFixed(2)}%) · ${missingInCurrent.length} baseline-only · ` +
    `${missingInBaseline.length} current-only.`,
);
md.push("");
md.push(
  "Per-pixel threshold: " +
    pxThreshold +
    " (pixelmatch default; raise to tolerate more anti-aliasing drift).",
);
md.push("");

if (missingInBaseline.length > 0) {
  md.push("## New screenshots (no baseline)");
  md.push("");
  for (const k of missingInBaseline) md.push(`- \`${k}\``);
  md.push("");
}
if (missingInCurrent.length > 0) {
  md.push("## Missing screenshots (in baseline, not current)");
  md.push("");
  for (const k of missingInCurrent) md.push(`- \`${k}\``);
  md.push("");
}

if (results.length === 0) {
  md.push("_No matched pairs to diff._");
} else {
  md.push("## Diffs");
  md.push("");
  for (const r of results) {
    const slug = `${r.spec.replace(/\W+/g, "_")}-${r.test.replace(/\W+/g, "_")}-${r.step}`;
    const status = r.mismatchFraction > failThreshold ? "⚠️ **over**" : "OK";
    md.push(
      `### ${r.test} — \`${r.step}\` (${(r.mismatchFraction * 100).toFixed(2)}% — ${status})`,
    );
    md.push("");
    md.push(`spec: \`${r.spec}\``);
    md.push("");
    md.push("| baseline | current | diff |");
    md.push("|---|---|---|");
    md.push(
      `| ![](images/${slug}.baseline.png) | ![](images/${slug}.current.png) | ![](images/${slug}.diff.png) |`,
    );
    md.push("");
  }
}

writeFileSync(OUT_MD, md.join("\n"));
console.log(
  `[diff] wrote ${relative(REPO_ROOT, OUT_MD)} — ` +
    `${results.length} comparisons, ${failures.length} over threshold`,
);

if (failures.length > 0) process.exit(1);

function copyBoth(
  basePath: string,
  curPath: string,
  e: IndexEntry,
  kind: string,
): string {
  const slug = `${e.spec.replace(/\W+/g, "_")}-${e.testSlug}-${e.step}-${kind}`;
  const baseDest = join(OUT_IMAGES, `${slug}.baseline.png`);
  const curDest = join(OUT_IMAGES, `${slug}.current.png`);
  try {
    copyFileSync(basePath, baseDest);
  } catch {
    /* ignore */
  }
  try {
    copyFileSync(curPath, curDest);
  } catch {
    /* ignore */
  }
  return baseDest;
}

// Silence unused-import warning for basename in strict lint configs.
void basename;
