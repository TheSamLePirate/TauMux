# Tracking — AAA Polish Pass (v0.3.186 → …)

Goal: make τ-mux S-grade — no flickering, memory-efficient, polished.
Source: multi-agent audit (45 agents, 33/37 findings confirmed), 2026-06-09.
Roadmap deduped to **17 work items / 4 waves**. Each item maps to real file:line.

Legend: ⬜ todo · 🔄 in progress · ✅ done · ⏸ deferred/needs-decision

## Decisions (taken with sensible defaults under the "no flicker / efficient / polished" mandate)
- **W1-RESIZE tradeoff** → ACCEPT. During sidebar drag the xterm grid freezes (cols/rows snap on pointer-up), exactly like the existing pane-divider drag. This is what fixes the jank complaint.
- **W2-METADATA-BLUR** → option (b): intermediate ~1800ms on window blur, full 3000ms only on `document.hidden`. Keeps mirror/`ht` snapshot fresh-ish when backgrounded.
- **W3-PTY-GUARD / W3-TELEGRAM-ISOLATE** → ACCEPT defense-in-depth (aligns with CLAUDE.md "never crash the PTY pipeline"). Drop the non-existent-input halves the audit flagged.
- **W4-STATUSBAR-IDLE** → DEFER (clean fix is an event-drive refactor; only safe allocation shave otherwise).

## WAVE 1 — user-pain quick wins (known issues) ✅ COMPLETE
- ✅ **W1-STATROW** — workspace-card stat row reconcile-in-place. Split STRUCTURAL (active/sparkline-presence/accent) vs VALUE sig; `patchCardStatRow` mutates cached nodes (scaleX fill, polyline/polygon points, textContents). Native `sidebar.ts` + web `workspace-card.ts` (`statsSection`/`reconcileStats`). Shared pure helpers `cpuBarScale`/`computeSparkline` (native), `computeCpuSparklinePoints` (web). Tests: sidebar-card-stability +2, web-client-sidebar +1. [flicker on refresh]
- ✅ **W1-STATGATE** — refresh cards on live cpu/mem movement; summed-tree compare keeps a truly-idle workspace from triggering (idle CPU≈0). native `surface-manager.ts` setSurfaceMetadata gate; web `main.ts` render gate adds `state.surfaces`.
- ✅ **W1-RESIZE** — sidebar drag `onLive`→`positions` (native), `applyLayout(state,{fit:false})` (web); full fit on commit. [line-height on resize]
- ✅ **W1-SCROLL** — shared `resizePreservingScroll` in `xterm-fit.ts`, used by native `fitSurfaceTerminal` + shared `fitTerminal`. Guards `type==='normal'`. Tests: xterm-resize-scroll +6. [scroll jumps to top]
- ✅ **W1-SIDEBAND** — resting opacity set synchronously by `applyMeta` (`?? 1`); entrance is CSS keyframe `.panel-enter` stripped by rAF+timeout+animationend nets, never rAF-gated. CSS native+web parity; audit-animations registry updated. [sideband transparent]
- ✅ **W1-NOTIFOVERLAY** — `reconcileChildren` replaces `innerHTML=""`; entrance is one-shot `.tau-notif-overlay-card--enter` (native+web CSS). Surviving cards keep nodes + running meters.

## WAVE 2 — memory & perf hygiene ✅ CORE COMPLETE
- ✅ **W2-STATUSBAR-WEB** — web bottom bar: rAF-coalesced subscription + 1 Hz tick, per-zone innerHTML sig-skip, single `buildContext` per render. `web-client/status-bar.ts`.
- ✅ **W2-NS-LOGS** — native logs incremental append via `buildLogsShell` + per-`LogEntry`-identity row cache. `sidebar.ts`.
- ✅ **W2-NS-GLOBALSTATS** — native global-stats strip caches spans+icons once, patches textContent (stable cpu/mem/proc/port order). `sidebar.ts`.
- ✅ **W2-WEB-LOGS** — web logs reference-gate on `state.sidebar.logs`. `web-client/sidebar.ts`.
- ✅ **W2-WEB-RO-LEAK** — `TermRef.cleanup` disconnects per-pane ResizeObserver + clears resize timer in `disposePane`. `web-client/main.ts`.
- ✅ **W2-BROWSER-RETRY** — `applyHiddenState` destroy-guard + attempt cap (~2 s); `destroyBrowserPaneView` clears the timer. `browser-pane.ts`.
- ✅ **W2-METADATA-BLUR** — tri-state poll cadence (focused 1000 / visible-unfocused 1800 / hidden 3000); `windowVisibility` payload gains optional `focused`. `index.ts`, `viewport.ts`, `types.ts`.
- ✅ **W2-DISK-LEAKS (W2b/c/d)** — AutoContinue `forgetSurface` wired from PTY/browser/agent close routes (+test); WebStateStore snapshot prunes+filters dead-workspace status/progress (`server.ts buildSnapshot`); `requestTitleCache` hard cap (200).
  - ⏸ W2a telegram link prune interval, W2e file-explorer LRU — deferred (slow-growth, bounded by boot-time prune; low value).

