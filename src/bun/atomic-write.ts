import {
  closeSync,
  fchmodSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

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
 * `mode` (e.g. `0o600`) is applied to the tmp file **from creation**
 * (via `openSync` + `fchmodSync`) so a secrets file (Telegram bot
 * token, web-mirror auth token, browser cookies) is never briefly
 * world-readable during the write window — W1-3 / H0e in
 * full_app_review_2026-05.md. The old code wrote with the default
 * umask first and chmod'd only the destination *after* the rename,
 * leaving the `.tmp` at 0644 for the duration of every save.
 *
 * Durability: the tmp's data is `fsync`'d before the rename, and the
 * parent directory is `fsync`'d (best-effort) after it, so the new
 * contents survive a power loss — not just a process crash (§14.1).
 *
 * Triple-A G.4 / L7 / H.1 — used by SettingsManager,
 * BrowserHistoryStore, and CookieStore for their `*.json`
 * persistence; secret callers pass `mode: 0o600`.
 */
export function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
  opts: { mode?: number } = {},
): void {
  const tmp = `${filePath}.tmp`;
  // `openSync` applies `mode` only on *creation* and it's masked by umask;
  // a leftover tmp from a crashed write could keep looser perms. `fchmodSync`
  // forces the exact mode on the open fd regardless, closing the window.
  const fd = openSync(tmp, "w", opts.mode ?? 0o666);
  try {
    if (opts.mode !== undefined) fchmodSync(fd, opts.mode);
    writeSync(fd, typeof data === "string" ? Buffer.from(data, "utf-8") : data);
    // Flush the bytes to disk before we expose them via rename so a power
    // loss can't surface an empty-but-renamed file.
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
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
  // Make the rename itself durable: the directory entry must be flushed,
  // else a power loss right after rename can lose the new name. Best-effort
  // — directory fsync isn't supported on every platform/FS.
  try {
    const dirFd = openSync(dirname(filePath), "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    /* best-effort durability — never fail the write over a dir fsync */
  }
}
