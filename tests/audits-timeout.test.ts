// Triple-A G.10 / L13 — verify the subprocess timeouts in the audit
// path. Backfill from Phase 0 audit (PR 17).
//
// Live timeout exercise would require spawning a hung `git` (e.g.
// against a wedged NFS path) which we can't simulate hermetically.
// The fix is a `Promise.race` against a `setTimeout` that kills the
// proc — pin the timing constant + the race shape.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(import.meta.dir, "..", "src", "bun", "audits.ts"),
  "utf-8",
);

describe("[L13] audit subprocess timeouts", () => {
  it("declares GIT_AUDIT_TIMEOUT_MS = 5000", () => {
    expect(SRC).toMatch(/GIT_AUDIT_TIMEOUT_MS\s*=\s*5_?000/);
  });

  it("races the git stdout read against a setTimeout that kills proc", () => {
    // The canonical shape:
    //   const timeout = new Promise(...setTimeout(() => { proc.kill(); ... }))
    //   await Promise.race([stdoutP, timeout])
    // A future refactor that drops the kill, drops the race, or
    // forgets to clearTimeout on the fast path would silently
    // re-introduce the hung-audit failure mode.
    const fnBody = SRC.match(
      /export async function defaultRunGit[\s\S]*?return result\.trim\(\);/,
    );
    expect(fnBody).not.toBeNull();
    const body = fnBody![0];
    expect(body).toContain("Promise.race");
    expect(body).toContain("proc.kill()");
    expect(body).toContain("setTimeout");
    expect(body).toContain("clearTimeout");
  });

  it("logs a warning when the timeout fires (so it's visible in logs)", () => {
    // The console.warn call uses a template literal that spans
    // multiple lines; assert the salient substrings instead of
    // matching the exact call shape.
    const fnBody = SRC.match(
      /export async function defaultRunGit[\s\S]*?return result\.trim\(\);/,
    );
    expect(fnBody).not.toBeNull();
    const body = fnBody![0];
    expect(body).toContain("console.warn");
    expect(body).toContain("[audits]");
    expect(body).toContain("timed out");
    expect(body).toContain("GIT_AUDIT_TIMEOUT_MS");
  });
});
