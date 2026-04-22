import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "bun:test";

/**
 * τ-mux design guideline §0 rule 7: "No emoji. Ever. Use the tokenised
 * SVG icon set (§6)." This test runs scripts/audit-emoji.ts and expects
 * a clean exit. Lines that must carry a non-Latin glyph (e.g. user-
 * authored content being rendered) can add `// emoji-audit-ignore-line`
 * or the whole file can add `// emoji-audit-ignore`.
 */
test("no emoji code points in chrome sources", () => {
  const repo = resolve(import.meta.dir, "..");
  const res = spawnSync("bun", ["scripts/audit-emoji.ts"], {
    cwd: repo,
    encoding: "utf-8",
  });
  // Print the audit output so failures are self-explanatory in the test log.
  if (res.status !== 0) {
    console.error(res.stdout);
    console.error(res.stderr);
  }
  expect(res.status).toBe(0);
});
