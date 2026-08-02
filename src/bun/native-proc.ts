/**
 * Native (FFI) process introspection for the metadata poller.
 *
 * The poller used to derive everything from three subprocesses per 1 Hz
 * tick — `ps -axo …`, `lsof -iTCP -sTCP:LISTEN`, and `lsof -d cwd`.
 * Measured on an M-series Mac with ~990 live processes those cost 68 ms,
 * 61 ms, and 71 ms respectively: roughly 200 ms of CPU every second,
 * forever, whether or not anything on screen changed.
 *
 * Every fact those three calls provide is available from libSystem
 * without forking:
 *
 *   - `sysctl(CTL_KERN, KERN_PROC, KERN_PROC_ALL)` — the whole process
 *     table (pid / ppid / pgid / tpgid / state / comm) in ~1.1 ms.
 *   - `proc_pidinfo(PROC_PIDVNODEPATHINFO)` — cwd, ~10 µs per pid.
 *   - `proc_pidinfo(PROC_PIDTASKINFO)` — rss + cumulative CPU ns.
 *   - `sysctl(KERN_PROCARGS2)` — full argv (the one costly call, so it is
 *     resolved lazily and therefore only for pids a tree walk visits).
 *   - `proc_pidinfo(PROC_PIDLISTFDS)` + `proc_pidfdinfo(PROC_PIDFDSOCKETINFO)`
 *     — TCP listeners, ~1.5 ms for every accessible pid on the system.
 *
 * Total realistic per-tick cost: ~5 ms instead of ~200 ms.
 *
 * ## Why this is safe to hardcode
 *
 * Reading kernel structs by byte offset is the one genuinely fragile
 * thing here, so this module is built to *detect its own breakage*
 * rather than to be trusted. `openNativeProc()` runs a self-validation
 * probe (see `validate()`) and returns `null` on any mismatch — the
 * caller then keeps the existing `ps`/`lsof` subprocess runners, and
 * behaviour is byte-identical to before. Offsets are additionally
 * asserted against live `ps`/`lsof` output in
 * `tests/native-proc.test.ts`.
 *
 * Nothing here throws into the poller: every public entry point catches
 * and degrades to an empty result, per the CLAUDE.md rule that the
 * metadata pipeline must never be able to take down the main process.
 *
 * macOS / arm64 + x86_64 only. `openNativeProc()` returns `null`
 * everywhere else.
 */

import { dlopen, FFIType } from "bun:ffi";
import type { ListeningPort } from "../shared/types";
import type { PsRow } from "./surface-metadata";

// ── libSystem symbols ───────────────────────────────────────────────────

interface LibSymbols {
  sysctl: (
    name: unknown,
    namelen: number,
    oldp: unknown,
    oldlenp: unknown,
    newp: unknown,
    newlen: bigint,
  ) => number;
  proc_pidinfo: (
    pid: number,
    flavor: number,
    arg: bigint,
    buffer: unknown,
    buffersize: number,
  ) => number;
  proc_pidfdinfo: (
    pid: number,
    fd: number,
    flavor: number,
    buffer: unknown,
    buffersize: number,
  ) => number;
  mach_timebase_info: (info: unknown) => number;
}

// ── sysctl / libproc constants ──────────────────────────────────────────

const CTL_KERN = 1;
const KERN_PROC = 14;
const KERN_PROC_ALL = 0;
const KERN_PROCARGS2 = 49;

const PROC_PIDLISTFDS = 1;
const PROC_PIDTASKINFO = 4;
const PROC_PIDVNODEPATHINFO = 9;
const PROC_PIDFDSOCKETINFO = 3;
const PROX_FDTYPE_SOCKET = 2;

/** `struct proc_fdinfo` — { int32 proc_fd; uint32 proc_fdtype; }. */
const FDINFO_STRIDE = 8;

// ── struct offsets ──────────────────────────────────────────────────────
// Every constant below was derived by probing live memory against
// `ps` / `lsof` ground truth (not from headers) and is re-checked by
// tests/native-proc.test.ts. See doc/desktop-perf-plan.md §2.1.

