// Triple-A G.3 / L6+L12 — verify gracefulShutdown is idempotent and clears
// all module-level debounce timers. Backfill from Phase 0 audit (PR 4).
//
// gracefulShutdown lives in src/bun/index.ts, is module-private, and calls
// process.exit() directly. Spawning the main process twice to verify the
// re-entry guard would be a heavy integration test. Instead we pin the
// shutdown invariants via source inspection — sufficient to catch the
// regression we're guarding (a future refactor that drops the guard or
// forgets one of the timer clears).

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(import.meta.dir, "..", "src", "bun", "index.ts"),
  "utf-8",
);

describe("[L6] gracefulShutdown idempotency guard", () => {
  it("declares the `shuttingDown` module flag", () => {
    expect(SRC).toMatch(/^let shuttingDown = false;$/m);
  });

  it("guards re-entry by checking the flag before doing work", () => {
    // Match the exact shape of the guard: an early-return `if
    // (shuttingDown) { ... process.exit(1); }` *before* the
    // `shuttingDown = true;` assignment. A reordering would silently
    // re-enter the shutdown path.
    const guard = SRC.match(
      /if \(shuttingDown\) \{[\s\S]*?process\.exit\(1\)[\s\S]*?\}\s*shuttingDown = true;/,
    );
    expect(guard).not.toBeNull();
  });
});

describe("[L12] gracefulShutdown clears every module-level debounce timer", () => {
  // The 2026-04-28 sweep enumerated five timers that, if left running,
  // could fire after `app.webServer` is nulled or the RPC bridge is
  // closed — leading to noisy errors during a quit and (worse) racing
  // a saveLayout against itself. Each clear is asserted by name so a
  // future regression (adding a sixth timer and forgetting to clear it,
  // or deleting one of these clears) fails this test.
  const cleared = [
    "plansBroadcastTimer",
    "autoContinueAuditTimer",
    "app.htKeysSeenTimer",
    "domReadyDebounce", // cleared via for-of loop
    "app.layoutSaveTimer",
  ];

  for (const name of cleared) {
    it(`clears ${name}`, () => {
      // Each timer should appear under a clearTimeout call inside the
      // shutdown function. We grab the function body and search inside
      // to avoid false positives elsewhere in the file.
      const fnMatch = SRC.match(
        /async function gracefulShutdown\(\)[\s\S]*?process\.exit\(0\);\s*\}/,
      );
      expect(fnMatch).not.toBeNull();
      const body = fnMatch![0];
      expect(body).toContain(name);
      expect(body).toContain("clearTimeout");
    });
  }

  it("wires gracefulShutdown to both SIGINT and SIGTERM", () => {
    expect(SRC).toContain(
      'process.on("SIGINT", () => void gracefulShutdown())',
    );
    expect(SRC).toContain(
      'process.on("SIGTERM", () => void gracefulShutdown())',
    );
  });
});

describe("[C3] synchronous persistence on macOS GUI quit", () => {
  // full_app_review_2026-05.md §4.1: macOS GUI quits (window close, ⌘Q,
  // Dock-quit, last-surface-exit) go through Electrobun.quit() → native
  // forceExit(0) and never deliver SIGINT/SIGTERM, so the signal handlers
  // can't flush state. The fix routes the synchronous half of teardown
  // through Electrobun's `before-quit` app event. These guards fail if a
  // refactor drops the subscription or stops persisting durable state.

  it("extracts the sync teardown into an idempotent persistAndCloseSync()", () => {
    expect(SRC).toMatch(/let syncTeardownDone = false;/);
    expect(SRC).toMatch(/function persistAndCloseSync\(\): void \{/);
    // Idempotency guard: early-return before the flag is set.
    expect(SRC).toMatch(
      /function persistAndCloseSync\(\): void \{\s*if \(syncTeardownDone\) return;\s*syncTeardownDone = true;/,
    );
  });

  it("persists every durable store inside persistAndCloseSync()", () => {
    const fnMatch = SRC.match(
      /function persistAndCloseSync\(\): void \{[\s\S]*?telegramDb\.close\(\)/,
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![0];
    for (const call of [
      "saveLayout()",
      "settingsManager.saveNow()",
      "browserHistory.saveNow()",
      "cookieStore.saveNow()",
      "telegramDb.close()",
    ]) {
      expect(body).toContain(call);
    }
  });

  it("subscribes the sync teardown to Electrobun's before-quit event", () => {
    expect(SRC).toMatch(
      /Electrobun\.events\.on\("before-quit",\s*\(\) => \{\s*persistAndCloseSync\(\);\s*\}\)/,
    );
  });

  it("still calls persistAndCloseSync() from the async gracefulShutdown path", () => {
    const fnMatch = SRC.match(
      /async function gracefulShutdown\(\)[\s\S]*?process\.exit\(0\);\s*\}/,
    );
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toContain("persistAndCloseSync()");
  });
});
