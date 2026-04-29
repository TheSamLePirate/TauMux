import { renameSync, unlinkSync, writeFileSync } from "node:fs";

/**
 * Write a file atomically (POSIX). The data is first written to
 * `${filePath}.tmp` and then `renameSync`d into place — that rename
 * is atomic on the same filesystem, so a crash mid-write never
 * leaves a truncated `filePath`. The reader either sees the previous
 * version or the new one, never a partial.
 *
 * If the rename fails, the tmp file is best-effort cleaned up so a
 * disk full error doesn't leave dangling `.tmp` files behind.
 *
 * Triple-A G.4 / L7 — used by SettingsManager, BrowserHistoryStore,
 * and CookieStore for their `*.json` persistence.
 */
export function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, data);
  try {
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* swallow — primary failure is the more useful error */
    }
    throw err;
  }
}
