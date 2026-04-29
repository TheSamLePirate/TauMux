import { chmodSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

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
 * `mode` (e.g. `0o600`) is applied to the destination after the
 * rename; on macOS the rename preserves the original file's mode bits
 * if it existed, so a one-time chmod in the writer guarantees the
 * permissions are correct on first save and on every subsequent save
 * (idempotent).
 *
 * Triple-A G.4 / L7 / H.1 — used by SettingsManager,
 * BrowserHistoryStore, and CookieStore for their `*.json`
 * persistence; H.1 callers pass `mode: 0o600` so sensitive secrets
 * (Telegram bot token, browser cookies) aren't world-readable.
 */
export function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
  opts: { mode?: number } = {},
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
  if (opts.mode !== undefined) {
    try {
      chmodSync(filePath, opts.mode);
    } catch {
      /* best-effort — non-POSIX FS may reject chmod */
    }
  }
}
