import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "bun:test";

/**
 * τ-mux design guideline §11 Do/Don't programmatic compliance.
 * Runs scripts/audit-guideline-do-donts.ts which covers: no third
 * accent, no decorative panel gradients, no backdrop-filter, radius
 * budget, focus-only-glow, traffic-lights stock, no dotted borders,
 * Mono for values, terminal-body unowned, τ logo from <rect> elements,
 * three variants present. Manual-only items (artboard diffs, smoke)
 * are printed for reference.
 */
test("§11 Do/Don't compliance", () => {
  const repo = resolve(import.meta.dir, "..");
  const res = spawnSync("bun", ["scripts/audit-guideline-do-donts.ts"], {
    cwd: repo,
    encoding: "utf-8",
  });
  if (res.status !== 0) {
    console.error(res.stdout);
    console.error(res.stderr);
  }
  expect(res.status).toBe(0);
});