/** `sizeof(struct kinfo_proc)` on 64-bit Darwin. Verified exactly:
 *  a 642816-byte KERN_PROC_ALL result held precisely 992 entries. */
const KINFO_PROC_SIZE = 648;

/** `kp_proc.p_stat` — 1 SIDL · 2 SRUN · 3 SSLEEP · 4 SSTOP · 5 SZOMB.
 *  Modern Darwin reports SRUN for every live process (the field is
 *  vestigial for scheduling purposes), but SZOMB is still set faithfully
 *  — which is the only value the tree walk actually cares about. */
const OFF_P_STAT = 36;
const OFF_P_PID = 40;
/** `kp_proc.p_comm` — `MAXCOMLEN + 1` = 17 bytes, NUL-padded. */
const OFF_P_COMM = 243;
const LEN_P_COMM = 17;
const OFF_E_PPID = 560;
const OFF_E_PGID = 564;
const OFF_E_TPGID = 576;

const SZOMB = 5;

/** `struct proc_vnodepathinfo` — `pvi_cdir.vip_path`, MAXPATHLEN bytes
 *  after the 152-byte `vnode_info` header. */
const OFF_VIP_PATH = 152;
const MAXPATHLEN = 1024;
const PROC_VNODEPATHINFO_SIZE = 2352;

/** `struct proc_taskinfo`. `pti_total_user` / `pti_total_system` are
 *  counted in *mach absolute time units*, not nanoseconds — on Apple
 *  Silicon one unit is 125/3 ≈ 41.7 ns. Converting requires
 *  `mach_timebase_info`; see `machTicksToNs`. */
const OFF_PTI_RESIDENT_SIZE = 8;
const OFF_PTI_TOTAL_USER = 16;
const OFF_PTI_TOTAL_SYSTEM = 24;
const PROC_TASKINFO_SIZE = 96;

/** `struct socket_fdinfo` = { proc_fileinfo pfi; socket_info psi; }. */
const OFF_SOI_FAMILY = 184;
const OFF_SOI_KIND = 256;
/** `soi_proto.pri_tcp.tcpsi_ini` — the `in_sockinfo`. Ports are stored
 *  network-order in the low half of an `int`, so they read back as a
 *  big-endian `uint16` at these offsets. */
const OFF_INSI_FPORT = 264;
const OFF_INSI_LPORT = 268;
const OFF_INSI_VFLAG = 288;
const OFF_INSI_LADDR = 312;
/** IPv4 occupies the last 4 bytes of the 16-byte address union
 *  (`in4in6_addr` = `uint32 i46a_pad32[3]` then `struct in_addr`). */
const OFF_INSI_LADDR_V4 = OFF_INSI_LADDR + 12;
/** `tcp_sockinfo.tcpsi_state`, immediately after the `in_sockinfo`. */
const OFF_TCPSI_STATE = 344;

const AF_INET = 2;
const AF_INET6 = 30;
const SOCKINFO_TCP = 2;
const TCPS_LISTEN = 1;
const INI_IPV4 = 0x1;
const SOCKET_FDINFO_SIZE = 2048;

// ── shared scratch buffers ──────────────────────────────────────────────
// Reused across ticks so a 1 Hz poll doesn't churn ~700 KB of garbage
// per call. Every read is bounds-checked against the syscall's return
// value, so stale bytes from a previous, larger call are never read.

const taskInfoBuf = new Uint8Array(PROC_TASKINFO_SIZE);
const taskInfoView = new DataView(taskInfoBuf.buffer);
const vnodeBuf = new Uint8Array(PROC_VNODEPATHINFO_SIZE);
const fdListBuf = new Uint8Array(64 * 1024);
const fdListView = new DataView(fdListBuf.buffer);
const sockBuf = new Uint8Array(SOCKET_FDINFO_SIZE);
const sockView = new DataView(sockBuf.buffer);
const argsBuf = new Uint8Array(256 * 1024);
const argsView = new DataView(argsBuf.buffer);
const sysctlLen = new BigUint64Array(1);

