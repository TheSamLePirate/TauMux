#!/usr/bin/env bun
/**
 * τ-mux module-size ratchet (§3.6, doc/full_app_review_2026-08.md).
 *
 * ## Why this exists
 *
 * The 2026-05 review called out four god modules and a decomposition wave
 * (H10) genuinely extracted controllers out of `SurfaceManager`. Measured
 * again at v0.4.11, *all four had grown anyway*:
 *
 *     sidebar.ts            3418 → 3714
 *     bun/index.ts          2871 → 3162
 *     views/terminal/index  2789 → 3040
 *     surface-manager.ts    2730 → 2808
 *
 * The lesson is that one-off extraction waves don't hold; a standing
 * constraint does. A flat `max-lines` rule can't express that — every
 * existing offender would fail on day one, so it would be switched off
 * within a week.
 *
 * ## How it works
 *
 * A **ratchet**, not a wall:
 *
 *   - Any file at or under `CAP` lines is fine.
 *   - A file already over `CAP` is recorded in the baseline below with its
 *     size at the time. It may shrink freely; it may NOT grow. That turns
 *     each god module into a one-way valve.
 *   - A file over `CAP` that is *not* in the baseline fails — new modules
 *     have to be born small.
 *
 * Shrinking a baselined file below its recorded size prints a nudge to
 * re-baseline, so the ratchet keeps tightening instead of going stale.
 *
 *   bun run audit:module-size              check (exit 1 on violation)
 *   bun run audit:module-size --promote    rewrite the baseline
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const BASELINE_PATH = resolve(
  ROOT,
  "tests/baselines/module-size-baseline.json",
);

/** Files above this are considered god modules and must be baselined. */
export const CAP = 1500;

const SCAN_DIRS = [
  "src",
  "scripts",
  "packages",
  "pi-extensions",
  "claude-integration",
];
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "vendor",
  "test-results",
]);
const INCLUDE_EXT = new Set([".ts", ".tsx"]);

export interface SizeViolation {
  path: string;
  lines: number;
  /** Recorded ceiling, or null when the file is not baselined at all. */
  allowed: number | null;
}

export interface SizeReport {
  violations: SizeViolation[];
  /** Baselined files that have shrunk — the baseline can be tightened. */
  improved: { path: string; lines: number; allowed: number }[];
  /** Baselined entries with no matching file (deleted / renamed). */
  stale: string[];
}

/**
 * Pure comparison so this is unit-testable without touching the disk.
 * `sizes` maps repo-relative path → line count.
 */
export function checkSizes(
  sizes: Map<string, number>,
  baseline: Record<string, number>,
  cap = CAP,
): SizeReport {
  const violations: SizeViolation[] = [];
  const improved: { path: string; lines: number; allowed: number }[] = [];

  for (const [path, lines] of sizes) {
    const allowed = baseline[path];
    if (allowed === undefined) {
      // Not baselined: the cap is the only limit.
      if (lines > cap) violations.push({ path, lines, allowed: null });
      continue;
    }
    if (lines > allowed) violations.push({ path, lines, allowed });
    else if (lines < allowed) improved.push({ path, lines, allowed });
  }

  const stale = Object.keys(baseline).filter((p) => !sizes.has(p));

  violations.sort((a, b) => b.lines - a.lines);
  improved.sort((a, b) => a.lines - b.lines);
  return { violations, improved, stale };
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (IGNORE_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (INCLUDE_EXT.has(name.slice(name.lastIndexOf(".")))) out.push(full);
  }
}

export function collectSizes(): Map<string, number> {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(resolve(ROOT, d), files);
  const sizes = new Map<string, number>();
  for (const f of files) {
    // `.d.ts` are ambient/generated; not authored modules.
    if (f.endsWith(".d.ts")) continue;
    const lines = readFileSync(f, "utf-8").split("\n").length;
    sizes.set(relative(ROOT, f), lines);
  }
  return sizes;
}

function loadBaseline(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as Record<
      string,
      number
    >;
  } catch {
    return {};
  }
}

function main(): void {
  const promote = process.argv.includes("--promote");
  const sizes = collectSizes();

  if (promote) {
    const next: Record<string, number> = {};
    for (const [path, lines] of [...sizes].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (lines > CAP) next[path] = lines;
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
    console.log(
      `[module-size] baselined ${Object.keys(next).length} file(s) over ${CAP} lines → ${relative(ROOT, BASELINE_PATH)}`,
    );
    return;
  }

  const { violations, improved, stale } = checkSizes(sizes, loadBaseline());

  if (improved.length > 0) {
    console.log(
      `[module-size] ${improved.length} baselined file(s) shrank — tighten the ratchet with \`bun run audit:module-size --promote\`:`,
    );
    for (const i of improved.slice(0, 10)) {
      console.log(
        `  ${i.path}  ${i.allowed} → ${i.lines}  (-${i.allowed - i.lines})`,
      );
    }
  }
  if (stale.length > 0) {
    console.log(
      `[module-size] ${stale.length} baseline entr(y|ies) no longer exist (deleted/renamed): ${stale.join(", ")}`,
    );
  }

  if (violations.length === 0) {
    console.log(
      `[module-size] OK — no file over ${CAP} lines outside the baseline, and no baselined file grew.`,
    );
    return;
  }

  console.error(`[module-size] ${violations.length} violation(s):`);
  for (const v of violations) {
    if (v.allowed === null) {
      console.error(
        `  ${v.path}  ${v.lines} lines — over the ${CAP}-line cap for a NEW module.\n` +
          `      Split it. A new file is never allowed to start out as a god module.`,
      );
    } else {
      console.error(
        `  ${v.path}  ${v.lines} lines — grew past its recorded ceiling of ${v.allowed} (+${v.lines - v.allowed}).\n` +
          `      This module is already oversized; put new code in a new module instead.`,
      );
    }
  }
  console.error(
    `\nThe ratchet is deliberate: see scripts/audit-module-size.ts. If a growth is ` +
      `genuinely unavoidable, re-baseline explicitly (\`--promote\`) so it shows up in review.`,
  );
  process.exit(1);
}

if (import.meta.main) main();
