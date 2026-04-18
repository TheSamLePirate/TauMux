#!/usr/bin/env bun
/**
 * Copy the most recent design-report shots into `tests-e2e-baselines/`
 * so subsequent runs pixel-diff against them. Also rebuilds the
 * manifest — a committed source-of-truth listing every expected shot
 * key so the auditor can detect drift.
 *
 *   bun run report:design      # generate test-results/design-report/
 *   bun run baseline:design    # promote those into tests-e2e-baselines/
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import {
  MANIFEST_FILENAME,
  writeManifest,
} from "../src/design-report/manifest";
import type { Manifest, Suite } from "../src/design-report/types";

const REPO_ROOT = resolve(import.meta.dir, "..");
const REPORT_SHOTS = join(REPO_ROOT, "test-results/design-report/shots");
const BASELINES = join(REPO_ROOT, "tests-e2e-baselines");
const MANIFEST_PATH = join(BASELINES, MANIFEST_FILENAME);

if (!existsSync(REPORT_SHOTS)) {
  console.error(
    `[baseline] no design-report shots at ${REPORT_SHOTS} — ` +
      `run \`bun run report:design\` first`,
  );
  process.exit(1);
}

// ── 1. Copy fresh shots from the most recent report ─────────────────
for (const suiteDir of readdirSync(REPORT_SHOTS, { withFileTypes: true })) {
  if (!suiteDir.isDirectory()) continue;
  const suite = suiteDir.name as Suite;
  if (suite !== "web" && suite !== "native") continue;
  const src = join(REPORT_SHOTS, suite);
  const dst = join(BASELINES, suite);
  if (existsSync(dst)) rmSync(dst, { recursive: true });
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log(
    `[baseline] ${suite}: promoted ${readdirSync(dst).length} shot(s) → ${dst}`,
  );
}

// ── 2. Rebuild the manifest from every PNG on disk ──────────────────
// Partial promotes (e.g. `report:design:web` → `baseline:design`) must
// NOT drop the other suite's committed shots from the manifest. We walk
// every subdirectory under `tests-e2e-baselines/` so the manifest
// always reflects what's actually committed.
const manifest: Manifest = {
  generatedAt: new Date().toISOString(),
  shots: [],
};
for (const suite of ["web", "native"] as Suite[]) {
  const dir = join(BASELINES, suite);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".png")) continue;
    const stem = file.replace(/\.png$/, "");
    const key = `${suite}::${stem}`;
    let width = 0;
    let height = 0;
    try {
      const png = PNG.sync.read(readFileSync(join(dir, file)));
      width = png.width;
      height = png.height;
    } catch {
      /* skip metadata — manifest still records the key */
    }
    // Best-effort test/step split: everything after the first dash is
    // the testSlug+step. We keep the full stem via `slug` too.
    const firstDash = stem.indexOf("-");
    const rest = firstDash === -1 ? stem : stem.slice(firstDash + 1);
    manifest.shots.push({
      key,
      suite,
      slug: stem,
      test: rest,
      step: rest,
      width,
      height,
    });
  }
}

manifest.shots.sort((a, b) => a.key.localeCompare(b.key));
writeManifest(MANIFEST_PATH, manifest);
console.log(
  `[baseline] wrote manifest with ${manifest.shots.length} shot(s) → ` +
    `${MANIFEST_PATH}`,
);
