import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "bun:test";

/**
 * τ-mux design guideline §10: only the five canonical animations
 * (tauBlink / tauPulse / tauGlowPulse / tauDash / tauTickerScroll,
 * plus τ-mux-prefixed extensions citing guideline sections) or the
 * documented state-exception allowlist may appear as @keyframes in
 * index.css. Adding a new keyframe means appending to the registry
 * in scripts/audit-animations.ts with a rationale.
 */
test("no ornamental keyframes in index.css", () => {
  const repo = resolve(import.meta.dir, "..");
  const res = spawnSync("bun", ["scripts/audit-animations.ts"], {
    cwd: repo,
    encoding: "utf-8",
  });
  if (res.status !== 0) {
    console.error(res.stdout);
    console.error(res.stderr);
  }
  expect(res.status).toBe(0);
});
