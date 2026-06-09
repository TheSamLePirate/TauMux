import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression guard for the command-palette TDZ bug (v0.4.1→0.4.2).
 *
 * `buildPaletteCommands()` reads the module-level `availableExtensions` /
 * `extensionTemplates` (`let`). The webview runs a top-level
 * `syncPaletteCommands()` during module init — which calls
 * `buildPaletteCommands()`. If either `let` is declared AFTER that init call,
 * the access hits the temporal dead zone and throws a `ReferenceError`, which
 * aborts the rest of module evaluation — so every handler wired further down
 * (command-palette button + keyboard shortcut, title-bar double-click
 * maximize, …) silently never registers.
 *
 * This is invisible to `tsc` (the use is indirect, via a function call) and to
 * the unit suite (the webview entry isn't executed), so guard it structurally.
 */
test("palette extension state is declared before the module-init syncPaletteCommands() call", () => {
  const src = readFileSync(
    join(import.meta.dir, "..", "src", "views", "terminal", "index.ts"),
    "utf-8",
  );
  const lines = src.split("\n");

  // First TOP-LEVEL (column-0) `syncPaletteCommands();` statement — the one
  // that runs during module init. Indented calls live inside functions.
  const initCall = lines.findIndex((l) =>
    /^syncPaletteCommands\(\);\s*$/.test(l),
  );
  expect(initCall).toBeGreaterThan(-1);

  const declOf = (name: string) =>
    lines.findIndex((l) => new RegExp(`^let ${name}\\b`).test(l));
  const avail = declOf("availableExtensions");
  const templ = declOf("extensionTemplates");

  expect(avail).toBeGreaterThan(-1);
  expect(templ).toBeGreaterThan(-1);
  expect(avail).toBeLessThan(initCall);
  expect(templ).toBeLessThan(initCall);
});