/** Grown on demand by `readProcTable`, then reused. */
let procTableBuf = new Uint8Array(1024 * 1024);

const decoder = new TextDecoder("utf-8", { fatal: false });

/** Decode a NUL-terminated string out of `buf` starting at `start`,
 *  stopping at `limit` even if no NUL is present. */
function cstring(buf: Uint8Array, start: number, limit: number): string {
  let end = start;
  while (end < limit && buf[end] !== 0) end++;
  return decoder.decode(buf.subarray(start, end));
}

// ── public surface ──────────────────────────────────────────────────────

export interface NativeProcApi {
  /** Whole-system process table. `command`, `cpu`, and `rssKb` on each
   *  row are resolved lazily on first access — walking a shell's
   *  descendants touches a few dozen rows, not all ~1000. */
  listProcesses(): Map<number, PsRow>;
  /** Current working directory, or `null` when the pid is gone or owned
   *  by another user. */
  cwdOf(pid: number): string | null;
  /** Listening TCP sockets owned by any of `pids`, keyed by pid. Shaped
   *  identically to the `lsof` parser's output. */
  listenersOf(pids: number[]): Map<number, ListeningPort[]>;
  /** Drop retained CPU samples for pids that are no longer live. Called
   *  by the poller each tick so a long-running app doesn't accumulate an
   *  entry per process it has ever seen. */
  pruneCpuSamples(livePids: Set<number>): void;
}

/**
 * Per-pid CPU accounting.
 *
 * `ps %cpu` on Darwin is a *decaying average*, which is why a process
 * that just finished a burst keeps showing high CPU in the pane chips
 * for a while. `PROC_PIDTASKINFO` instead reports cumulative user +
 * system nanoseconds, so the delta between two ticks divided by elapsed
 * wall time is the true instantaneous share — strictly better data than
 * what it replaces.
 */
interface CpuSample {
  cpuNs: number;
  atMs: number;
}

class NativeProc implements NativeProcApi {
  private readonly cpuSamples = new Map<number, CpuSample>();
  /** Nanoseconds per mach absolute time unit — 1 on Intel, 125/3 on
   *  Apple Silicon. Resolved once in the constructor. */
  private readonly nsPerTick: number;

  constructor(private readonly sym: LibSymbols) {
    this.nsPerTick = readTimebase(sym);
  }

  // ── process table ─────────────────────────────────────────────────

  /** Run KERN_PROC_ALL into `procTableBuf`, growing it if the table has
   *  outgrown the buffer since last tick. Returns the entry count. */
  private readProcTable(): number {
    const mib = new Int32Array([CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0]);

    // Size probe first. The table can grow between the probe and the
    // fetch, so over-allocate; a short read is handled by the loop below
    // regardless.
    sysctlLen[0] = 0n;
    if (this.sym.sysctl(mib, 4, null, sysctlLen, null, 0n) !== 0) return 0;
    const needed = Number(sysctlLen[0]) + 64 * KINFO_PROC_SIZE;
    if (procTableBuf.byteLength < needed) {
      procTableBuf = new Uint8Array(needed);
    }

    sysctlLen[0] = BigInt(procTableBuf.byteLength);
    if (this.sym.sysctl(mib, 4, procTableBuf, sysctlLen, null, 0n) !== 0) {
      return 0;
    }
    return Math.floor(Number(sysctlLen[0]) / KINFO_PROC_SIZE);
  }

