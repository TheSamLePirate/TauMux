import { execFileSync, spawn } from "node:child_process";
import type { test as base } from "@playwright/test";

type PlaywrightTest = typeof base;

/**
 * Wrap a Playwright test instance with an `@clipboard`-guard hook. Tests
 * tagged `@clipboard` (via `test.describe` or filename convention) get the
 * system clipboard snapshot + restore around the test body — macOS has no
 * per-app clipboard, so copy/paste assertions can't be allowed to clobber
 * the user's clipboard state.
 *
 * Usage:
 *   import { test as baseTest } from "../fixtures";
 *   export const test = withClipboardGuard(baseTest);
 */
export function withClipboardGuard<T extends PlaywrightTest>(test: T): T {
  (test as PlaywrightTest).beforeEach(async ({}, testInfo) => {
    if (!testInfo.titlePath.join(" ").includes("@clipboard")) return;
    const prior = snapshotClipboard();
    (testInfo as unknown as { __priorClipboard?: string }).__priorClipboard =
      prior;
  });
  (test as PlaywrightTest).afterEach(async ({}, testInfo) => {
    const prior = (testInfo as unknown as { __priorClipboard?: string })
      .__priorClipboard;
    if (prior === undefined) return;
    await restoreClipboard(prior);
  });
  return test;
}

/** Snapshot + restore the system clipboard around a block of work. macOS has
 *  no per-app clipboard; tests that touch copy/paste must not clobber the
 *  user's clipboard state. Used as a `@clipboard`-tagged fixture guard. */
export function snapshotClipboard(): string {
  if (process.platform !== "darwin") return "";
  try {
    return String(execFileSync("pbpaste", [], { encoding: "utf8" }));
  } catch {
    return "";
  }
}

export async function restoreClipboard(prior: string): Promise<void> {
  if (process.platform !== "darwin") return;
  await new Promise<void>((resolve) => {
    const child = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
    child.stdin.end(prior);
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
}
