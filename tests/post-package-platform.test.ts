// P8 S3 — post-package platform branching tests.
//
// The script can't be fully exercised in CI (it shells out to tar +
// zstd + PlistBuddy / hdiutil) so these tests cover the source-level
// invariants that any future refactor must preserve: the script
// recognises macOS / Linux / other, picks the right APP_DIR_NAME and
// TARBALL_NAME, and gates Info.plist + DMG behind a macOS check.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "..", "scripts", "post-package.ts");
const src = readFileSync(SCRIPT, "utf8");

describe("post-package — Linux path (P8 S3)", () => {
  test("PLATFORM is a three-way union including linux", () => {
    expect(src).toMatch(/type Platform = "macos" \| "linux" \| "other"/);
    expect(src).toMatch(/process\.platform === "darwin"/);
    expect(src).toMatch(/process\.platform === "linux"/);
  });

  test("Unknown platforms still skip with a message instead of crashing", () => {
    expect(src).toMatch(/no post-package recipe for platform=/i);
    expect(src).toMatch(/PLATFORM === "other"/);
    // The skip path is an early process.exit(0), not exit(1). The
    // template string with the long message bloats the gap, so allow
    // up to 400 chars between the gate and the exit call.
    expect(src).toMatch(/PLATFORM === "other"[\s\S]{0,400}process\.exit\(0\)/);
  });

  test("APP_DIR_NAME branches on platform (macOS .app suffix, Linux flat)", () => {
    expect(src).toMatch(/PLATFORM === "macos"\s*\?\s*`\$\{APP_BASE\}\.app`/);
    expect(src).toMatch(/:\s*`\$\{APP_BASE\}`/);
  });

  test("TARBALL_NAME embeds .app on macOS only", () => {
    // macOS tarball: ${ENV}-${PLATFORM}-${ARCH}-${APP_BASE}.app.tar.zst
    // Linux tarball: ${ENV}-${PLATFORM}-${ARCH}-${APP_BASE}.tar.zst
    expect(src).toMatch(
      /TARBALL_NAME\s*=[^;]*macos[^;]*\$\{APP_BASE\}\.app\.tar\.zst/,
    );
    expect(src).toMatch(/TARBALL_NAME\s*=[^;]*\$\{APP_BASE\}\.tar\.zst/);
  });

  test('Info.plist patching is gated by PLATFORM === "macos"', () => {
    // The PlistBuddy *invocation* (not the comment that mentions it)
    // must be inside an `if (PLATFORM === "macos")` block. Anchor on
    // the full path string Bun.spawnSync invokes.
    const plistIdx = src.indexOf('"/usr/libexec/PlistBuddy"');
    expect(plistIdx).toBeGreaterThan(0);
    const before = src.slice(0, plistIdx);
    const lastIf = before.lastIndexOf("if (PLATFORM");
    expect(lastIf).toBeGreaterThan(0);
    expect(src.slice(lastIf, lastIf + 40)).toMatch(/PLATFORM === "macos"/);
  });

  test("Linux gets an explicit skip-Info.plist log message", () => {
    expect(src).toMatch(/Linux: skipping Info\.plist patch/);
  });

  test('DMG rebuild is gated by PLATFORM === "macos"', () => {
    // Anchor on the hdiutil invocation (the array literal), not the
    // first textual mention.
    const dmgIdx = src.indexOf('"hdiutil"');
    expect(dmgIdx).toBeGreaterThan(0);
    const before = src.slice(0, dmgIdx);
    const lastIf = before.lastIndexOf('if (PLATFORM === "macos"');
    expect(lastIf).toBeGreaterThan(0);
  });

  test("tar | zstd step uses APP_DIR_NAME (cross-platform-aware)", () => {
    // The tarball rebuild must reference APP_DIR_NAME rather than a
    // hard-coded `${APP_BASE}.app` so it picks up Linux's flat
    // directory shape.
    expect(src).toMatch(/tar -cf - -C[^`]*APP_DIR_NAME/);
    expect(src).not.toMatch(/tar -cf -[^`]*\$\{APP_BASE\}\.app\)/);
  });

  test("BUILD_DIR path template still includes platform + arch", () => {
    expect(src).toMatch(
      /BUILD_DIR\s*=\s*join\(ROOT,\s*"build",\s*`\$\{ENV\}-\$\{PLATFORM\}-\$\{ARCH\}`\)/,
    );
  });
});
