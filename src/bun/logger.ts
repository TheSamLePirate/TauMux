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
// Size-based rotation (P9): a single multi-day session can swell
// `app-DATE.log` to multi-GiB if a chatty subsystem (PTY noise, agent
// streams, sideband demos) is misbehaving. When the active file
// exceeds `MAX_BYTES_PER_FILE` (50 MiB default, override via
// `HT_LOG_MAX_BYTES`), we rename the current file to `app-DATE.<n>.log`
// (next available index 1, 2, 3, …) and open a fresh `app-DATE.log`.
// `tail -f app-DATE.log` always follows the newest chunk; numbered
// chunks form the archive. The prune-by-date pass also matches the
// numbered variants.
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
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RETENTION_DAYS = 14;

/** W1-5 (full_app_review_2026-05.md §16.1) — secret-shaped patterns scrubbed
 *  from every line before it reaches the on-disk tee. Centralising this in
 *  the logger (rather than relying on every call site to log `err.message`)
 *  means a future `catch (err) { console.warn(prefix, err) }` around a
 *  telegram/auth request can't silently persist a credential for 14 days. */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Telegram bot token: `<digits>:<35ish base64url chars>` (with `bot` prefix
  // in the api.telegram.org URL Bun.inspect prints on a fetch error).
  [/bot(\d{4,}):[A-Za-z0-9_-]{20,}/g, "bot$1:<redacted>"],
  // Bare telegram token shape (no `bot` prefix) — keep the leading digits
  // group short-circuited so we don't mangle ordinary `123:456` text: require
  // the secret half to be long + token-charset.
  [/\b(\d{6,}):([A-Za-z0-9_-]{30,})\b/g, "$1:<redacted>"],
  // token= / auth= / access_token= in a URL or query string.
  [/([?&](?:token|auth|access_token)=)[^&\s"'\\]+/gi, "$1<redacted>"],
  // Authorization: Bearer <token>
  [/(authorization:\s*bearer\s+)[A-Za-z0-9._-]+/gi, "$1<redacted>"],
];

/** Replace secret-shaped substrings with `<redacted>`. Pure + exported so
 *  it can be unit-tested directly. Safe on any string; leaves
 *  non-secret-shaped text untouched. */
export function redactSecrets(s: string): string {
  let out = s;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

/** P9 — size-based rotation threshold. 50 MiB default; HT_LOG_MAX_BYTES
 *  env override for tests + power users. A value ≤ 0 disables size
 *  rotation entirely (date rotation still applies). Resolved per
 *  setupLogging call so tests can flip it between cases. */
function resolveMaxBytes(): number {
  const raw = process.env["HT_LOG_MAX_BYTES"];
  if (!raw) return 50 * 1024 * 1024;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 50 * 1024 * 1024;
}

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

// Matches both `app-2026-04-21.log` (the active chunk) AND the rotated
// variants `app-2026-04-21.<n>.log` (P9 size rotation).
const PRUNE_PATTERN = /^app-(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.log$/;

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
  const maxBytes = resolveMaxBytes();

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
  /** Bytes in the active chunk. Seeded from fstat at open so a
   *  same-day restart picks up where we left off. */
  let bytesInActive = 0;
  try {
    // O_APPEND so we interleave safely with a second instance (unlikely
    // but possible — e.g. dev + packaged running side by side both log
    // here if HT_CONFIG_DIR isn't set).
    fd = openSync(activePath, "a");
    try {
      bytesInActive = fstatSync(fd).size;
    } catch {
      /* best-effort — ignore stat failures */
    }
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

  /** Find the next available `app-DATE.<n>.log` name. n starts at 1. */
  function nextRotatedName(date: string): string {
    for (let n = 1; n < 10_000; n++) {
      const candidate = join(dir, `app-${date}.${n}.log`);
      if (!existsSync(candidate)) return candidate;
    }
    // Pathological — give up and overwrite slot 9999.
    return join(dir, `app-${date}.9999.log`);
  }

  function rotateForSize(): void {
    // Pull the current chunk aside under a numbered name, then open a
    // fresh `app-DATE.log` for the next chunk. `tail -f app-DATE.log`
    // always follows the newest output.
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      renameSync(activePath, nextRotatedName(activeDate));
    } catch {
      // If the rename fails (cross-device, permissions, whatever), the
      // active file is still there — open and append. Next rotation
      // attempt will retry.
    }
    try {
      fd = openSync(activePath, "a");
      bytesInActive = 0;
      try {
        chmodSync(activePath, 0o600);
      } catch {
        /* best-effort */
      }
    } catch {
      fd = -1;
    }
  }

  function maybeRotateDate(): void {
    const today = isoDate();
    if (today === activeDate) return;
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    activeDate = today;
    activePath = join(dir, logFileName(activeDate));
    bytesInActive = 0;
    try {
      fd = openSync(activePath, "a");
      try {
        bytesInActive = fstatSync(fd).size;
      } catch {
        /* ignore */
      }
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
    maybeRotateDate();
    try {
      const buf =
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      writeSync(fd, buf);
      bytesInActive += buf.byteLength;
      // P9 size rotation — check AFTER the write so the current chunk
      // gets the full burst (rather than splitting mid-line).
      if (maxBytes > 0 && bytesInActive >= maxBytes) {
        rotateForSize();
      }
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
    const body = args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return Bun.inspect(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");
    // W1-5 (full_app_review_2026-05.md §16.1): scrub secrets before the
    // line hits the on-disk 14-day tee. `Bun.inspect` of a raw fetch error
    // prints the token-bearing telegram URL; redacting here defends every
    // console.* call site centrally, including future ones a refactor adds.
    return redactSecrets(body) + "\n";
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