  listProcesses(): Map<number, PsRow> {
    const rows = new Map<number, PsRow>();
    try {
      const count = this.readProcTable();
      if (count === 0) return rows;
      const view = new DataView(
        procTableBuf.buffer,
        procTableBuf.byteOffset,
        procTableBuf.byteLength,
      );
      const now = Date.now();

      for (let i = 0; i < count; i++) {
        const base = i * KINFO_PROC_SIZE;
        const pid = view.getInt32(base + OFF_P_PID, true);
        if (pid <= 0) continue;

        const pgid = view.getInt32(base + OFF_E_PGID, true);
        const tpgid = view.getInt32(base + OFF_E_TPGID, true);
        const state = procTableBuf[base + OFF_P_STAT] ?? 0;

        // `ps`'s STAT column, reduced to the two flags anything
        // downstream actually reads: "Z" (walkTree's zombie filter) and
        // "+" (findForegroundPid's foreground-process-group test, which
        // is exactly `pgid == tpgid` — that is how ps itself derives it).
        let stat = state === SZOMB ? "Z" : "S";
        if (tpgid > 0 && pgid === tpgid) stat += "+";

        rows.set(
          pid,
          new NativePsRow(
            this,
            pid,
            view.getInt32(base + OFF_E_PPID, true),
            pgid,
            stat,
            cstring(
              procTableBuf,
              base + OFF_P_COMM,
              base + OFF_P_COMM + LEN_P_COMM,
            ),
            now,
          ),
        );
      }
    } catch {
      // Any FFI surprise degrades to "no metadata this tick" rather than
      // taking down the poller — same contract as the subprocess path.
      return new Map();
    }
    return rows;
  }

  // ── lazily-resolved per-row fields ────────────────────────────────

  /** Full argv via KERN_PROCARGS2, or `null` when the process is gone or
   *  belongs to another user (the common case for pids outside our own
   *  process trees). */
  argvOf(pid: number): string | null {
    try {
      const mib = new Int32Array([CTL_KERN, KERN_PROCARGS2, pid]);
      sysctlLen[0] = BigInt(argsBuf.byteLength);
      if (this.sym.sysctl(mib, 3, argsBuf, sysctlLen, null, 0n) !== 0) {
        return null;
      }
      const size = Number(sysctlLen[0]);
      if (size < 8) return null;

      // Layout: int32 argc · exec path (NUL-terminated) · NUL padding ·
      // argc NUL-terminated argv strings · environ.
      const argc = argsView.getInt32(0, true);
      if (argc <= 0) return null;

      let offset = 4;
      while (offset < size && argsBuf[offset] !== 0) offset++; // exec path
      while (offset < size && argsBuf[offset] === 0) offset++; // padding

      const parts: string[] = [];
      for (let i = 0; i < argc && offset < size; i++) {
        const start = offset;
        while (offset < size && argsBuf[offset] !== 0) offset++;
        parts.push(decoder.decode(argsBuf.subarray(start, offset)));
        offset++; // skip the NUL
      }
      const joined = parts.join(" ").trim();
      return joined.length > 0 ? joined : null;
    } catch {
      return null;
    }
  }

  /** rss (KB) plus the instantaneous CPU share derived from the change in
   *  cumulative CPU nanoseconds since this pid's previous sample. */
  taskInfoOf(pid: number, nowMs: number): { rssKb: number; cpu: number } {
    try {
      const n = this.sym.proc_pidinfo(
        pid,
        PROC_PIDTASKINFO,
        0n,
        taskInfoBuf,
        PROC_TASKINFO_SIZE,
      );
      // Fails with 0 for zombies and for processes owned by another user.
      if (n < PROC_TASKINFO_SIZE) return { rssKb: 0, cpu: 0 };

      const rssKb = Math.round(
        Number(taskInfoView.getBigUint64(OFF_PTI_RESIDENT_SIZE, true)) / 1024,
      );
      const cpuNs =
        (Number(taskInfoView.getBigUint64(OFF_PTI_TOTAL_USER, true)) +
          Number(taskInfoView.getBigUint64(OFF_PTI_TOTAL_SYSTEM, true))) *
        this.nsPerTick;

      const prev = this.cpuSamples.get(pid);
      this.cpuSamples.set(pid, { cpuNs, atMs: nowMs });

      // First sighting has no baseline to difference against; report 0
      // and let the next tick produce a real figure one second later.
      // A pid can also be recycled, which shows up as a negative delta.
      let cpu = 0;
      if (prev && nowMs > prev.atMs && cpuNs >= prev.cpuNs) {
        const elapsedNs = (nowMs - prev.atMs) * 1e6;
        cpu = ((cpuNs - prev.cpuNs) / elapsedNs) * 100;
        // Multi-threaded processes legitimately exceed 100 %, exactly as
        // `ps` reports them. Round to ps's one-decimal precision so the
        // poller's change detection doesn't trip on float noise.
        cpu = Math.round(cpu * 10) / 10;
      }
      return { rssKb, cpu };
    } catch {
      return { rssKb: 0, cpu: 0 };
    }
  }

