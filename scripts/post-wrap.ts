/**
 * Electrobun postWrap hook — compiles bin/ht into a standalone Mach-O binary
 * and injects it at Contents/MacOS/ht inside the freshly-wrapped .app bundle,
 * so users can install the `ht` CLI without Bun being present on their system.
 *
 * Runs after the .app is created but before code signing (if configured), so
 * the bundled binary is signed alongside the main executable when signing is
 * later enabled.
 */

import { copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const os = process.env["ELECTROBUN_OS"];
const arch = process.env["ELECTROBUN_ARCH"];
const bundlePath = process.env["ELECTROBUN_WRAPPER_BUNDLE_PATH"];

if (os !== "macos") {
  console.log(`[post-wrap] Skipping ht-cli injection (ELECTROBUN_OS=${os}).`);
  process.exit(0);
}

if (!bundlePath) {
  console.error("[post-wrap] ELECTROBUN_WRAPPER_BUNDLE_PATH is not set.");
  process.exit(1);
}

if (!existsSync(bundlePath)) {
  console.error(`[post-wrap] Bundle path does not exist: ${bundlePath}`);
  process.exit(1);
}

const bunTarget = arch === "x64" ? "bun-darwin-x64" : "bun-darwin-arm64";
const outfile = join(bundlePath, "Contents", "MacOS", "ht");

// bun build --compile needs a .ts/.js extension on the entrypoint; bin/ht is
// extensionless (shebang-based CLI), so copy to a tmp .ts file first.
const tmpEntry = join(tmpdir(), `ht-postwrap-${process.pid}.ts`);
copyFileSync("bin/ht", tmpEntry);

console.log(`[post-wrap] Compiling bin/ht → ${outfile} (target=${bunTarget})`);

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
      `[post-wrap] bun build --compile failed (exit ${result.exitCode})`,
    );
    process.exit(result.exitCode ?? 1);
  }
} finally {
  rmSync(tmpEntry, { force: true });
}

const chmod = Bun.spawnSync(["chmod", "+x", outfile]);
if (chmod.exitCode !== 0) {
  console.error(`[post-wrap] chmod +x failed for ${outfile}`);
  process.exit(chmod.exitCode ?? 1);
}

console.log("[post-wrap] ht CLI binary injected successfully.");
