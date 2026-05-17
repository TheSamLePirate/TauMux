// Phase 7 — SurfaceMetadataPoller stale-git skip-tick invariants.
//
// The full SurfaceMetadataPoller class needs many runtime deps (a
// SessionManager, RPC bridge, focus state) to construct, so a runtime
// test of the stall-cooldown would require a heavy fixture. Pin the
// invariants via source-grep instead — the regression class we're
// guarding is "future refactor drops the cooldown or shortens it to
// near-zero", which is a single-line change the grep catches.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(import.meta.dir, "..", "src", "bun", "surface-metadata.ts"),
  "utf-8",
);

describe("[Phase 7] SurfaceMetadataPoller — stale-git cooldown", () => {
  it("declares a `gitStaleUntil` timestamp + cooldown constant", () => {
    expect(SRC).toMatch(/private gitStaleUntil\s*=\s*0/);
    expect(SRC).toMatch(/gitStaleCooldownMs\s*=\s*30_?000/);
  });

  it("exposes `isGitStale(now)` as the public test seam", () => {
    expect(SRC).toMatch(/isGitStale\(now: number\): boolean/);
  });

  it("resolveGit short-circuits when cooldown is active (returns cache)", () => {
    // Pin the early-return shape: `if (this.isGitStale(now)) { …
    // return result; }` BEFORE any fresh probe is issued.
    expect(SRC).toMatch(
      /private async resolveGit[\s\S]*?if \(this\.isGitStale\(now\)\)[\s\S]*?return result;[\s\S]*?stale\.push/,
    );
  });

  it("trips the cooldown when a probe approaches the subprocess timeout", () => {
    // The threshold is 80% of SUBPROCESS_TIMEOUT_MS so an NFS-hung
    // 5 s probe trips, but a normal cold-cache 2 s probe doesn't.
    expect(SRC).toMatch(/SUBPROCESS_TIMEOUT_MS\s*\*\s*0\.8/);
    expect(SRC).toMatch(/anyStall\s*=\s*true/);
    expect(SRC).toMatch(
      /this\.gitStaleUntil\s*=\s*now\s*\+\s*this\.gitStaleCooldownMs/,
    );
  });

  it("subprocess timeout itself stays at 5 s", () => {
    // Pin the budget — if a future PR drops it below 2 s the stall
    // threshold (0.8x) becomes too sensitive and would trip on
    // normal probes.
    expect(SRC).toMatch(/SUBPROCESS_TIMEOUT_MS\s*=\s*5000/);
  });
});