  pruneCpuSamples(livePids: Set<number>): void {
    if (this.cpuSamples.size <= livePids.size) return;
    for (const pid of this.cpuSamples.keys()) {
      if (!livePids.has(pid)) this.cpuSamples.delete(pid);
    }
  }

  // ── cwd ───────────────────────────────────────────────────────────

  cwdOf(pid: number): string | null {
    try {
      const n = this.sym.proc_pidinfo(
        pid,
        PROC_PIDVNODEPATHINFO,
        0n,
        vnodeBuf,
        PROC_VNODEPATHINFO_SIZE,
      );
      if (n <= OFF_VIP_PATH) return null;
      const path = cstring(vnodeBuf, OFF_VIP_PATH, OFF_VIP_PATH + MAXPATHLEN);
      return path.length > 0 ? path : null;
    } catch {
      return null;
    }
  }

  // ── listening TCP sockets ─────────────────────────────────────────

  listenersOf(pids: number[]): Map<number, ListeningPort[]> {
    const result = new Map<number, ListeningPort[]>();
    for (const pid of pids) {
      try {
        const ports = this.listenersForPid(pid);
        if (ports.length > 0) result.set(pid, ports);
      } catch {
        // Skip this pid; a single unreadable process must not lose the
        // rest of the tick's port data.
      }
    }
    return result;
  }

  private listenersForPid(pid: number): ListeningPort[] {
    const n = this.sym.proc_pidinfo(
      pid,
      PROC_PIDLISTFDS,
      0n,
      fdListBuf,
      fdListBuf.byteLength,
    );
    if (n <= 0) return [];
    const limit = Math.min(n, fdListBuf.byteLength);

    const ports: ListeningPort[] = [];
    for (
      let offset = 0;
      offset + FDINFO_STRIDE <= limit;
      offset += FDINFO_STRIDE
    ) {
      if (fdListView.getUint32(offset + 4, true) !== PROX_FDTYPE_SOCKET) {
        continue;
      }
      const fd = fdListView.getInt32(offset, true);
      const size = this.sym.proc_pidfdinfo(
        pid,
        fd,
        PROC_PIDFDSOCKETINFO,
        sockBuf,
        SOCKET_FDINFO_SIZE,
      );
      if (size <= OFF_TCPSI_STATE + 4) continue;
      if (sockView.getInt32(OFF_SOI_KIND, true) !== SOCKINFO_TCP) continue;
      if (sockView.getInt32(OFF_TCPSI_STATE, true) !== TCPS_LISTEN) continue;
      // A listener has no peer. Belt-and-braces against a socket that
      // transitioned between the two reads.
      if (sockView.getUint16(OFF_INSI_FPORT, false) !== 0) continue;

      const port = sockView.getUint16(OFF_INSI_LPORT, false);
      if (port <= 0 || port > 65535) continue;

      const address = this.decodeLocalAddress();
      if (address === null) continue;

      // Match the `lsof` parser's convention exactly, so switching
      // implementations can't shift what the chips render or how the
      // sidebar dedupes: wildcards render as "*", and the protocol is
      // derived from whether the rendered address is v6-shaped.
      const proto: "tcp" | "tcp6" = address.includes(":") ? "tcp6" : "tcp";

      const already = ports.some(
        (p) => p.port === port && p.address === address && p.proto === proto,
      );
      if (!already) ports.push({ pid, port, proto, address });
    }
    return ports;
  }

