// Persistent app log: tees stdout/stderr into a daily-rotated file so
// the `console.log` / `console.error` output we rely on for debugging
// survives launches from Finder / Dock / Spotlight (where launchd
// inherits /dev/null for fd 1 & 2 and every message would otherwise
// vanish).
//
// Where files land
// ----------------
// Production (no HT_CONFIG_DIR): `~/Library/Logs/tau-mux/app-YYYY-MM-DD.log`
//   — standard macOS user-log location, visible in Console.app under
//   "Log Reports".
// E2E (HT_CONFIG_DIR set): `$HT_CONFIG_DIR/logs/app-YYYY-MM-DD.log`
//   — keeps the real ~/Library/Logs clean across hundreds of test runs.
//
// Rotation
// --------
// One file per UTC calendar day, named `app-YYYY-MM-DD.log`. On the
// first write after midnight UTC the logger re-opens with the new
// filename; no background timer. Files older than `RETENTION_DAYS` are
// deleted at boot (only files matching the `app-*.log` glob — we don't
// wander into anything user-placed).
//
// Tee semantics
// -------------
// `process.stdout.write` and `process.stderr.write` are wrapped so the
// original TTY output is unaffected: callers still see live bun output
// when launched from a terminal, while the file captures the same
// bytes for later. A single `[boot]` banner is emitted synchronously
// on setup so even crashes during bootstrap leave a trail.
//
// Failure policy
// --------------
// Anything FS-related is wrapped in try/catch. A read-only home, a full
// disk, or a permission issue must NOT prevent the app from launching,
// so we silently fall back to "no file tee" and let the TTY path
// continue as before.

import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RETENTION_DAYS = 14;

/** UTC date stamp, `YYYY-MM-DD`. Stable for a 24h window; stable across
 *  process restarts; never needs locale data. */
function isoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Return `~/Library/Logs/tau-mux` (prod) or `$HT_CONFIG_DIR/logs` (e2e). */
function resolveLogDir(configDir: string | undefined): string {
  if (configDir && process.env["HT_CONFIG_DIR"]) {
    return join(configDir, "logs");
  }
  return join(homedir(), "Library", "Logs", "tau-mux");
}

/** Pattern: `app-2026-04-21.log`. Used for both write + prune. */
function logFileName(date: string): string {
  return `app-${date}.log`;
}

const PRUNE_PATTERN = /^app-(\d{4}-\d{2}-\d{2})\.log$/;

function pruneOldLogs(dir: string, retentionDays: number): void {
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const m = PRUNE_PATTERN.exec(name);
    if (!m) continue;
    // Parse the date out of the filename itself so pruning doesn't rely
    // on mtime (which can be skewed by backup restores or rsync).
    const fileTimeMs = Date.parse(`${m[1]}T00:00:00Z`);
    if (!Number.isFinite(fileTimeMs)) continue;
    if (fileTimeMs >= cutoffMs) continue;
    try {
      unlinkSync(join(dir, name));
    } catch {
      /* fine — next boot will try again */
    }
  }
}

export interface LoggerHandle {
  /** Absolute path of the currently-active log file, or null if the
   *  tee is disabled. Useful for the `ht` CLI / diagnostic RPCs. */
  readonly currentPath: string | null;
  /** Release the tee. stdout/stderr revert to the original writers. */
  dispose(): void;
}

