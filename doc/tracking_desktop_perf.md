# Tracking — desktop performance & reactivity plan

Plan: [doc/desktop-perf-plan.md](./desktop-perf-plan.md)
Started: 2026-08-02 · Version at start: **0.4.7**

## Status

| ID | Item | State | Commit |
|----|------|-------|--------|
| P1 | FFI process introspection (`native-proc.ts` + runners) | in progress | — |
| P2 | WebGL terminal renderer + setting + fallback | not started | — |
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

## Deviations

_(none yet)_

## Issues

_(none yet)_
