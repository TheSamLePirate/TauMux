#!/usr/bin/env bun
/**
 * Copy the most recent design-report shots into `tests-e2e-baselines/`
 * so subsequent runs pixel-diff against them.
 *
 *   bun run report:design        # builds test-results/design-report/
 *   bun scripts/promote-design-baseline.ts   # promotes to tests-e2e-baselines/
 *
 * Intentionally not wrapped into `report:design` itself — promotion is
 * destructive and deserves an explicit step.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const REPORT_SHOTS = join(REPO_ROOT, "test-results/design-report/shots");
const BASELINES = join(REPO_ROOT, "tests-e2e-baselines");

if (!existsSync(REPORT_SHOTS)) {
  console.error(
    `[baseline] no design-report shots at ${REPORT_SHOTS} — ` +
      `run \`bun run report:design\` first`,
  );
  process.exit(1);
}

for (const suite of readdirSync(REPORT_SHOTS)) {
  const src = join(REPORT_SHOTS, suite);
  const dst = join(BASELINES, suite);
  if (existsSync(dst)) rmSync(dst, { recursive: true });
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  const count = readdirSync(dst).length;
  console.log(`[baseline] ${suite}: promoted ${count} shot(s) → ${dst}`);
}