export function setupLogging(configDir: string | undefined): LoggerHandle {
  const dir = resolveLogDir(configDir);

  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    // If we can't even create the dir, keep stdout/stderr as-is.
    console.error(`[logger] could not create ${dir}: ${String(err)}`);
    return { currentPath: null, dispose: () => {} };
  }

  pruneOldLogs(dir, RETENTION_DAYS);

  let activeDate = isoDate();
  let activePath = join(dir, logFileName(activeDate));
  let fd: number;
  try {
    // O_APPEND so we interleave safely with a second instance (unlikely
    // but possible — e.g. dev + packaged running side by side both log
    // here if HT_CONFIG_DIR isn't set).
    fd = openSync(activePath, "a");
    // Owner-only — the log can contain bot tokens and auth handshake
    // URLs (S1 / H.1). Chmod after open in case the file existed with
    // looser perms from a previous version.
    try {
      chmodSync(activePath, 0o600);
    } catch {
      /* best-effort — non-POSIX filesystems may reject chmod */
    }
  } catch (err) {
    console.error(`[logger] could not open ${activePath}: ${String(err)}`);
    return { currentPath: null, dispose: () => {} };
  }

  function maybeRotate(): void {
    const today = isoDate();
    if (today === activeDate) return;
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    activeDate = today;
    activePath = join(dir, logFileName(activeDate));
    try {
      fd = openSync(activePath, "a");
      try {
        chmodSync(activePath, 0o600);
      } catch {
        /* best-effort — see open path above */
      }
    } catch {
      // If reopening fails, drop the tee. Restoring the original
      // writers would silently swallow future output from within the
      // tee wrappers, so we keep the wrappers in place and let the
      // writeSync below no-op on the closed fd.
      fd = -1;
    }
  }

  function writeToFile(chunk: string | Uint8Array): void {
    if (fd < 0) return;
    maybeRotate();
    try {
      const buf =
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      writeSync(fd, buf);
    } catch {
      /* disk full, EIO, closed — swallow */
    }
  }

  // Wrap stdout/stderr.write — captures code that writes directly to
  // the streams (e.g. `process.stderr.write(...)`). Bun-native
  // `console.*` paths bypass these wrappers, so we wrap the console
  // methods separately below.
  type WriteFn = typeof process.stdout.write;
  const origStdout = process.stdout.write.bind(process.stdout) as WriteFn;
  const origStderr = process.stderr.write.bind(process.stderr) as WriteFn;

  const wrappedStdout: WriteFn = ((
    chunk: string | Uint8Array,
    encoding?: unknown,
    callback?: unknown,
  ) => {
    writeToFile(chunk);
    return (origStdout as unknown as (...a: unknown[]) => boolean)(
      chunk,
      encoding,
      callback,
    );
  }) as WriteFn;
  const wrappedStderr: WriteFn = ((
    chunk: string | Uint8Array,
    encoding?: unknown,
    callback?: unknown,
  ) => {
    writeToFile(chunk);
    return (origStderr as unknown as (...a: unknown[]) => boolean)(
      chunk,
      encoding,
      callback,
    );
  }) as WriteFn;

  process.stdout.write = wrappedStdout;
  process.stderr.write = wrappedStderr;

  // Wrap `console.{log,error,warn,info,debug}` — in Bun these go to
  // fd 1/2 natively without touching `process.stdout.write`, so the
  // stream wrappers above alone would silently miss every
  // `console.log`. We reformat each arg the same way the built-in does
  // (space-separated, util.format-style) and tee before handing off to
  // the original method.
  const origConsole = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };
  function formatArgs(args: unknown[]): string {
    return (
      args
        .map((a) => {
          if (typeof a === "string") return a;
          try {
            return Bun.inspect(a);
          } catch {
            return String(a);
          }
        })
        .join(" ") + "\n"
    );
  }
  console.log = (...args: unknown[]) => {
    writeToFile(formatArgs(args));
    origConsole.log(...args);
  };
  console.error = (...args: unknown[]) => {
    writeToFile(formatArgs(args));
    origConsole.error(...args);
  };
  console.warn = (...args: unknown[]) => {
    writeToFile(formatArgs(args));
    origConsole.warn(...args);
  };
  console.info = (...args: unknown[]) => {
    writeToFile(formatArgs(args));
    origConsole.info(...args);
  };
  console.debug = (...args: unknown[]) => {
    writeToFile(formatArgs(args));
    origConsole.debug(...args);
  };

  // Boot banner — identifies which run produced a given log block.
  // Written directly to the fd so it always lands even if the tee
  // wrappers are later disposed mid-run.
  const banner = `\n=== [boot] ${new Date().toISOString()} pid=${process.pid} cwd=${process.cwd()} e2e=${process.env["HT_E2E"] === "1"} ===\n`;
  try {
    writeSync(fd, Buffer.from(banner, "utf8"));
  } catch {
    /* ignore */
  }

  return {
    get currentPath() {
      return activePath;
    },
    dispose() {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
      console.log = origConsole.log;
      console.error = origConsole.error;
      console.warn = origConsole.warn;
      console.info = origConsole.info;
      console.debug = origConsole.debug;
      if (fd >= 0) {
        try {
          closeSync(fd);
        } catch {
          /* ignore */
        }
        fd = -1;
      }
    },
  };
}
