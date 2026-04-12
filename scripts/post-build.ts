/**
 * Electrobun postBuild hook — compiles bin/ht into a standalone Mach-O binary
 * and injects it at Contents/MacOS/ht inside the just-built .app bundle.
 *
 * Runs BEFORE tarring/self-extracting-wrapper creation, so the binary is part
 * of the compressed payload that lands on disk when the user first launches
 * the shipped .app. (postWrap, by contrast, writes into the outer wrapper
 * which is replaced on first launch — the binary would disappear.)
 */

import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const targetOS = process.env["ELECTROBUN_OS"];
const arch = process.env["ELECTROBUN_ARCH"];
const buildDir = process.env["ELECTROBUN_BUILD_DIR"];

if (targetOS !== "macos") {
  console.log(
    `[post-build] Skipping ht-cli injection (ELECTROBUN_OS=${targetOS}).`,
  );
  process.exit(0);
}

if (!buildDir || !existsSync(buildDir)) {
  console.error(
    `[post-build] ELECTROBUN_BUILD_DIR missing or invalid: ${buildDir}`,
  );
  process.exit(1);
}

// The inner .app bundle name includes spaces; its sanitized twin does not.
// Either way, there's exactly one .app in buildDir at this point.
const bundleName = readdirSync(buildDir).find((e) => e.endsWith(".app"));
if (!bundleName) {
  console.error(`[post-build] No .app folder found in ${buildDir}`);
  process.exit(1);
}

const bunTarget = arch === "x64" ? "bun-darwin-x64" : "bun-darwin-arm64";
const outfile = join(buildDir, bundleName, "Contents", "MacOS", "ht");

// bun build --compile needs a .ts/.js extension; bin/ht is extensionless.
const tmpEntry = join(tmpdir(), `ht-postbuild-${process.pid}.ts`);
copyFileSync("bin/ht", tmpEntry);

console.log(`[post-build] Compiling bin/ht → ${outfile} (target=${bunTarget})`);

try {
  const result = Bun.spawnSync(
    [
      "bun",
      "build",
      "--compile",
      `--target=${bunTarget}`,
      tmpEntry,
      "--outfile",
      outfile,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );

  if (result.exitCode !== 0) {
    console.error(
      `[post-build] bun build --compile failed (exit ${result.exitCode})`,
    );
    process.exit(result.exitCode ?? 1);
  }
} finally {
  rmSync(tmpEntry, { force: true });
}

const chmod = Bun.spawnSync(["chmod", "+x", outfile]);
if (chmod.exitCode !== 0) {
  console.error(`[post-build] chmod +x failed for ${outfile}`);
  process.exit(chmod.exitCode ?? 1);
}

console.log("[post-build] ht CLI binary injected successfully.");
