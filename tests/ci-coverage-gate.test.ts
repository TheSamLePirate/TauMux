// P9 S1 — verify .github/workflows/ci.yml wires the coverage gate.
//
// Source-grep test for the CI workflow. The actual gate runs on
// GitHub Actions; this test catches accidental deletion of the gate
// step (the exact failure mode that left the gate "owned by P8" for
// multiple phases).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CI = resolve(import.meta.dir, "..", ".github", "workflows", "ci.yml");
const yml = readFileSync(CI, "utf8");

describe("CI workflow — coverage gate (P9 S1)", () => {
  test("ci.yml declares a coverage-gate job", () => {
    expect(yml).toMatch(/^\s+coverage-gate:/m);
    expect(yml).toMatch(/name: Coverage gate/);
  });

  test("coverage-gate runs test:coverage then report:coverage:check", () => {
    // The two run-steps must appear in this order, both inside the
    // coverage-gate job.
    const jobIdx = yml.indexOf("coverage-gate:");
    expect(jobIdx).toBeGreaterThan(0);
    const jobBody = yml.slice(jobIdx);
    const genIdx = jobBody.indexOf("bun run test:coverage");
    const checkIdx = jobBody.indexOf("bun run report:coverage:check");
    expect(genIdx).toBeGreaterThan(0);
    expect(checkIdx).toBeGreaterThan(genIdx);
  });

  test("coverage-gate runs on a macOS runner (same as typecheck-and-unit)", () => {
    const jobIdx = yml.indexOf("coverage-gate:");
    const jobBody = yml.slice(jobIdx, jobIdx + 800);
    expect(jobBody).toMatch(/runs-on:\s*macos-/);
  });

  test("coverage-gate sets a timeout so a hung suite doesn't burn the CI minute budget", () => {
    const jobIdx = yml.indexOf("coverage-gate:");
    const jobBody = yml.slice(jobIdx, jobIdx + 800);
    expect(jobBody).toMatch(/timeout-minutes:\s*\d+/);
  });
});
