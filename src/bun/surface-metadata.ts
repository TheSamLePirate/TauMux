/**
 * Per-surface live metadata: cwd, foreground process, descendant tree,
 * listening TCP ports. Derived entirely from `ps` and `lsof` against the
 * shell pid we already track in SessionManager; no shell integration or
 * tmux required.
 *
 * One shared poller ticks at 1 Hz. Per tick: one `ps` call (parsed once
 * for all surfaces), one combined `lsof -iTCP -sTCP:LISTEN` across the
 * union of tree pids, one combined `lsof -d cwd` across foreground pids.
 * Emits `onMetadata(surfaceId, metadata)` only when a snapshot actually
 * changed vs the previous tick.
 */

import { dirname } from "node:path";
import type {
  CargoInfo,
  GitInfo,
  ListeningPort,
  PackageInfo,
  ProcessNode,
  SurfaceMetadata,
} from "../shared/types";
import { ManifestScanner } from "./manifest-scanner";
import { parseCargoToml } from "./parse-cargo-toml";

export interface PsRow {
  pid: number;
  ppid: number;
  pgid: number;
  /** STAT column; contains "+" for processes in the pane's foreground pgrp. */
  stat: string;
  /** Instantaneous CPU%. */
  cpu: number;
  /** Resident set size in KB. */
  rssKb: number;
  /** Full argv from `ps -o args -ww` (not truncated). */
  command: string;
}

// --- Pure parsers (exported for tests) -------------------------------------

export function parsePs(output: string): Map<number, PsRow> {
  const result = new Map<number, PsRow>();
  for (const line of output.split("\n")) {
    const trimmed = line.replace(/^\s+/, "");
    // 6 numeric-ish columns (pid ppid pgid stat cpu rss) then raw args.
    // CPU% can use either "." or "," as decimal separator depending on
    // the system locale (macOS honors LC_NUMERIC, so fr_FR → "0,4").
    const m = trimmed.match(
      /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([\d.,]+)\s+(\d+)\s+(.*)$/,
    );
    if (!m) continue;
    const pid = Number(m[1]);
    if (!Number.isFinite(pid)) continue;
    result.set(pid, {
      pid,
      ppid: Number(m[2]),
      pgid: Number(m[3]),
      stat: m[4],
      cpu: Number(m[5].replace(",", ".")),
      rssKb: Number(m[6]),
      command: m[7],
    });
  }
  return result;
}

export function parseListenAddress(
  value: string,
): { address: string; port: number } | null {
  const idx = value.lastIndexOf(":");
  if (idx <= 0) return null;
  const port = Number(value.slice(idx + 1));
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  let host = value.slice(0, idx);
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return { address: host, port };
}

export function parseListeningPorts(
  output: string,
): Map<number, ListeningPort[]> {
  const result = new Map<number, ListeningPort[]>();
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    if (!line) continue;
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      const n = Number(value);
      pid = Number.isFinite(n) ? n : null;
    } else if (tag === "n" && pid !== null) {
      const parsed = parseListenAddress(value);
      if (!parsed) continue;
      const isV6 = parsed.address.includes(":");
      const proto: "tcp" | "tcp6" = isV6 ? "tcp6" : "tcp";
      const entries = result.get(pid) ?? [];
      // Dedupe: lsof emits one record per fd, so forked sockets appear twice.
      const already = entries.some(
        (e) =>
          e.port === parsed.port &&
          e.address === parsed.address &&
          e.proto === proto,
      );
      if (already) continue;
      entries.push({ pid, port: parsed.port, proto, address: parsed.address });
      result.set(pid, entries);
    }
  }
  return result;
}

/**
 * Parse `git status --porcelain=v2 -b` output into a (partially populated)
 * GitInfo. Line counts (`insertions`/`deletions`) remain 0 — use
 * `parseShortstat` on `git diff HEAD --shortstat` and merge.
 *
 * Returns `null` only when the input is empty (non-repo); otherwise always
 * returns a valid object, even if the branch line is missing (which happens
 * on very-fresh repos with no commits yet).
 */
