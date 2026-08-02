# Desktop performance & reactivity plan (2026-08)

**Scope.** The desktop app only — the Bun main process (`src/bun/`) and the
Electrobun webview (`src/views/terminal/`). The web mirror (`src/bun/web/`,
`src/web-client/`) is explicitly out of scope, except where a shared module
(`src/shared/`) has to stay compatible.

**Goal.** Cut sustained resource use, raise responsiveness, without changing
observable terminal behaviour.

---

## 1. Measured baseline

Taken against the running packaged app (v0.4.7, PID 76622) on 2026-08-02,
with an active Claude Code session in one pane.

| Process | CPU | RSS |
|---|---|---|
| `bun` main | 7–10 % | 184 MB |
| `com.apple.WebKit.GPU` | 12.8 % | 74 MB |
| `com.apple.WebKit.WebContent` | 7.4 % | 321 MB |
| `com.apple.WebKit.Networking` | 0.3 % | 13 MB |
| **total** | **~28 %** | **~592 MB** |

`ps` reports **246 minutes of CPU time** consumed by the bun process since
Wednesday — an average of ~5.7 % of a core sustained across three days,
most of it while the app was doing nothing the user asked for.

`/usr/bin/sample` on the bun process confirms the burn is not on the
AppKit main thread (3253/3269 samples parked in `mach_msg2_trap`) but on
the JS `Worker` thread — 220/3269 busy samples, matching the ~7 % figure.

### 1.1 Where the bun CPU goes

Benchmarked on this machine (median of 10 runs, `LC_ALL=C`):

| Poller subprocess, per 1 Hz tick | median |
|---|---|
| `ps -axo pid,ppid,pgid,stat,%cpu,rss,args -ww` (992 procs) | **68.6 ms** |
| `lsof -nP -iTCP -sTCP:LISTEN -a -p <pids> -FpPn` | **61.3 ms** |
| `lsof -a -d cwd -Fpn -p <pids>` | **70.6 ms** |
| `git status --porcelain` (TTL-cached, ~1 in 3 ticks) | 53.6 ms |
| bare `posix_spawn` floor (`/usr/bin/true`) | 1.8 ms |

`ps` runs first, then the two `lsof` calls run in parallel, so the poller
costs roughly **68 + 70 ≈ 140 ms of wall time and ~200 ms of CPU every
second** — 13–20 % of a core, forever.

### 1.2 Why the existing idle backoff does not help

`SurfaceMetadataPoller.tick()` (src/bun/surface-metadata.ts:754) resets
`idleStreak` to 0 whenever any surface emitted:

```ts
this.idleStreak = emitted || liveChanged ? 0 : this.idleStreak + 1;
```

and `emitted` is driven by `cpuOrRssMoved(prev, metadata)`. Any process in
any pane with moving CPU — a dev server, a watcher, a coding agent, the
shell itself — keeps `cpuOrRssMoved` true on essentially every tick. The
§5.3 backoff (1 s → 5 s) therefore never engages in real use. It only
protects the pathological case of a completely frozen machine.

### 1.3 Other findings

- **No visibility or occlusion gating exists anywhere.** `grep` for
  `visibilitychange` / `document.hidden` / occlusion across `src/bun/` and
  `src/views/terminal/` returns nothing. Polling, the 1 Hz status-bar
  rebuild (src/views/terminal/index.ts:927), and sidebar renders all run at
  full rate with the window hidden, minimised, or fully occluded.
- **xterm.js runs on the DOM renderer.** `package.json` carries
  `addon-fit`, `addon-search`, `addon-serialize`, `addon-web-links` — no
  `@xterm/addon-webgl`. Every glyph is a DOM node; this is the dominant
  WebContent + GPU cost and the reason heavy output feels sluggish.
- **The webview bundle is 2.20 MB across 114 modules**, of which
  **~1.44 MB is CodeMirror + Lezer** (`@codemirror` 1054 KB, `@lezer`
  384 KB), pulled in eagerly through
  `surface-manager → editor-surface-controller → editor-pane`. Every launch
  parses and evaluates it whether or not an editor pane is ever opened.
- **Every PTY byte is written twice in the bun process** — once into a raw
  64 KB ring (`outputHistory`) and once into a full headless xterm with
  2000 lines of scrollback, one per surface
  (src/bun/session-manager.ts:116).
