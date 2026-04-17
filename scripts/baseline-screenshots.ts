#!/usr/bin/env bun
/**
 * Snapshot the current screenshot set as the baseline for future diffs.
 *
 *   bun run screenshots:baseline
 *
 * Copies `test-results/screenshots-index.jsonl` + all referenced PNGs
 * into `test-results/baseline/`, a git-ignored directory the diff script
 * reads against. Typical workflow:
 *
 *   bun run test:native:design-review
 *   bun run screenshots:baseline   # freeze a reference
 *   # ... make UI changes ...
 *   bun run test:native:design-review
 *   bun run screenshots:diff       # compare against the frozen baseline
 *
 * For CI, the opt-in `pixel-diff` job downloads the baseline artifact from
 * a previous main build instead of computing it locally.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const INDEX_PATH = join(REPO_ROOT, "test-results/screenshots-index.jsonl");
// Baseline lives OUTSIDE test-results/ because Playwright wipes that dir
// at the start of every run. `.screenshot-baseline/` is gitignored.
const BASELINE_DIR = join(REPO_ROOT, ".screenshot-baseline");
const BASELINE_INDEX = join(BASELINE_DIR, "index.jsonl");
const BASELINE_IMAGES = join(BASELINE_DIR, "images");

interface IndexEntry {
  timestamp: string;
  spec: string;
  test: string;
  testSlug: string;
  step: string;
  path: string;
  state?: Record<string, unknown>;
  annotate?: Record<string, unknown>;
}

if (!existsSync(INDEX_PATH)) {
  console.error(
    `[baseline] no index at ${relative(REPO_ROOT, INDEX_PATH)} — ` +
      `run \`bun run test:native:design-review\` first`,
  );
  process.exit(1);
}

if (existsSync(BASELINE_DIR)) rmSync(BASELINE_DIR, { recursive: true });
mkdirSync(BASELINE_IMAGES, { recursive: true });

const entries: IndexEntry[] = [];
for (const line of readFileSync(INDEX_PATH, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  try {
    entries.push(JSON.parse(trimmed));
  } catch {
    /* skip malformed */
  }
}

// Same "latest per key" rule as the design-review generator.
const latest = new Map<string, IndexEntry>();
for (const e of entries) {
  const key = `${e.spec}::${e.test}::${e.step}`;
  const prior = latest.get(key);
  if (!prior || new Date(prior.timestamp) < new Date(e.timestamp)) {
    latest.set(key, e);
  }
}

const outLines: string[] = [];
let copied = 0;
let missing = 0;
for (const e of latest.values()) {
  if (!existsSync(e.path)) {
    missing++;
    continue;
  }
  const imgName = `${e.spec.replace(/\W+/g, "_")}-${e.testSlug}-${e.step}${extForPath(e.path)}`;
  const dest = join(BASELINE_IMAGES, imgName);
  copyFileSync(e.path, dest);
  outLines.push(
    JSON.stringify({
      ...e,
      // Rewrite path to a baseline-relative one so the diff script doesn't
      // have to re-resolve.
      path: relative(REPO_ROOT, dest),
    }),
  );
  copied++;
}
writeFileSync(BASELINE_INDEX, outLines.join("\n") + "\n");
console.log(
  `[baseline] copied ${copied} screenshot(s), ${missing} missing, ` +
    `wrote ${relative(REPO_ROOT, BASELINE_INDEX)}`,
);

function extForPath(path: string): string {
  const b = basename(path);
  const dot = b.lastIndexOf(".");
  return dot === -1 ? "" : b.slice(dot);
}