export function parseGitStatusV2(output: string): GitInfo | null {
  if (!output) return null;
  const info: GitInfo = {
    branch: "",
    head: "",
    upstream: "",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
    insertions: 0,
    deletions: 0,
    detached: false,
  };
  for (const line of output.split("\n")) {
    if (!line) continue;
    if (line.startsWith("# branch.oid ")) {
      const val = line.slice("# branch.oid ".length);
      info.head = val === "(initial)" ? "" : val.slice(0, 12);
    } else if (line.startsWith("# branch.head ")) {
      const val = line.slice("# branch.head ".length);
      info.branch = val;
      info.detached = val === "(detached)";
    } else if (line.startsWith("# branch.upstream ")) {
      info.upstream = line.slice("# branch.upstream ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) {
        info.ahead = parseInt(m[1]!, 10);
        info.behind = parseInt(m[2]!, 10);
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      // Entry format: "1 XY sub mH mI mW hH hI path"
      //          or "2 XY sub mH mI mW hH hI Xscore origPath\tpath"
      // XY[0] = index state, XY[1] = working-tree state; '.' means unchanged.
      const xy = line.slice(2, 4);
      if (xy[0] && xy[0] !== "." && xy[0] !== " ") info.staged++;
      if (xy[1] && xy[1] !== "." && xy[1] !== " ") info.unstaged++;
    } else if (line.startsWith("? ")) {
      info.untracked++;
    } else if (line.startsWith("u ")) {
      info.conflicts++;
    }
  }
  return info;
}

/**
 * Parse `git diff --shortstat` output, e.g.:
 *   " 3 files changed, 42 insertions(+), 15 deletions(-)"
 *   " 1 file changed, 5 deletions(-)"
 *   " 1 file changed, 10 insertions(+)"
 * Empty output → { insertions: 0, deletions: 0 }.
 */
export function parseShortstat(output: string): {
  insertions: number;
  deletions: number;
} {
  const ins = output.match(/(\d+)\s+insertion/);
  const del = output.match(/(\d+)\s+deletion/);
  return {
    insertions: ins ? parseInt(ins[1]!, 10) : 0,
    deletions: del ? parseInt(del[1]!, 10) : 0,
  };
}

/**
 * Parse the subset of package.json that the UI cares about. Never throws —
 * malformed JSON or unexpected shapes collapse to `null`.
 */
export function parsePackageJson(
  text: string,
  path: string,
): PackageInfo | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const info: PackageInfo = {
    path,
    directory: dirname(path),
  };
  if (typeof obj["name"] === "string") info.name = obj["name"];
  if (typeof obj["version"] === "string") info.version = obj["version"];
  if (typeof obj["type"] === "string") info.type = obj["type"];
  if (typeof obj["description"] === "string")
    info.description = obj["description"];
  const bin = obj["bin"];
  if (typeof bin === "string") {
    info.bin = bin;
  } else if (bin && typeof bin === "object") {
    const coerced: Record<string, string> = {};
    for (const [k, v] of Object.entries(bin)) {
      if (typeof v === "string") coerced[k] = v;
    }
    if (Object.keys(coerced).length > 0) info.bin = coerced;
  }
  const scripts = obj["scripts"];
  if (scripts && typeof scripts === "object") {
    const coerced: Record<string, string> = {};
    for (const [k, v] of Object.entries(scripts)) {
      if (typeof v === "string") coerced[k] = v;
    }
    if (Object.keys(coerced).length > 0) info.scripts = coerced;
  }
  // Refuse to surface a "shell" manifest whose only fields are the
  // file path itself — without a name, version, description, scripts
  // or bin entry there's nothing to put in the sidebar card and we'd
  // otherwise render an empty "package.json" header. Mirrors
  // parseCargoToml which already requires `[package]` or `[workspace]`.
  if (
    !info.name &&
    !info.version &&
    !info.description &&
    !info.scripts &&
    !info.bin
  ) {
    return null;
  }
  return info;
}

/**
 * Walk up from `start` looking for the nearest `package.json`. Kept as a
 * thin wrapper for callers that only want the path lookup; the poller
 * itself uses `ManifestScanner<PackageInfo>` via `pkgScanner`.
 */
export function findPackageJson(start: string): string | null {
  return pkgScanner.findFile(start);
}

/** Shared scanner instances — one per manifest family. Re-used across
 *  the module instead of holding per-Poller caches so the generic
 *  walk-up / TTL / mtime-invalidation logic lives in exactly one
 *  place (`ManifestScanner`). */
const pkgScanner = new ManifestScanner<PackageInfo>({
  filename: "package.json",
  parse: parsePackageJson,
});
const cargoScanner = new ManifestScanner<CargoInfo>({
  filename: "Cargo.toml",
  parse: parseCargoToml,
});

/**
 * Parse `lsof -a -d cwd -F pn -p <pids>` output.
 * Each process yields one `p<pid>` line followed by one `n<cwd>` line.
 */