## WAVE 3 — correctness & resilience ✅ COMPLETE
- ✅ **W3-TELEGRAM-ISOLATE** — try/catch around `onIncoming` + `onCallback` (a throwing host handler can't demote the poll loop → keeps notifications + ht socket alive). `telegram-service.ts`.
- ✅ **W3-AGENT-SPLIT-CATCH** — both `splitAgentSurface` + `createAgentSurface` `agent.start().catch → onExit(1)` so a spawn-throw shows an `agent_exit` banner, not an inert pane. `index.ts`.
- ✅ **W3-PTY-GUARD** — try/catch around `onStdout` dispatch (never crash the PTY pipeline). `session-manager.ts`.
- ✅ **W3-REMOVESURFACE-ORDER** — registry deletes moved before the workspace branch so `switchToWorkspace` never iterates the corpse. `surface-manager.ts`.

## WAVE 4 — polish & latent footguns
- ✅ **W4-SOCKET-PATH** — CLI default now brand-derived (`HT_CONFIG_DIR ?? <OS config>/hyperterm-canvas/hyperterm.sock`), mirroring the app; `pty-manager` `/tmp` fallback dropped; `bin/ht` help updated. Validated: `ht identify` reports the real socket. `cli/rpc-client.ts`, `pty-manager.ts`, `bin/ht`. [hardcoded socket]
- ⏸ **W4-CWD-ROW** — deferred: audit said moot after W1-STATROW (sigs don't move per-tick; flicker complaint resolved by stat-row reconcile).
- ⏸ **W4-AGENT-DESTROY** — deferred: audit confirmed NOT a real leak (listeners scoped to detached container; ≤1 stray rAF <16 ms). Hygiene-only; skip to avoid risk on the 1877-LOC agent panel.
- ⏸ **W4-STATUSBAR-IDLE** — deferred (clean fix is an event-drive refactor).

## Bonus (pre-existing quality-gate regressions fixed during verification)
- ✅ **audit:theming** was RED — `.agent-dead-banner` (H13) used raw `#f87171` literals (added after the v0.3.148 "0 literals" baseline). Swapped for `var(--ht-sem-error)`. Gate green.
- ✅ **audit:test-hooks** was RED — stale auditor checked `index.ts` for the `enableTestMode` gate that the F.10 refactor moved to `viewport.ts`. Updated the auditor to verify the post-refactor facts (`htTestMode: HT_TEST_MODE` wiring + `if (ctx.htTestMode)` gate). Gate green.

## Progress log
- 2026-06-09: audit complete, roadmap saved. Starting Wave 1.
- 2026-06-09: Wave 1 (all 6 items) complete + verified — typecheck green, 3092/0 tests, lint clean, prod web bundle builds, `bun start` boots clean. +9 new tests. NOT committed (working tree) — bump:patch→0.3.187 + commit pending user go-ahead.
  - Files: sidebar.ts, surface-manager.ts, panel.ts, index.css (native); workspace-card.ts, cpu-sparkline.ts, main.ts, layout.ts, client.css (web); xterm-fit.ts, notification-overlay.ts (shared); audit-animations.ts; +tests xterm-resize-scroll, sidebar-card-stability, web-client-sidebar.
- 2026-06-09: Waves 2+3 + W4-SOCKET-PATH complete + verified. Final gate: typecheck green, **3093/0 tests**, lint clean, all 6 audit scripts green (incl. 2 pre-existing red gates fixed), prod web bundle + CLI build clean, `bun start` boots clean, `ht identify` reports real socket. +1 new test (auto-continue forgetSurface). Deferred (low value): W2a, W2e, W4-CWD-ROW, W4-AGENT-DESTROY, W4-STATUSBAR-IDLE.
  - Added files touched: telegram-service.ts, session-manager.ts, pty-manager.ts, viewport.ts, auto-continue-engine.ts, web/server.ts, web/state-store.ts (via forgetWorkspace), cli/rpc-client.ts, bin/ht, shared/types.ts, scripts/audit-test-hooks.ts.
- 2026-06-09: Committed on branch `aaa-polish` (NOT pushed), bumped 0.3.186→0.3.187.
  - `bb2fda93` chore(deps): fallow dead-code cleanup (pre-existing working-tree state).
  - `5e04831c` feat(polish): AAA flicker/memory/resilience pass (v0.3.187) — Waves 1–3 + W4-SOCKET-PATH + 2 gate fixes, +bump.
