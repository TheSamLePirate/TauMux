/**
 * Enumerate committed baseline shots — used to surface "baseline-only"
 * rows: shots that live in `tests-e2e-baselines/` but had no matching
 * entry in the current run (test deleted, spec renamed, fixture
 * regressed). The report treats these as regressions so coverage can't
 * silently shrink.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ManifestShot, Suite } from "./types";

/** Parse `<spec>-<test>-<step>.png` filenames back into a `ManifestShot`.
 *  The three components were flattened at promote time via `shotSlug()`,
 *  so we can't round-trip perfectly — but we get the canonical key and
 *  display-friendly fields. */
export function parseBaselineFilename(
  suite: Suite,
  file: string,
): { key: string; shot: ManifestShot } | null {
  if (!file.endsWith(".png")) return null;
  const stem = file.slice(0, -".png".length);
  // Heuristic: the stem is shaped `<spec>-<test>-<step>` but test /
  // step can themselves contain dashes, so we can't faithfully round-
  // trip. Just extract a display string after the first dash and let
  // the key stay `suite::<full-stem>` for canonical matching.
  const firstDash = stem.indexOf("-");
  const rest = firstDash === -1 ? "" : stem.slice(firstDash + 1);
  return {
    key: `${suite}::${stem}`,
    shot: {
      key: `${suite}::${stem}`,
      suite,
      slug: stem,
      test: rest,
      step: rest,
      width: 0,
      height: 0,
    },
  };
}

/** List every baseline shot as `{key, ManifestShot}`. Accepts a missing
 *  directory and returns an empty array — first-run ergonomics. */
export function enumerateBaselineShots(baselineRoot: string): {
  key: string;
  suite: Suite;
  file: string;
  fullPath: string;
}[] {
  if (!existsSync(baselineRoot)) return [];
  const out: { key: string; suite: Suite; file: string; fullPath: string }[] =
    [];
  for (const suiteDir of readdirSync(baselineRoot, { withFileTypes: true })) {
    if (!suiteDir.isDirectory()) continue;
    const suite = suiteDir.name as Suite;
    if (suite !== "web" && suite !== "native") continue;
    const dirPath = join(baselineRoot, suite);
    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith(".png")) continue;
      const parsed = parseBaselineFilename(suite, file);
      if (!parsed) continue;
      out.push({
        key: parsed.key,
        suite,
        file,
        fullPath: join(dirPath, file),
      });
    }
  }
  return out;
}
