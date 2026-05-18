#!/usr/bin/env bun
/**
 * Post-package step that runs AFTER `electrobun build`.
 *
 * macOS path: Electrobun re-generates Info.plist late in its
 * pipeline (during the tarball / DMG step) from a hardcoded template
 * that doesn't include CFBundleDisplayName. So edits made in
 * scripts/post-build.ts get clobbered before they ever land in the
 * shipped artifacts. We patch the final .app here, then rebuild the
 * tarball + DMG so the artifacts users actually install reflect the
 * pretty "τ-mux" display name while the on-disk bundle stays the
 * ASCII-safe `tau-mux.app`.
 *
 * Linux path (P8 S3): Electrobun emits a flat `tau-mux/` directory
 * under `build/<env>-linux-<arch>/`. No Info.plist (macOS-specific),
 * no DMG (Linux uses .tar.zst or AppImage). We rebuild the
 * `.tar.zst` artifact from the build dir if Electrobun produced one,
 * so a unified release pipeline can `bun run post-package` on either
 * platform and get a fresh archive. Other platforms (Windows, BSD)
 * still get the old skip-with-message behavior.
 *
 * Bundle filename stays ASCII because Electrobun's USTAR-based
 * tarball step throws ArchiveHeaderError on non-ASCII path bytes.
 */

import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const ENV = process.env["BUILD_ENV"] ?? "stable";
const ARCH = process.arch === "arm64" ? "arm64" : "x64";
const APP_BASE = "tau-mux";
const DISPLAY_NAME = "τ-mux";

type Platform = "macos" | "linux" | "other";
const PLATFORM: Platform =
  process.platform === "darwin"
    ? "macos"
    : process.platform === "linux"
      ? "linux"
      : "other";

if (PLATFORM === "other") {
  console.log(
    `[post-package] Skipping — no post-package recipe for platform=${process.platform}.`,
  );
  process.exit(0);
}

const ARTIFACTS = join(ROOT, "artifacts");

// macOS bundles as `tau-mux.app/`, Linux as `tau-mux/`. The tarball
// name follows the on-disk shape so the unpacker doesn't need
// platform-aware logic.
const APP_DIR_NAME = PLATFORM === "macos" ? `${APP_BASE}.app` : `${APP_BASE}`;
const TARBALL_NAME =
  PLATFORM === "macos"
    ? `${ENV}-${PLATFORM}-${ARCH}-${APP_BASE}.app.tar.zst`
    : `${ENV}-${PLATFORM}-${ARCH}-${APP_BASE}.tar.zst`;

const BUILD_DIR = join(ROOT, "build", `${ENV}-${PLATFORM}-${ARCH}`);
const APP_PATH = join(BUILD_DIR, APP_DIR_NAME);
const TARBALL = join(ARTIFACTS, TARBALL_NAME);
const DMG = join(ARTIFACTS, `${ENV}-${PLATFORM}-${ARCH}-${APP_BASE}.dmg`);

if (!existsSync(APP_PATH)) {
  console.error(`[post-package] App bundle not found at ${APP_PATH}`);
  process.exit(1);
}

// macOS-only: 1. Patch CFBundleDisplayName in the source .app.
//    Delete-then-Add is idempotent and avoids PlistBuddy's quirk
//    where Set on a missing key can return 0 without writing.
if (PLATFORM === "macos") {
  const INFO_PLIST = join(APP_PATH, "Contents", "Info.plist");
  console.log(`[post-package] Setting CFBundleDisplayName="${DISPLAY_NAME}".`);
  Bun.spawnSync(
    [
      "/usr/libexec/PlistBuddy",
      "-c",
      "Delete :CFBundleDisplayName",
      INFO_PLIST,
    ],
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
    console.error(
      `[post-package] PlistBuddy Add failed (exit ${add.exitCode})`,
    );
    process.exit(add.exitCode ?? 1);
  }
} else {
  console.log(`[post-package] Linux: skipping Info.plist patch (macOS-only).`);
}

// 2. Rebuild the .tar.zst artifact from the (patched) app dir.
//    `tar -C` + relative path keeps the archive root at "<app>/…"
//    which is what Electrobun's installer expects. Pipe through zstd
//    via the shell so we don't have to chain Bun.spawnSync stdouts
//    (which buffers oddly and produced corrupt archives). Cross-
//    platform — tar + zstd are available on both macOS and Linux.
if (existsSync(TARBALL)) {
  console.log(`[post-package] Rebuilding ${TARBALL}.`);
  rmSync(TARBALL);
  const cmd = `tar -cf - -C ${JSON.stringify(BUILD_DIR)} ${JSON.stringify(APP_DIR_NAME)} | zstd -19 -q -o ${JSON.stringify(TARBALL)}`;
  const result = Bun.spawnSync(["sh", "-c", cmd], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    console.error(`[post-package] tar | zstd failed (exit ${result.exitCode})`);
    process.exit(result.exitCode ?? 1);
  }
}

// macOS-only: 3. Rebuild the DMG from the patched .app + an
//    Applications symlink (standard macOS drag-to-install layout).
//    Linux releases ship the .tar.zst directly (or an AppImage built
//    by a separate pipeline) — no equivalent step here.
if (PLATFORM === "macos" && existsSync(DMG)) {
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
