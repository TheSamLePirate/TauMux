#!/usr/bin/env bun
/**
 * Audit `tests-e2e-baselines/manifest.json` against:
 *   1. the PNGs actually committed under `tests-e2e-baselines/<suite>/`
 *      — catches files deleted or added without re-promoting.
 *   2. the shot names declared in each spec file — catches tests that
 *      claim a shot the baseline doesn't have.
 *
 *   bun scripts/audit-design-baselines.ts           # log + report
 *   bun scripts/audit-design-baselines.ts --strict  # exit 1 on mismatch
 *
 * Wire into CI via `test:design:audit` when you want the discrepancy to
 * block a merge.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { MANIFEST_FILENAME, readManifest } from "../src/design-report/manifest";
import {
  NEW_ALLOWED_FILENAME,
  readNewAllowed,
} from "../src/design-report/new-allowed";
import type { Suite } from "../src/design-report/types";
import { ACTIVE_DEMOS } from "../tests-e2e/design/helpers/demos";

const REPO_ROOT = resolve(import.meta.dir, "..");
const BASELINES = join(REPO_ROOT, "tests-e2e-baselines");
const MANIFEST_PATH = join(BASELINES, MANIFEST_FILENAME);
const NEW_ALLOWED_PATH = join(BASELINES, NEW_ALLOWED_FILENAME);
const allowedNew = readNewAllowed(NEW_ALLOWED_PATH);

const WEB_SPEC_DIR = join(REPO_ROOT, "tests-e2e/design");
const NATIVE_SPEC_DIR = join(REPO_ROOT, "tests-e2e-native/specs");

const strict = process.argv.includes("--strict");

function collectSpecStepNames(dir: string, matchCall: RegExp): Set<string> {
  const names = new Set<string>();
  if (!existsSync(dir)) return names;
  const walk = (d: string): void => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith(".ts")) {
        const body = readFileSync(full, "utf8");
        for (const m of body.matchAll(matchCall)) {
          names.add(m[1]!);
        }
      }
    }
  };
  walk(dir);
  return names;
}

function collectBaselineSlugs(suite: Suite): Set<string> {
  const dir = join(BASELINES, suite);
  if (!existsSync(dir)) return new Set();
  const out = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".png")) out.add(f.replace(/\.png$/, ""));
  }
  return out;
}

const manifest = readManifest(MANIFEST_PATH);
let problems = 0;

// ── 1. Manifest vs files on disk ──────────────────────────────────────
if (!manifest) {
  console.warn(
    `[audit] no manifest at ${MANIFEST_PATH} — run \`bun run baseline:design\` to create one`,
  );
  problems++;
} else {
  const manifestKeys = new Set(manifest.shots.map((s) => s.key));
  for (const suite of ["web", "native"] as Suite[]) {
    const slugs = collectBaselineSlugs(suite);
    const fileKeys = new Set([...slugs].map((s) => `${suite}::${s}`));
    for (const k of manifestKeys) {
      if (!k.startsWith(`${suite}::`)) continue;
      if (!fileKeys.has(k)) {
        console.warn(
          `[audit] manifest references ${k} but no PNG exists at ${BASELINES}/${suite}/`,
        );
        problems++;
      }
    }
    for (const k of fileKeys) {
      if (!manifestKeys.has(k)) {
        console.warn(
          `[audit] committed PNG ${k} is not in the manifest — promote again to record it`,
        );
        problems++;
      }
    }
  }
}

// ── 2. Spec-declared step names vs committed baselines ──────────────
// The web snap helper is called as `snap(page, testInfo, "step-name", …)`,
// the native one as `app.snap("step-name", …)`. Regex tolerates both
// double and single-quoted string literals. Template literals containing
// `${…}` are intentionally skipped — those steps are demo-catalog driven
// and audited separately via the catalog iteration below.
const WEB_RE = /\bsnap\s*\([^,]+,[^,]+,\s*["']([^"'\$]+)["']/g;
const NATIVE_RE = /\bapp\.snap\s*\(\s*["']([^"'\$]+)["']/g;

const webSteps = collectSpecStepNames(WEB_SPEC_DIR, WEB_RE);
// Demo specs use a catalog-driven `for (const demo of ACTIVE_DEMOS)` loop
// that calls `snap(…, "demo-${demo.slug}", …)`. The regex can't see
// through the template literal, so inject the expected step names
// explicitly from the catalog.
for (const demo of ACTIVE_DEMOS) webSteps.add(`demo-${demo.slug}`);
const nativeSteps = collectSpecStepNames(NATIVE_SPEC_DIR, NATIVE_RE);
for (const demo of ACTIVE_DEMOS) nativeSteps.add(`demo-${demo.slug}`);

function reportOrphanSteps(suite: Suite, steps: Set<string>): void {
  const slugs = collectBaselineSlugs(suite);
  for (const step of steps) {
    // A step can match multiple slugs (different spec files), so
    // we consider any slug ending in `-${step}` as a match.
    const matched = [...slugs].some((slug) => slug.endsWith(`-${step}`));
    if (matched) continue;
    // Check the `.new-allowed` list — a shot intentionally known to be
    // un-baselined yet is allowed, same way the gate allows `new`
    // shots. We match by suffix because the allowlist uses full keys
    // (`native::spec-test-step`) while we only have the step name.
    const suffix = `::${step}`;
    const allowedBySuffix = [...allowedNew].some((key) => key.endsWith(suffix));
    const allowedByExact = [...allowedNew].some(
      (key) => key.startsWith(`${suite}::`) && key.includes(step),
    );
    if (allowedBySuffix || allowedByExact) {
      console.log(
        `[audit] ${suite} step "${step}" has no baseline but is in .new-allowed — OK`,
      );
      continue;
    }
    console.warn(
      `[audit] ${suite} spec declares step "${step}" but no committed baseline matches`,
    );
    problems++;
  }
}

reportOrphanSteps("web", webSteps);
reportOrphanSteps("native", nativeSteps);

console.log(
  `[audit] manifest: ${manifest ? manifest.shots.length : 0} shot(s), ` +
    `web spec steps: ${webSteps.size}, native spec steps: ${nativeSteps.size}, ` +
    `problems: ${problems}`,
);

if (strict && problems > 0) process.exit(1);
