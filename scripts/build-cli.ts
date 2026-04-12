/**
 * Compiles bin/ht into a standalone Mach-O binary at build/ht-cli.
 *
 * Bun's `--compile` mode requires the entrypoint to have a `.ts` or `.js`
 * extension; bin/ht is extensionless (so the shebang-based dev workflow
 * stays tidy), so we copy it to a temp .ts file before compiling.
 */

import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arch = process.arch === "x64" ? "bun-darwin-x64" : "bun-darwin-arm64";
const outfile = "build/ht-cli";
const tmpEntry = join(tmpdir(), `ht-build-${process.pid}.ts`);

mkdirSync("build", { recursive: true });
copyFileSync("bin/ht", tmpEntry);

try {
  const result = Bun.spawnSync(
    [
      "bun",
      "build",
      "--compile",
      `--target=${arch}`,
      tmpEntry,
      "--outfile",
      outfile,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
  console.log(`[build-cli] compiled ${outfile} (${arch})`);
} finally {
  rmSync(tmpEntry, { force: true });
}