- **Stdout coalescing is a fixed 8 ms window**
  (`NATIVE_STDOUT_COALESCE_MS`). Correct under load, but it also delays the
  echo of a single keystroke by up to 8 ms when the terminal is idle —
  precisely when latency is most perceptible.

---

## 2. The FFI replacement (validated prototype)

Every `ps` and `lsof` fact the poller needs is available from libSystem
without forking. Prototyped and verified against live `ps`/`lsof` output on
this machine:

| Data | Mechanism | Cost |
|---|---|---|
| Full process table (992 procs) | `sysctl(CTL_KERN, KERN_PROC, KERN_PROC_ALL)` | **1.1 ms** |
| cwd, all 248 accessible pids | `proc_pidinfo(PROC_PIDVNODEPATHINFO)` | **2.3 ms** |
| rss + cumulative CPU ns, all pids | `proc_pidinfo(PROC_PIDTASKINFO)` | **1.8 ms** |
| Full argv, all pids | `sysctl(KERN_PROCARGS2)` | 11.6 ms |
| TCP listeners, all pids | `proc_pidinfo(PROC_PIDLISTFDS)` + `proc_pidfdinfo(PROC_PIDFDSOCKETINFO)` | **1.5 ms** |

Argv is the only expensive call, and it is only needed for pids inside a
tracked shell's descendant tree (typically fewer than 30) — not the whole
system. Resolving it lazily keeps the real per-tick cost at **~5 ms**, a
**~40× reduction**.

### 2.1 Struct offsets, verified empirically

All offsets were derived by probing live memory against `ps`/`lsof` ground
truth rather than from headers, and re-verified as a unit test.

`struct kinfo_proc` — stride **648** bytes on arm64 (642816 bytes / 992
procs, exact):

| Field | Offset | Verified |
|---|---|---|
| `kp_proc.p_stat` | 36 | zombie filter |
| `kp_proc.p_pid` | 40 | 100 % vs `ps -o pid` |
| `kp_proc.p_comm` | 243 | 97 % vs `ps -o comm` |
| `kp_eproc.e_ppid` | 560 | 100 % vs `ps -o ppid` |
| `kp_eproc.e_pgid` | 564 | 100 % vs `ps -o pgid` |
| `kp_eproc.e_tpgid` | 576 | 100 % vs `ps -o tpgid` |

`ps`'s `+` foreground flag is exactly `e_pgid == e_tpgid`, which is the
only thing `findForegroundPid` reads out of the `stat` column.

`struct proc_vnodepathinfo`: `pvi_cdir.vip_path` at offset **152**.
Round-trips `process.cwd()` exactly.

`struct proc_taskinfo`: `pti_resident_size` at **8**, `pti_total_user` at
**16**, `pti_total_system` at **24**.

`struct socket_fdinfo`: `soi_family` at **184** (2 = AF_INET, 30 =
AF_INET6), `soi_protocol` at **188** (6 = TCP), `soi_kind` at **256**
(2 = SOCKINFO_TCP); `in_sockinfo` follows with `insi_fport` at **264**,
`insi_lport` at **268** (both big-endian `uint16` in the low half),
`insi_vflag` at **288**, `insi_faddr` at **296**, `insi_laddr` at **312**
(IPv4 occupies the last 4 bytes of the 16-byte union, i.e. **324**).
Confirmed against three purpose-bound listeners (`127.0.0.1:44551`,
`[::]:44552`, `0.0.0.0:44553`) plus a live connected pair, where fport /
lport / laddr all decoded correctly on both ends.

### 2.2 Safety design

Hardcoded native struct offsets are the one genuinely fragile thing here,
so the module is built to detect its own breakage rather than to be
trusted:

1. **Startup self-validation.** On first use, `native-proc.ts` probes
   itself: it must find its own pid in the sysctl table with the correct
   `ppid`; `proc_pidinfo` must return `process.cwd()` verbatim; and a
   throwaway listener bound to an ephemeral port must be recovered through
   the full socket-decode path. Any mismatch → the whole FFI layer reports
   unavailable.
2. **Permanent fallback for the boot.** When validation fails (or
   `bun:ffi` / `dlopen` throws at all), the poller keeps the existing
   `ps`/`lsof` runners. Behaviour is byte-identical to today; the only
   symptom is a single log line.
3. **Unchanged seam.** The FFI runners implement the existing
   `MetadataRunners` interface, so `tick()`'s orchestration, every
   fixture-injecting test, and the `PsRow` / `ProcessNode` contracts are
   untouched.