export function parseCwds(output: string): Map<number, string> {
  const result = new Map<number, string>();
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    if (!line) continue;
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      const n = Number(value);
      pid = Number.isFinite(n) ? n : null;
    } else if (tag === "n" && pid !== null && !result.has(pid)) {
      result.set(pid, value);
    }
  }
  return result;
}

/** Walk descendants of rootPid from a ps snapshot, pre-order, deterministic. */
export function walkTree(
  rootPid: number,
  psMap: Map<number, PsRow>,
): ProcessNode[] {
  const children = new Map<number, number[]>();
  for (const row of psMap.values()) {
    if (row.stat.includes("Z")) continue;
    const list = children.get(row.ppid) ?? [];
    list.push(row.pid);
    children.set(row.ppid, list);
  }
  const result: ProcessNode[] = [];
  const visit = (pid: number): void => {
    const row = psMap.get(pid);
    if (!row) return;
    result.push({
      pid: row.pid,
      ppid: row.ppid,
      command: row.command,
      cpu: row.cpu,
      rssKb: row.rssKb,
    });
    const kids = children.get(pid);
    if (!kids) return;
    for (const k of [...kids].sort((a, b) => a - b)) visit(k);
  };
  visit(rootPid);
  return result;
}

/**
 * Foreground process on the pane's tty: pgrp leader with "+" in stat.
 * Falls back to any "+" process, then to the root (shell) pid.
 */
export function findForegroundPid(
  tree: ProcessNode[],
  psMap: Map<number, PsRow>,
): number {
  for (const node of tree) {
    const row = psMap.get(node.pid);
    if (row && row.stat.includes("+") && row.pid === row.pgid) return row.pid;
  }
  for (const node of tree) {
    const row = psMap.get(node.pid);
    if (row && row.stat.includes("+")) return row.pid;
  }
  return tree[0]?.pid ?? 0;
}

export function metadataEqual(a: SurfaceMetadata, b: SurfaceMetadata): boolean {
  if (
    a.pid !== b.pid ||
    a.foregroundPid !== b.foregroundPid ||
    a.cwd !== b.cwd ||
    a.tree.length !== b.tree.length ||
    a.listeningPorts.length !== b.listeningPorts.length ||
    !gitEqual(a.git, b.git) ||
    !pkgEqual(a.packageJson, b.packageJson) ||
    !cargoEqual(a.cargoToml, b.cargoToml)
  ) {
    return false;
  }
  for (let i = 0; i < a.tree.length; i++) {
    const x = a.tree[i];
    const y = b.tree[i];
    if (x.pid !== y.pid || x.ppid !== y.ppid || x.command !== y.command) {
      return false;
    }
  }
  for (let i = 0; i < a.listeningPorts.length; i++) {
    const x = a.listeningPorts[i];
    const y = b.listeningPorts[i];
    if (
      x.pid !== y.pid ||
      x.port !== y.port ||
      x.proto !== y.proto ||
      x.address !== y.address
    ) {
      return false;
    }
  }
  return true;
}

function pkgEqual(a: PackageInfo | null, b: PackageInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.path !== b.path ||
    a.name !== b.name ||
    a.version !== b.version ||
    a.type !== b.type ||
    a.description !== b.description
  ) {
    return false;
  }
  if (JSON.stringify(a.bin) !== JSON.stringify(b.bin)) return false;
  if (JSON.stringify(a.scripts) !== JSON.stringify(b.scripts)) return false;
  return true;
}

function cargoEqual(a: CargoInfo | null, b: CargoInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.path !== b.path ||
    a.name !== b.name ||
    a.version !== b.version ||
    a.edition !== b.edition ||
    a.description !== b.description ||
    a.isWorkspace !== b.isWorkspace ||
    a.binaries.length !== b.binaries.length ||
    a.features.length !== b.features.length
  ) {
    return false;
  }
  for (let i = 0; i < a.binaries.length; i++) {
    if (a.binaries[i] !== b.binaries[i]) return false;
  }
  for (let i = 0; i < a.features.length; i++) {
    if (a.features[i] !== b.features[i]) return false;
  }
  return true;
}

function gitEqual(a: GitInfo | null, b: GitInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.branch === b.branch &&
    a.head === b.head &&
    a.upstream === b.upstream &&
    a.ahead === b.ahead &&
    a.behind === b.behind &&
    a.staged === b.staged &&
    a.unstaged === b.unstaged &&
    a.untracked === b.untracked &&
    a.conflicts === b.conflicts &&
    a.insertions === b.insertions &&
    a.deletions === b.deletions &&
    a.detached === b.detached
  );
}

