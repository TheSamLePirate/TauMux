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

import type {
  ListeningPort,
  ProcessNode,
  SurfaceMetadata,
} from "../shared/types";

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
    a.listeningPorts.length !== b.listeningPorts.length
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

// --- Poller ----------------------------------------------------------------

interface SurfaceLike {
  id: string;
  pty: { pid: number | null };
}

interface SessionsLike {
  getAllSurfaces(): SurfaceLike[];
}

export class SurfaceMetadataPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private last = new Map<string, SurfaceMetadata>();

  onMetadata: ((surfaceId: string, metadata: SurfaceMetadata) => void) | null =
    null;

  constructor(
    private sessions: SessionsLike,
    private intervalMs = 1000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.last.clear();
  }

  /** Adjust tick interval at runtime. Restarts the timer if already running. */
  setPollRate(ms: number): void {
    const next = Math.max(250, Math.floor(ms));
    if (next === this.intervalMs) return;
    this.intervalMs = next;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        void this.tick();
      }, this.intervalMs);
    }
  }

  /** Exposed for `ht` CLI / tests. */
  getSnapshot(surfaceId: string): SurfaceMetadata | null {
    return this.last.get(surfaceId) ?? null;
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
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
      if (surfaces.length === 0) return;

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

        const metadata: SurfaceMetadata = {
          pid: s.pty.pid,
          foregroundPid: fg,
          cwd: cwdByPid.get(fg) ?? "",
          tree,
          listeningPorts,
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
}

// --- Subprocess runners ----------------------------------------------------

async function runPs(): Promise<Map<number, PsRow> | null> {
  try {
    const proc = Bun.spawn(
      ["ps", "-axo", "pid,ppid,pgid,stat,%cpu,rss,args", "-ww"],
      {
        stdout: "pipe",
        stderr: "pipe",
        // Force POSIX locale so CPU% always formats as "0.4" (not "0,4"
        // in locales like fr_FR, de_DE).
        env: { ...process.env, LC_ALL: "C", LANG: "C" },
      },
    );
    const [out, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (code !== 0) return null;
    return parsePs(out);
  } catch {
    return null;
  }
}

async function runListeningPorts(
  pids: number[],
): Promise<Map<number, ListeningPort[]>> {
  if (pids.length === 0) return new Map();
  try {
    const proc = Bun.spawn(
      [
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
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [out] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    // lsof exits non-zero when no matches; the empty output is a valid answer.
    return parseListeningPorts(out);
  } catch {
    return new Map();
  }
}

async function runCwds(pids: number[]): Promise<Map<number, string>> {
  if (pids.length === 0) return new Map();
  try {
    const proc = Bun.spawn(
      ["lsof", "-a", "-d", "cwd", "-F", "pn", "-w", "-p", pids.join(",")],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [out] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    return parseCwds(out);
  } catch {
    return new Map();
  }
}
