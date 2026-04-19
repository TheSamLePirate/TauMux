#!/usr/bin/env bun
/**
 * Post-package step that runs AFTER `electrobun build`.
 *
 * Why this exists: Electrobun re-generates Info.plist late in its
 * pipeline (during the tarball / DMG step) from a hardcoded template
 * that doesn't include CFBundleDisplayName. So edits made in
 * scripts/post-build.ts get clobbered before they ever land in the
 * shipped artifacts. We patch the final .app here, then rebuild the
 * tarball + DMG so the artifacts users actually install reflect the
 * pretty "τ-mux" display name while the on-disk bundle stays the
 * ASCII-safe `tau-mux.app`.
 *
 * Bundle filename stays ASCII because Electrobun's USTAR-based
 * tarball step throws ArchiveHeaderError on non-ASCII path bytes.
 */

import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const ENV = process.env["BUILD_ENV"] ?? "stable";
const PLATFORM = process.platform === "darwin" ? "macos" : process.platform;
const ARCH = process.arch === "arm64" ? "arm64" : "x64";
const APP_BASE = "tau-mux";
const DISPLAY_NAME = "τ-mux";

if (PLATFORM !== "macos") {
  console.log(
    `[post-package] Skipping — only runs on macOS (platform=${PLATFORM}).`,
  );
  process.exit(0);
}

const BUILD_DIR = join(ROOT, "build", `${ENV}-${PLATFORM}-${ARCH}`);
const APP_PATH = join(BUILD_DIR, `${APP_BASE}.app`);
const INFO_PLIST = join(APP_PATH, "Contents", "Info.plist");
const ARTIFACTS = join(ROOT, "artifacts");
const TARBALL = join(
  ARTIFACTS,
  `${ENV}-${PLATFORM}-${ARCH}-${APP_BASE}.app.tar.zst`,
);
const DMG = join(ARTIFACTS, `${ENV}-${PLATFORM}-${ARCH}-${APP_BASE}.dmg`);

if (!existsSync(APP_PATH)) {
  console.error(`[post-package] App bundle not found at ${APP_PATH}`);
  process.exit(1);
}

// 1. Patch CFBundleDisplayName in the source .app. Delete-then-Add
//    is idempotent and avoids PlistBuddy's quirk where Set on a
//    missing key can return 0 without writing.
console.log(`[post-package] Setting CFBundleDisplayName="${DISPLAY_NAME}".`);
Bun.spawnSync(
  ["/usr/libexec/PlistBuddy", "-c", "Delete :CFBundleDisplayName", INFO_PLIST],
  { stdout: "pipe", stderr: "pipe" },
);
const add = Bun.spawnSync(
  [
    "/usr/libexec/PlistBuddy",
    "-c",
    `Add :CFBundleDisplayName string ${DISPLAY_NAME}`,
    INFO_PLIST,
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (add.exitCode !== 0) {
  console.error(`[post-package] PlistBuddy Add failed (exit ${add.exitCode})`);
  process.exit(add.exitCode ?? 1);
}

// 2. Rebuild the .tar.zst artifact from the patched .app.
//    `tar -C` + relative path keeps the archive root at "<app>.app/…"
//    which is what Electrobun's installer expects. Pipe through zstd
//    via the shell so we don't have to chain Bun.spawnSync stdouts
//    (which buffers oddly and produced corrupt archives).
if (existsSync(TARBALL)) {
  console.log(`[post-package] Rebuilding ${TARBALL}.`);
  rmSync(TARBALL);
  const cmd = `tar -cf - -C ${JSON.stringify(BUILD_DIR)} ${JSON.stringify(`${APP_BASE}.app`)} | zstd -19 -q -o ${JSON.stringify(TARBALL)}`;
  const result = Bun.spawnSync(["sh", "-c", cmd], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    console.error(`[post-package] tar | zstd failed (exit ${result.exitCode})`);
    process.exit(result.exitCode ?? 1);
  }
}

// 3. Rebuild the DMG from the patched .app + an Applications symlink
//    (standard macOS drag-to-install layout).
if (existsSync(DMG)) {
  console.log(`[post-package] Rebuilding ${DMG}.`);
  rmSync(DMG);
  const stagingRoot = join(ROOT, "build", `dmg-staging-${process.pid}`);
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });
  // Copy the patched .app into staging (ditto preserves metadata).
  const ditto = Bun.spawnSync(
    ["ditto", APP_PATH, join(stagingRoot, `${APP_BASE}.app`)],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (ditto.exitCode !== 0) {
    console.error(`[post-package] ditto failed (exit ${ditto.exitCode})`);
    process.exit(ditto.exitCode ?? 1);
  }
  symlinkSync("/Applications", join(stagingRoot, "Applications"));
  const hdiutil = Bun.spawnSync(
    [
      "hdiutil",
      "create",
      "-volname",
      APP_BASE,
      "-srcfolder",
      stagingRoot,
      "-format",
      "UDZO",
      "-quiet",
      DMG,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  rmSync(stagingRoot, { recursive: true, force: true });
  if (hdiutil.exitCode !== 0) {
    console.error(`[post-package] hdiutil failed (exit ${hdiutil.exitCode})`);
    process.exit(hdiutil.exitCode ?? 1);
  }
}

console.log(`[post-package] Done. Artifacts in ${ARTIFACTS}/`);
