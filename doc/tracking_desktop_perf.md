# Tracking — desktop performance & reactivity plan

Plan: [doc/desktop-perf-plan.md](./desktop-perf-plan.md)
Started: 2026-08-02 · Version at start: **0.4.7**

## Status

| ID | Item | State | Commit |
|----|------|-------|--------|
| P1 | FFI process introspection (`native-proc.ts` + runners) | **done** | `7bcb2fd3` (v0.4.8) |
| P2 | WebGL terminal renderer + setting + fallback | in progress | — |
| P3 | Adaptive stdout coalescing | not started | — |
| P4 | Bump / docs / changelog backlog | not started | — |

## Baseline (2026-08-02, packaged v0.4.7, PID 76622)

- bun main 7–10 % CPU / 184 MB · WebKit GPU 12.8 % / 74 MB ·
  WebContent 7.4 % / 321 MB → ~28 % CPU, ~592 MB total.
- Poller subprocesses per tick: `ps` 68.6 ms + `lsof LISTEN` 61.3 ms +
  `lsof -d cwd` 70.6 ms ≈ 200 ms CPU/s.
- Webview bundle 2.20 MB / 114 modules (CodeMirror+Lezer ~1.44 MB).

## Log

### 2026-08-02 — analysis

- Sampled the live app with `/usr/bin/sample`; burn is on the JS worker
  thread, not AppKit's main thread.
- Benchmarked each poller subprocess; confirmed the §5.3 idle backoff never
  engages in practice because `cpuOrRssMoved` keeps `emitted` true.
- Prototyped the full FFI replacement and verified every struct offset
  against live `ps` / `lsof` ground truth. See plan §2.1.
- Confirmed no `@xterm/addon-webgl`; xterm is on the DOM renderer.
- User decisions: full FFI with fallback · WebGL renderer on by default ·
  include adaptive input latency · defer lazy-CodeMirror, lazy headless
  mirror, and visibility gating.

### 2026-08-02 — P1 landed (`7bcb2fd3`, v0.4.8)

Measured end-to-end tick against the live app's seven shells:

| | median |
|---|---|
| subprocess (`ps` + 2× `lsof`) | 135.8 ms |
| native FFI | **2.42 ms** |
| speedup | **56×** |

Parity verified against `ps`/`lsof` on a purpose-built nested tree with a
listener under it: trees, foreground pids, full commands, ports, and cwds
all identical. (`ps` reports one extra pid — itself — which is expected and
not a discrepancy; confirmed by reversing snapshot order.)

## Deviations

- **`pti_total_user` / `pti_total_system` are mach absolute time units, not
  nanoseconds.** The plan assumed ns. Caught by the CPU-sampling test,
  which reported 2.4 % for a spin loop — exactly 100 % ÷ 41.67, the Apple
  Silicon timebase ratio. Fixed by resolving `mach_timebase_info` once in
  the constructor and scaling; falls back to 1:1 if the call fails.
- **`kp_proc.p_stat` is vestigial on modern Darwin** — every live process
  reports SRUN, so it can't distinguish sleeping from running. It *is*
  still faithful for SZOMB, which is the only value the tree walk reads,
  so the zombie filter works. The synthesised STAT string is therefore
  "S"/"Z" plus the "+" foreground flag rather than a full ps-compatible
  column; nothing downstream reads more than those two flags.

## Issues

_(none open)_