// --- Poller ----------------------------------------------------------------

interface SurfaceLike {
  id: string;
  pty: { pid: number | null };
}

interface SessionsLike {
  getAllSurfaces(): SurfaceLike[];
}

interface GitCacheEntry {
  info: GitInfo | null;
  at: number;
}

export class SurfaceMetadataPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  /** Fenced once stop() has been called. An in-flight tick must not
   *  repopulate caches the stop call just cleared. */
  private stopped = false;
  private last = new Map<string, SurfaceMetadata>();
  /** cwd → git snapshot + freshness. Reuses across ticks (TTL gated). */
  private gitCache = new Map<string, GitCacheEntry>();
  private gitTtlMs = 3000;

  onMetadata: ((surfaceId: string, metadata: SurfaceMetadata) => void) | null =
    null;

  constructor(
    private sessions: SessionsLike,
    private intervalMs = 1000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.last.clear();
    this.gitCache.clear();
    pkgScanner.clear();
    cargoScanner.clear();
  }

  /** Adjust tick interval at runtime. Restarts the timer if already running.
   *  When speeding up (ms got smaller — e.g. window became visible again),
   *  fires an immediate tick so the user sees fresh chips/metadata on focus
   *  return rather than waiting up to 3s for the next scheduled tick. */
  setPollRate(ms: number): void {
    const next = Math.max(250, Math.floor(ms));
    if (next === this.intervalMs) return;
    const speedingUp = next < this.intervalMs;
    this.intervalMs = next;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        void this.tick();
      }, this.intervalMs);
      if (speedingUp) {
        // Immediate refresh — any in-flight tick is short-circuited by
        // `inFlight` in tick() itself, so this is safe even if one's
        // already running.
        void this.tick();
      }
    }
  }

  /** Exposed for `ht` CLI / tests. */
  getSnapshot(surfaceId: string): SurfaceMetadata | null {
    return this.last.get(surfaceId) ?? null;
  }

  private async tick(): Promise<void> {
    if (this.inFlight || this.stopped) return;
    this.inFlight = true;
    try {
      if (this.stopped) return;
      const surfaces = this.sessions
        .getAllSurfaces()
        .filter(
          (s): s is SurfaceLike & { pty: { pid: number } } =>
            typeof s.pty.pid === "number",
        );

      // Drop snapshots for surfaces that no longer exist.
      const live = new Set(surfaces.map((s) => s.id));
      for (const k of [...this.last.keys()]) {
        if (!live.has(k)) this.last.delete(k);
      }
      if (surfaces.length === 0) {
        // No active terminals — release cached data that would otherwise
        // sit in memory indefinitely (manifest scanners / gitCache are
        // only pruned inside their resolve paths which are skipped when
        // no cwds to resolve).
        this.gitCache.clear();
        pkgScanner.clear();
        cargoScanner.clear();
        return;
      }

      const psMap = await runPs();
      if (!psMap) return;

      // Compute trees + fg pid first; gather union of pids.
      const per = new Map<string, { tree: ProcessNode[]; fg: number }>();
      const treePids = new Set<number>();
      const fgPids = new Set<number>();
      for (const s of surfaces) {
        const tree = walkTree(s.pty.pid, psMap);
        if (tree.length === 0) continue;
        const fg = findForegroundPid(tree, psMap);
        per.set(s.id, { tree, fg });
        for (const n of tree) treePids.add(n.pid);
        fgPids.add(fg);
      }

      const [portsByPid, cwdByPid] = await Promise.all([
        treePids.size > 0
          ? runListeningPorts([...treePids])
          : Promise.resolve(new Map()),
        fgPids.size > 0 ? runCwds([...fgPids]) : Promise.resolve(new Map()),
      ]);

      const now = Date.now();

      // Resolve git info for every unique cwd in this tick, TTL-cached.
      const cwds = new Set<string>();
      for (const { fg } of per.values()) {
        const cwd = cwdByPid.get(fg);
        if (cwd) cwds.add(cwd);
      }
      const gitByCwd = await this.resolveGit(cwds, now);
      const pkgByCwd = pkgScanner.resolve(cwds, now);
      const cargoByCwd = cargoScanner.resolve(cwds, now);

      // Drop git cache entries for cwds that have disappeared (saves
      // memory across `cd` cycles over time).
      for (const k of [...this.gitCache.keys()]) {
        if (
          !cwds.has(k) &&
          now - this.gitCache.get(k)!.at > this.gitTtlMs * 4
        ) {
          this.gitCache.delete(k);
        }
      }

      for (const s of surfaces) {
        const entry = per.get(s.id);
        if (!entry) continue;
        const { tree, fg } = entry;

        const listeningPorts: ListeningPort[] = [];
        for (const n of tree) {
          const list = portsByPid.get(n.pid);
          if (list) listeningPorts.push(...list);
        }
        listeningPorts.sort(
          (a, b) =>
            a.port - b.port ||
            a.pid - b.pid ||
            a.address.localeCompare(b.address),
        );

        const cwd = cwdByPid.get(fg) ?? "";
        const metadata: SurfaceMetadata = {
          pid: s.pty.pid,
          foregroundPid: fg,
          cwd,
          tree,
          listeningPorts,
          git: cwd ? (gitByCwd.get(cwd) ?? null) : null,
          packageJson: cwd ? (pkgByCwd.get(cwd) ?? null) : null,
          cargoToml: cwd ? (cargoByCwd.get(cwd) ?? null) : null,
          updatedAt: now,
        };

        const prev = this.last.get(s.id);
        if (!prev || !metadataEqual(prev, metadata)) {
          this.last.set(s.id, metadata);
          this.onMetadata?.(s.id, metadata);
        }
      }
    } catch (err) {
      // Poller failures must never crash the app.
      console.error("[metadata] tick failed:", err);
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Collect git snapshots for the given cwds, honoring the per-cwd TTL.
   * Runs at most one `git status` + one `git diff --shortstat` per stale
   * entry, in parallel across cwds.
   */
  private async resolveGit(
    cwds: Set<string>,
    now: number,
  ): Promise<Map<string, GitInfo | null>> {
    const result = new Map<string, GitInfo | null>();
    const stale: string[] = [];
    for (const cwd of cwds) {
      const cached = this.gitCache.get(cwd);
      if (cached && now - cached.at < this.gitTtlMs) {
        result.set(cwd, cached.info);
      } else {
        stale.push(cwd);
      }
    }
    if (stale.length === 0) return result;

    await Promise.all(
      stale.map(async (cwd) => {
        const info = await runGit(cwd);
        this.gitCache.set(cwd, { info, at: now });
        result.set(cwd, info);
      }),
    );
    return result;
  }
}

// --- Subprocess runners ----------------------------------------------------

/** Default timeout applied to every metadata subprocess. If ps/lsof/git
 *  hangs (slow NFS, contended FS lock) we must not wedge the poller —
 *  the next tick will retry. */
const SUBPROCESS_TIMEOUT_MS = 5000;

/** Build a child-process env that pins every locale category to POSIX.
 *  Setting only `LC_ALL` is *almost* enough — most libc implementations
 *  honor `LC_ALL` over the per-category vars — but a few (glibc with
 *  certain locale archives, IEEE 1003.1 edge cases) read the more
 *  specific category when available. We cover them all so a user
 *  shipping a custom `LC_NUMERIC=fr_FR.UTF-8` in their environment
 *  cannot accidentally re-introduce comma decimal separators in our
 *  `ps` output. Issue I13 in doc/full_analysis.md. */
function posixLocaleEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    LC_ALL: "C",
    LANG: "C",
    LC_NUMERIC: "C",
    LC_MONETARY: "C",
    LC_TIME: "C",
    LC_COLLATE: "C",
    LC_CTYPE: "C",
    LC_MESSAGES: "C",
  };
}

