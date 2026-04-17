import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for **native** Electrobun e2e tests.
 *
 * The existing `playwright.config.ts` covers the web-mirror e2e suite
 * (tests-e2e/) — browser-only, no Electrobun app. This config drives the
 * real macOS app via the `app` fixture in `tests-e2e-native/fixtures.ts`.
 *
 *   bun run test:native
 *
 * Each test spawns its own Electrobun app subprocess with an isolated
 * `HT_CONFIG_DIR`, random web-mirror port, and throwaway `$HOME`. See
 * doc/native-e2e-plan.md §5 + §8 for the isolation story.
 */
export default defineConfig({
  testDir: "./tests-e2e-native/specs",
  testMatch: /.*\.spec\.ts/,
  // Electrobun boot is ~1.5–2s on a warm Mac, plus first-surface spawn.
  // 60s per test gives headroom for CI's colder runs without hiding real bugs.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  // Focus-dependent specs (palette Escape, search bar dismiss) occasionally
  // flake when a prior test moves OS-level focus away from the webview —
  // e.g. the agent subprocess briefly steals keyboard focus on spawn.
  // One retry is enough to re-establish the clean state. CI keeps the
  // existing retry too.
  retries: 1,
  // Each worker spawns a full Electrobun app (bun + native launcher + webview).
  // Parallel workers race on the dev-build postBuild step and on Electrobun's
  // small internal port range (50000+), so we serialise by default. Local dev
  // can override with `--workers=N` when the machine can take it.
  workers: 1,
  reporter: process.env["CI"] ? [["list"], ["github"]] : "list",
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "native-dev",
      // Make Chromium available to specs that explicitly ask for the
      // `page` fixture (web-mirror integration specs). Playwright only
      // launches the browser when a test uses `page` — `app`-only specs
      // pay no browser-launch cost.
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
