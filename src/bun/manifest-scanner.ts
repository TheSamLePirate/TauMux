// Generic walk-up + TTL cache for project manifest files. Used once
// for `package.json` (npm) and once for `Cargo.toml` (rust); any other
// manifest family can drop in by providing a filename + parser.
//
// Scope / invariants
// ------------------
// - `findFile` walks up from `start` looking for the configured
//   filename. Stops at `/` or `$HOME`. Bounded to 40 iterations so a
//   pathological symlink cycle can't wedge the 1 Hz poller.
// - `resolve(cwds, now)` returns the parsed manifest for each cwd,
//   honoring a TTL (default 3 s) per entry. When the file path hasn't
//   changed and the mtime hasn't changed, we skip re-parsing — on a
//   hot loop a single project stays in cache until the user saves.
// - Entries whose cwd hasn't been requested for `ttlMs * 4` ms are
//   pruned inside `resolve` to keep memory bounded across `cd` cycles.
// - Never throws. Malformed manifests collapse to `null`.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ManifestScannerOpts<T> {
  /** Filename to locate (e.g. "package.json", "Cargo.toml"). */
  filename: string;
  /** Pure parser — returns `null` on malformed input, never throws. */
  parse: (text: string, path: string) => T | null;
  /** Max age before the cached entry for a cwd is re-evaluated. */
  ttlMs?: number;
}

interface CacheEntry<T> {
  /** Resolved manifest path, or `null` if none exists above `cwd`. */
  path: string | null;
  info: T | null;
  /** mtime of `path` in ms epoch; invalidates the parsed `info` when
   *  the file changes on disk (user edits it). */
  mtime: number;
  /** Wall-clock ms when this entry was refreshed. */
  at: number;
}

const MAX_WALK_DEPTH = 40;

export class ManifestScanner<T> {
  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;
  private readonly home: string;
  /** Phase 7 — also compare against the realpath form of $HOME so a
   *  cwd that traversed a symlink / firmlink stops at the right
   *  boundary. On macOS, `/Users/x` is the canonical path but the
   *  realpath can be `/System/Volumes/Data/Users/x` (firmlinks); on
   *  Linux a user's $HOME may be `/home/x` while a tmp build mount
   *  resolves through `/private/home/x`. Without this guard the
   *  walk-up runs all the way to `/` (still bounded by MAX_WALK_DEPTH)
   *  but misses the chance to short-circuit at $HOME — a manifest
   *  sitting at the user's home root would be incorrectly returned
   *  for an unrelated cwd. */
  private readonly homeRealpath: string;

  constructor(private readonly opts: ManifestScannerOpts<T>) {
    this.ttlMs = opts.ttlMs ?? 3000;
    this.home = process.env["HOME"] ?? "";
    // Resolve once at construction. realpathSync throws on a missing
    // path; fall back to the literal $HOME so the check still
    // matches the unsymlinked form.
    let resolved = this.home;
    if (this.home) {
      try {
        resolved = realpathSync(this.home);
      } catch {
        /* keep the literal */
      }
    }
    this.homeRealpath = resolved;
  }

  /** Walk up from `start` looking for the configured filename. Stops
   *  at the filesystem root or at `$HOME` (matched against either the
   *  literal env value or its realpath, so symlinked / firmlinked
   *  homes don't escape the boundary). Returns the absolute path,
   *  or `null`. Exposed for unit tests and CLI diagnostics.
   *
   *  Phase 7 — at each step we ALSO realpath the candidate dir and
   *  compare against the realpath'd $HOME. macOS ships `/Users/x`
   *  as a firmlink for `/System/Volumes/Data/Users/x`; without the
   *  per-step realpath the boundary check would only fire when the
   *  raw env value matched the raw walk segment. Deliberately
   *  realpath'ing per step (not once at the start) keeps output
   *  paths in their canonical form so callers see the path they
   *  passed in. */
  findFile(start: string): string | null {
    if (!start || !start.startsWith("/")) return null;
    let dir = start;
    for (let i = 0; i < MAX_WALK_DEPTH; i++) {
      const candidate = join(dir, this.opts.filename);
      if (existsSync(candidate)) return candidate;
      if (dir === "/" || dir === this.home) return null;
      if (this.homeRealpath && this.homeRealpath !== this.home) {
        // Check the realpath of `dir` against the realpath'd $HOME.
        // The compare is cheap when the OS already cached the
        // resolution (the same dir gets re-resolved across iterations
        // anyway).
        let resolved = dir;
        try {
          resolved = realpathSync(dir);
        } catch {
          /* missing — fall through to the literal comparison */
        }
        if (resolved === this.homeRealpath) return null;
      }
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
    return null;
  }

  /** Resolve the manifest for each cwd, honoring the per-cwd TTL and
   *  mtime-based invalidation. Also prunes entries for cwds that
   *  haven't been requested in a while so long-lived sessions don't
   *  accumulate dead cache rows. */
  resolve(cwds: Set<string>, now: number): Map<string, T | null> {
    const result = new Map<string, T | null>();
    for (const cwd of cwds) {
      const cached = this.cache.get(cwd);
      let entry = cached;

      if (!entry || now - entry.at >= this.ttlMs) {
        const path = this.findFile(cwd);
        let info: T | null = null;
        let mtime = 0;
        if (path) {
          try {
            const s = statSync(path);
            mtime = s.mtimeMs;
            if (cached && cached.path === path && cached.mtime === mtime) {
              info = cached.info;
            } else {
              const text = readFileSync(path, "utf-8");
              info = this.opts.parse(text, path);
            }
          } catch {
            info = null;
          }
        }
        entry = { path, info, mtime, at: now };
        this.cache.set(cwd, entry);
      }

      result.set(cwd, entry.info);
    }
    for (const k of [...this.cache.keys()]) {
      if (!cwds.has(k) && now - this.cache.get(k)!.at > this.ttlMs * 4) {
        this.cache.delete(k);
      }
    }
    return result;
  }

  clear(): void {
    this.cache.clear();
  }
}