4. **Never throws into the poller.** Same rule as the subprocess runners:
   every entry point returns an empty map on failure.

### 2.3 A correctness bonus

`ps %cpu` on macOS is a decaying load average, not an instantaneous
reading — it is why a process that just finished a burst still shows high
CPU in the pane chips. `PROC_PIDTASKINFO` gives *cumulative* user+system
nanoseconds, so a delta between consecutive ticks divided by elapsed wall
time yields **true instantaneous CPU%**. Chips, the Process Manager
overlay, and sidebar aggregates all become more accurate as a side effect.

---

## 3. Work items

### P1 — FFI process introspection (bun)

`src/bun/native-proc.ts`, new. Pure, dependency-free, self-validating.

- `openNativeProc(): NativeProcApi | null` — `dlopen` + validation probe,
  memoised per process.
- `listProcesses(): Map<number, PsRow>` — one `sysctl` for the table;
  `command`, `cpu`, `rssKb` resolved **lazily per row** so argv and
  taskinfo are only paid for pids that a tree walk actually visits.
- `cwdOf(pid)`, `listenersOf(pids)`.
- CPU% from `cpuNs` deltas held in a module-level previous-sample map,
  pruned against the live pid set each tick.

`src/bun/surface-metadata.ts` — add `createNativeRunners()` returning a
`MetadataRunners`, and select it in the default runners when
`openNativeProc()` succeeds. `runPs` / `runListeningPorts` / `runCwds`
subprocess implementations stay exactly as they are and remain the
fallback.

**Tests.** Offset assertions against live `ps`/`lsof` output; cwd
round-trip; listener round-trip against a bound ephemeral port; graceful
`null` when validation is forced to fail; `PsRow` shape parity between the
FFI and subprocess runners.

### P2 — WebGL terminal renderer (webview)

Add `@xterm/addon-webgl`. Load it per terminal after `open()`, behind a new
`terminalRenderer: "webgl" | "dom"` setting defaulting to `webgl`.

- `webglcontextlost` → dispose the addon and fall through to the DOM
  renderer for that terminal; never leave a blank pane.
- Init failure (no WebGL, driver refusal) → same fallback, logged once.
- Bloom is unaffected: `TerminalEffects.rasterise()` reads
  `term.buffer.active` and `.xterm-screen`'s bounding rect, neither of
  which is renderer-specific.
- Setting threaded end-to-end per the CLAUDE.md "adding a settings field"
  pattern, plus a command-palette entry to toggle it.

### P3 — Adaptive stdout coalescing (bun)

`NativeStdoutCoalescer` gains a latency-first mode: when a surface has
been quiet, the first small chunk flushes on a microtask instead of
waiting out the 8 ms window; the window only engages once a surface is
demonstrably streaming (a chunk arrives while a flush is already pending,
or the accumulated volume crosses a threshold). Under `yes`-style load the
behaviour is unchanged; interactive echo loses its up-to-8 ms tax.

**Tests.** Single small chunk flushes without advancing timers; sustained
chunks still coalesce into one sink call per window; soft cap still
short-circuits.

### P4 — Version bump, docs, tracking

`bun run bump:patch` before each commit. Progress, deviations, and commit
ids tracked in `doc/tracking_desktop_perf.md`; user-facing changes queued
in `doc/changes_to_document.md` for the next website-doc sweep.

---

## 4. Deliberately deferred

Raised during analysis, **not** in this plan's scope (available on request):

- **Lazy CodeMirror** — dynamic-import `editor-pane` from
  `EditorSurfaceController` to drop ~1.44 MB from the startup bundle.
- **Lazy headless mirror** — build the per-surface bun-side xterm only when
  `read-screen` or a rejoining client asks for it.
- **Visibility gating** — suspend the 1 Hz status-bar rebuild, sidebar
  renders, and metadata polling while the window is occluded. Note that P1
  makes the polling cost small enough that this matters much less than it
  did at baseline.

---

## 5. Acceptance

- `bun test` and `bun run typecheck` green.
- `bun start` launches; terminal, chips, ports, cwd, and the Process
  Manager all behave as before.
- Measured bun-process CPU at steady state falls from 7–10 % to under 2 %.
- Poller tick cost measured under 10 ms against the ~200 ms baseline.
- Forcing FFI validation to fail restores exact `ps`/`lsof` behaviour.
