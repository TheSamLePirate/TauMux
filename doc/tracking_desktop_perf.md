# Tracking — desktop performance & reactivity plan

Plan: [doc/desktop-perf-plan.md](./desktop-perf-plan.md)
Started: 2026-08-02 · Version at start: **0.4.7**

## Status

| ID | Item | State | Commit |
|----|------|-------|--------|
| P1 | FFI process introspection (`native-proc.ts` + runners) | **done** | `7bcb2fd3` (v0.4.8) |
| P2 | WebGL terminal renderer + setting + fallback | **shipped, then made opt-in** | `a3a8fc6a` (v0.4.9), `4aeebb81` (v0.4.11) |
| P3 | Adaptive stdout coalescing | **done** | `b135c721` (v0.4.10) |
| P4 | Bump / docs / changelog backlog | in progress | — |

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

### 2026-08-02 — P2 regression and revert (`4aeebb81`, v0.4.11)

**v0.4.9 shipped the WebGL renderer on by default and it rendered
terminal panes blank in the real app.** Reported by the user during the
session; reproduced on-screen (new build's pane empty, v0.4.7 alongside
it rendering normally).

Default reverted to `dom`, which restores the exact pre-v0.4.9 code path.
WebGL stays available as opt-in.

**Why the tests passed anyway — the important lesson.**
`tests-e2e-native/specs/renderer.spec.ts` asserted that the addon
attached and that `getActiveRendererKind()` reported `"webgl"`. Both were
true. Neither is the same claim as *pixels reach the screen*. An
attachment assertion is not a rendering assertion, and treating one as a
proxy for the other is what let a blank terminal ship. Verifying a
renderer needs a pixel-level check — the design-report screenshot suite
is the right tool.

**Real defect found while investigating** (kept, correct regardless of
the default): the renderer was attached immediately after `term.open()`,
while the pane container is still 0×0 because the layout pass has not
run. The DOM renderer re-measures on the next frame; the WebGL renderer
sizes its canvas and glyph atlas at attach time and never recovers from a
zero-sized drawing buffer. Attachment is now deferred to `applyLayout()`
after `fitSurfaceTerminal()`, guarded on a non-zero `.xterm-screen` rect,
with a `refresh()` so a quiet pane paints its existing buffer.

Whether that was the *whole* cause is **unverified on-screen** — which is
precisely why the default was not restored to `webgl` on the strength of
it.

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

- **OPEN — GPU renderer unverified.** `terminalRenderer: "webgl"` is
  opt-in and its blank-pane cause is not confirmed. Before it can default
  on again it needs a pixel-level check (design-report screenshot), not
  an attachment assertion.
- **Pre-existing, unrelated —** `tests-e2e-native/specs/demos.spec.ts`
  imports `tests-e2e/design/helpers/demos`, which does not exist, so the
  native suite fails to collect. Confirmed present before this plan's
  work (verified by stashing). Run individual spec files to bypass.
