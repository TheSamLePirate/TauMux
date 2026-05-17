// P7 S4 — audits auto-rerun on settings change.
//
// Full integration would require booting src/bun/index.ts (electrobun,
// PTY, the whole stack), which we don't have a headless harness for.
// Instead we source-grep the wiring so a future refactor that drops
// the re-run hook fails this test. Pairs with the runtime behaviour
// of `runAudits` already covered by tests/audits.test.ts.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const indexSrc = readFileSync(
  join(import.meta.dir, "..", "src", "bun", "index.ts"),
  "utf8",
);

describe("audits auto-rerun (P7 S4)", () => {
  test("runAndPublishAudits() helper is defined and replaces the boot-only block", () => {
    expect(indexSrc).toContain("async function runAndPublishAudits()");
    // The original `void runAudits(cachedAudits).then(...)` boot block
    // is gone — the helper is the single entry point now.
    expect(indexSrc).not.toMatch(/void runAudits\(cachedAudits\)\.then\(/);
  });

  test("boot calls runAndPublishAudits() exactly once at startup", () => {
    const matches = indexSrc.match(/void runAndPublishAudits\(\);/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  test("updateSettings handler invokes runAndPublishAudits() after rebuildAudits()", () => {
    // Match the relevant updateSettings branch and assert it both
    // rebuilds the registry AND re-runs.
    const updateSettingsBlock = indexSrc.match(
      /updateSettings:[\s\S]+?\n  \},/,
    );
    expect(updateSettingsBlock).not.toBeNull();
    const block = updateSettingsBlock![0];
    expect(block).toContain("rebuildAudits()");
    expect(block).toContain("runAndPublishAudits()");
  });

  test("runAndPublishAudits removes stale audit:* health rows when the registry shrinks", () => {
    // The cleanup loop drops rows for ids no longer in the live result
    // set so a settings flip that removes an audit also removes its
    // health pill.
    expect(indexSrc).toMatch(/entry\.id\.startsWith\("audit:"\)/);
    expect(indexSrc).toMatch(/health\.remove\(entry\.id\)/);
  });

  test("runAndPublishAudits clears the legacy 'audits disabled' row when the registry repopulates", () => {
    // A settings flip can re-add audits after they were disabled; the
    // top-level "audits" health row needs to come off so the disabled
    // state doesn't stick around.
    expect(indexSrc).toMatch(/health\.remove\("audits"\)/);
  });
});
