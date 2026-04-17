import { mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Per-worker throwaway config dir. The suffix weaves in the Playwright worker
 * index, the pid of the runner, and a random tag — parallel workers never
 * share a path, and stale dirs from prior failed runs are wiped on allocation.
 */
export function allocateConfigDir(workerIndex: number): string {
  const tag = Math.random().toString(36).slice(2, 8);
  const dir = join(tmpdir(), `ht-e2e-${process.pid}-${workerIndex}-${tag}`);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
  // The test fixture sets HOME=${configDir}/home; create it eagerly so the
  // shell's posix_spawn chdir doesn't ENOENT before the shell even starts.
  mkdirSync(join(dir, "home"), { recursive: true });
  return dir;
}

export function wipeConfigDir(dir: string): void {
  if (!dir) return;
  if (!dir.startsWith(tmpdir())) {
    // Belt-and-braces: refuse to recursively delete outside the tmp prefix.
    // A stray HT_CONFIG_DIR pointed at the real config would be disastrous.
    return;
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort — the next test allocation wipes again */
  }
}