  /** Render `insi_laddr` the way `lsof -nP` would. */
  private decodeLocalAddress(): string | null {
    const family = sockView.getInt32(OFF_SOI_FAMILY, true);
    const vflag = sockBuf[OFF_INSI_VFLAG] ?? 0;

    if (family === AF_INET || (vflag & INI_IPV4) !== 0) {
      const a = sockBuf[OFF_INSI_LADDR_V4] ?? 0;
      const b = sockBuf[OFF_INSI_LADDR_V4 + 1] ?? 0;
      const c = sockBuf[OFF_INSI_LADDR_V4 + 2] ?? 0;
      const d = sockBuf[OFF_INSI_LADDR_V4 + 3] ?? 0;
      // 0.0.0.0 is a wildcard bind. A dual-stack `::` listener reports
      // INI_IPV4 with an all-zero v4 address, and lsof renders that as
      // "*" too, so both land in the same branch.
      if (a === 0 && b === 0 && c === 0 && d === 0) {
        if (family === AF_INET6) return this.decodeV6() ?? "*";
        return "*";
      }
      return `${a}.${b}.${c}.${d}`;
    }

    if (family === AF_INET6) return this.decodeV6();
    return null;
  }

  /** Compress a 16-byte IPv6 address to its canonical text form.
   *  Returns "*" for the unspecified address, matching lsof. */
  private decodeV6(): string | null {
    const groups: number[] = [];
    let allZero = true;
    for (let i = 0; i < 8; i++) {
      const g = sockView.getUint16(OFF_INSI_LADDR + i * 2, false);
      if (g !== 0) allZero = false;
      groups.push(g);
    }
    if (allZero) return "*";

    // Longest run of zero groups gets collapsed to "::" (RFC 5952).
    let bestStart = -1;
    let bestLen = 0;
    let runStart = -1;
    for (let i = 0; i <= 8; i++) {
      if (i < 8 && groups[i] === 0) {
        if (runStart < 0) runStart = i;
      } else if (runStart >= 0) {
        const len = i - runStart;
        if (len > bestLen) {
          bestLen = len;
          bestStart = runStart;
        }
        runStart = -1;
      }
    }

    const hex = groups.map((g) => g.toString(16));
    if (bestLen < 2) return hex.join(":");
    return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLen).join(":")}`;
  }
}

/**
 * Nanoseconds per mach absolute time unit.
 *
 * `mach_timebase_info` fills `{ uint32 numer; uint32 denom; }`; the ratio
 * is 1/1 on Intel and 125/3 on Apple Silicon. Getting this wrong makes
 * every CPU% read ~42× too low, so a bad or zero result falls back to
 * 1:1 rather than producing silently-scaled numbers.
 */
function readTimebase(sym: LibSymbols): number {
  try {
    const info = new Uint32Array(2);
    if (sym.mach_timebase_info(info) !== 0) return 1;
    const numer = info[0] ?? 0;
    const denom = info[1] ?? 0;
    if (numer <= 0 || denom <= 0) return 1;
    return numer / denom;
  } catch {
    return 1;
  }
}

/**
 * A `PsRow` whose expensive fields materialise on first read.
 *
 * `listProcesses()` returns ~1000 of these but a tree walk only ever
 * touches `command` / `cpu` / `rssKb` on the few dozen rows inside a
 * tracked shell's descendants. Resolving argv eagerly for the whole
 * table would cost ~12 ms per tick; this way it costs well under 1 ms.
 */
class NativePsRow implements PsRow {
  private argvResolved = false;
  private argv: string | null = null;
  private taskResolved = false;
  private task: { rssKb: number; cpu: number } = { rssKb: 0, cpu: 0 };

  constructor(
    private readonly owner: NativeProc,
    readonly pid: number,
    readonly ppid: number,
    readonly pgid: number,
    readonly stat: string,
    /** `p_comm`, truncated to 16 chars by the kernel. The fallback when
     *  argv is unreadable (another user's process). */
    private readonly comm: string,
    private readonly sampledAtMs: number,
  ) {}

  get command(): string {
    if (!this.argvResolved) {
      this.argv = this.owner.argvOf(this.pid);
      this.argvResolved = true;
    }
    return this.argv ?? this.comm;
  }

  get cpu(): number {
    this.resolveTask();
    return this.task.cpu;
  }

  get rssKb(): number {
    this.resolveTask();
    return this.task.rssKb;
  }

  private resolveTask(): void {
    if (this.taskResolved) return;
    this.task = this.owner.taskInfoOf(this.pid, this.sampledAtMs);
    this.taskResolved = true;
  }
}

// ── construction + self-validation ──────────────────────────────────────

let cached: NativeProcApi | null | undefined;

/**
 * Open the native introspection API, or return `null` when it can't be
 * trusted on this machine. Memoised — the probe runs once per process.
 *
 * Callers must treat `null` as "use the subprocess runners"; it is a
 * completely normal outcome (non-Darwin, a hardened runtime that blocks
 * `dlopen`, or a future macOS that reshuffles these structs).
 */
export function openNativeProc(): NativeProcApi | null {
  if (cached !== undefined) return cached;
  cached = create();
  return cached;
}

/** Test seam — forget the memoised probe result. */
export function resetNativeProcForTest(): void {
  cached = undefined;
}

function create(): NativeProcApi | null {
  if (process.platform !== "darwin") return null;
  try {
    const { symbols } = dlopen("libSystem.B.dylib", {
      sysctl: {
        args: [
          FFIType.ptr,
          FFIType.u32,
          FFIType.ptr,
          FFIType.ptr,
          FFIType.ptr,
          FFIType.u64,
        ],
        returns: FFIType.i32,
      },
      proc_pidinfo: {
        args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32],
        returns: FFIType.i32,
      },
      proc_pidfdinfo: {
        args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.i32],
        returns: FFIType.i32,
      },
      mach_timebase_info: {
        args: [FFIType.ptr],
        returns: FFIType.i32,
      },
    });

    const api = new NativeProc(symbols as unknown as LibSymbols);
    if (!validate(api)) {
      console.warn(
        "[native-proc] self-validation failed — falling back to ps/lsof " +
          "for this session (kernel struct layout may have changed)",
      );
      return null;
    }
    return api;
  } catch (err) {
    // dlopen refused, bun:ffi unavailable, or the symbols moved. Not an
    // error condition — the caller has a working subprocess path.
    console.warn(
      "[native-proc] unavailable, using ps/lsof:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Prove the offsets still describe reality before anyone relies on them.
 *
 * Each check reads something this process already knows the answer to,
 * so a struct-layout change on a future macOS shows up as a clean
 * fallback rather than as silently wrong chips:
 *
 *   1. our own pid must appear in the table with the correct ppid, and
 *      the table must be plausibly populated;
 *   2. `proc_pidinfo` must return our cwd verbatim;
 *   3. a throwaway listener on an ephemeral port must survive the full
 *      fd-scan + socket-decode path.
 */
function validate(api: NativeProc): boolean {
  try {
    const rows = api.listProcesses();
    if (rows.size < 2) return false;

    const self = rows.get(process.pid);
    if (!self) return false;
    if (self.pid !== process.pid) return false;
    if (self.ppid !== process.ppid) return false;

    // rss is always non-zero for a live process; a zero here means
    // PROC_PIDTASKINFO's layout moved.
    if (self.rssKb <= 0) return false;

    if (api.cwdOf(process.pid) !== process.cwd()) return false;

    return validateSockets(api);
  } catch {
    return false;
  }
}

function validateSockets(api: NativeProc): boolean {
  // `Bun.listen` on port 0 lets the kernel pick; we then require the
  // decode path to hand that exact port back.
  let server: { port: number; stop: (closeActive?: boolean) => void } | null =
    null;
  try {
    server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    }) as unknown as { port: number; stop: (closeActive?: boolean) => void };

    const port = server.port;
    if (!port) return false;

    const found = api.listenersOf([process.pid]).get(process.pid) ?? [];
    return found.some((p) => p.port === port && p.address === "127.0.0.1");
  } catch {
    return false;
  } finally {
    try {
      server?.stop(true);
    } catch {
      /* nothing useful to do if teardown fails */
    }
  }
}