/** Run a command and return {stdout, exitCode} or null if it failed, was
 *  killed by the timeout, or threw at spawn. Stderr is consumed in
 *  parallel so the child cannot deadlock by filling a 64 KiB pipe
 *  buffer. On timeout the process is explicitly killed and reaped so we
 *  don't leak zombies. */
// One-shot diagnostic: whenever a metadata subprocess command fails with
// ENOENT (binary missing from PATH), emit a single console warning per
// binary name. Repeated failures stay silent — a system without `lsof`
// would otherwise spam 1 warning/sec from the 1 Hz poller.
const _missingBinariesWarned = new Set<string>();

async function runSubprocess(
  argv: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
  timeoutMs: number = SUBPROCESS_TIMEOUT_MS,
): Promise<{ stdout: string; exitCode: number } | null> {
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  try {
    const spawnOpts: Parameters<typeof Bun.spawn>[1] = {
      stdout: "pipe",
      stderr: "pipe",
    };
    if (opts.cwd) spawnOpts.cwd = opts.cwd;
    if (opts.env) spawnOpts.env = opts.env;
    proc = Bun.spawn(argv, spawnOpts);

    timer = setTimeout(() => {
      timedOut = true;
      try {
        proc?.kill();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    (timer as { unref?: () => void }).unref?.();

    // Drain stderr in parallel so the child can't block on a full pipe
    // (macOS pipe buffer is 64 KiB). The stderr content itself is
    // discarded — parsers only want stdout. Cast to ReadableStream
    // — stdio is "pipe" here, so the number-fd branch of Bun's
    // stdout/stderr union doesn't apply.
    const stdoutStream = proc.stdout as ReadableStream<Uint8Array>;
    const stderrStream = proc.stderr as ReadableStream<Uint8Array>;
    const [stdout, , exitCode] = await Promise.all([
      new Response(stdoutStream).text(),
      new Response(stderrStream).text(),
      proc.exited,
    ]);
    if (timedOut) return null;
    return { stdout, exitCode };
  } catch (err) {
    try {
      proc?.kill();
    } catch {
      /* ignore */
    }
    // Distinguish "binary not in PATH" from generic spawn failures so
    // users see *why* metadata is empty. Log once per binary to avoid
    // spamming the 1 Hz poller.
    const msg = err instanceof Error ? err.message : String(err);
    const binary = argv[0];
    if (
      /ENOENT|posix_spawn.+ENOENT|No such file or directory/i.test(msg) &&
      binary &&
      !_missingBinariesWarned.has(binary)
    ) {
      _missingBinariesWarned.add(binary);
      console.warn(
        `[metadata] \`${binary}\` not found on PATH — related chips will stay empty`,
      );
    }
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runPs(): Promise<Map<number, PsRow> | null> {
  const res = await runSubprocess(
    ["ps", "-axo", "pid,ppid,pgid,stat,%cpu,rss,args", "-ww"],
    // Force POSIX locale so CPU% always formats as "0.4" (not "0,4"
    // in locales like fr_FR, de_DE). Neutralize every category in
    // case the user has e.g. `LC_NUMERIC=fr_FR` overriding `LC_ALL`.
    { env: posixLocaleEnv() },
  );
  if (!res || res.exitCode !== 0) return null;
  return parsePs(res.stdout);
}

async function runListeningPorts(
  pids: number[],
): Promise<Map<number, ListeningPort[]>> {
  if (pids.length === 0) return new Map();
  const res = await runSubprocess([
    "lsof",
    "-nP",
    "-iTCP",
    "-sTCP:LISTEN",
    "-F",
    "pn",
    "-w",
    "-a",
    "-p",
    pids.join(","),
  ]);
  // lsof exits non-zero when no matches; treat empty output as a valid
  // answer rather than a failure.
  if (!res) return new Map();
  return parseListeningPorts(res.stdout);
}

/**
 * Run `git status --porcelain=v2 -b` + `git diff HEAD --shortstat` inside
 * `cwd`. Returns null when `cwd` is not inside a git work tree (exit != 0).
 * Never throws — subprocess failures degrade gracefully to null.
 */
async function runGit(cwd: string): Promise<GitInfo | null> {
  const gitEnv = posixLocaleEnv();
  const statusRes = await runSubprocess(
    ["git", "status", "--porcelain=v2", "-b"],
    { cwd, env: gitEnv },
  );
  if (!statusRes || statusRes.exitCode !== 0) return null;

  const info = parseGitStatusV2(statusRes.stdout);
  if (!info) return null;

  const diffRes = await runSubprocess(["git", "diff", "HEAD", "--shortstat"], {
    cwd,
    env: gitEnv,
  });
  if (diffRes && diffRes.exitCode === 0) {
    const { insertions, deletions } = parseShortstat(diffRes.stdout);
    info.insertions = insertions;
    info.deletions = deletions;
  }
  return info;
}

async function runCwds(pids: number[]): Promise<Map<number, string>> {
  if (pids.length === 0) return new Map();
  const res = await runSubprocess([
    "lsof",
    "-a",
    "-d",
    "cwd",
    "-F",
    "pn",
    "-w",
    "-p",
    pids.join(","),
  ]);
  if (!res) return new Map();
  return parseCwds(res.stdout);
}
