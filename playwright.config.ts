import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for web-mirror end-to-end tests.
 *
 * We deliberately use a separate test dir (`tests-e2e/`) and `.spec.ts`
 * suffix — `bun test` scans `tests/` for `*.test.ts`, so the two runners
 * never collide. Run them with:
 *     bun run test:e2e
 *
 * The suite targets Chromium only: the web mirror is rendered in
 * whatever browser the user points at it, and Chromium stands in for
 * the common case. Firefox/WebKit can be added later if specific
 * render regressions show up.
 *
 * Each test boots a fresh WebServer + SessionManager through
 * `tests-e2e/fixtures.ts` so there's no shared state between tests —
 * the expected idiom is `import { test, expect } from "./fixtures"`.
 */
export default defineConfig({
  testDir: "./tests-e2e",
  testMatch: /.*\.spec\.ts/,
  // 30s per test — PTY warmup + WS handshake adds real latency, and
  // CI is slower than a warm laptop.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // Run files in parallel; each test gets its own server fixture so
  // there's no cross-test state to race on.
  fullyParallel: true,
  // CI failures should fail the build, not hide behind `.only`.
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  // 4 workers is plenty; each spawns a PTY so we don't want to flood.
  workers: process.env["CI"] ? 2 : 4,
  reporter: process.env["CI"] ? [["list"], ["github"]] : "list",
  use: {
    // No global baseURL — fixtures inject per-test servers on random
    // ports so multiple tests can run in parallel.
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
