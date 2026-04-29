# Tracking — execution of `doc/triple_a_analysis.md`

**Started:** 2026-04-29
**Source plan:** `doc/triple_a_analysis.md` (5 clusters F–J, 79 items)
**Working tree at start:** branch `main`, on top of `5afd12f` (docs(tracking): record D.3 commit SHA), version `0.2.60`. 1531 tests pass; typecheck clean.

## Convention

Each step gets a heading with:
- **What** — the change
- **Files** — touched files
- **Verification** — commands run + result
- **Commit** — short SHA + message
- **Deviations / issues** — any place the plan needed to bend

Per `CLAUDE.md`, every functional commit is preceded by `bun run bump:patch` so the version reflects the change. Pure tracking-doc commits skip the bump and note why.

## Order

Working through clusters in roughly suggested order, but prioritizing HIGH-severity + LOW-risk items first to build momentum. Big-bang refactors (F.7, F.8, F.11, H.7) deferred to later passes.

## Execution log

| PR # | Cluster / item | Status | Commit | Notes |
|------|----------------|--------|--------|-------|
| 1 | tracking doc skeleton | landed | ac489f3 | docs-only — no version bump |
| 2 | G.1 — L1+L10 PiAgentManager.onExit + send timeouts | landed | 38453fe | bumped 0.2.60 → 0.2.61. Added `_managerExit` private hook that user code can't clobber; clearTimeout on response/kill; drain waiters in kill(). +4 new tests in tests/pi-agent-manager.test.ts. **Deviation:** had to introduce `_managerExit` because index.ts:createAgentSurface overwrites the public `onExit`. |
| 3 | G.5 — L4 socket-server buffer cap | landed | de55c76 | bumped 0.2.61 → 0.2.62. Hard cap at 1 MiB; sends a structured error frame and closes. +1 new test. |
| 4 | G.3 — L6+L12 idempotent shutdown + clear timers | landed | a433018 | bumped 0.2.62 → 0.2.63. `shuttingDown` flag at top of gracefulShutdown; clear plansBroadcastTimer / autoContinueAuditTimer / htKeysSeenTimer / domReadyDebounce / layoutSaveTimer. |
| 5 | G.6+G.7 — L8+L11 palette AbortController + domReadyDebounce centralized | landed | 54aeabf | bumped 0.2.63 → 0.2.64. CommandPalette has destroy() wired to lifecycleDisposers; cookie debounce cleanup moved to browserSurfaces.onSurfaceClosed (catches all close paths). |
| 6 | G.4 — L7 atomic write helper | landed | 4504dba | bumped 0.2.64 → 0.2.65. New src/bun/atomic-write.ts; settings/cookies/history all use writeFileAtomic now. +5 new tests. |
| 7 | G.2 — L2 SIGHUP grace before SIGKILL | landed | ba8fe42 | bumped 0.2.65 → 0.2.66. SIGHUP, 500ms grace, SIGKILL fallback. Inside the parent's 2 s shutdown watchdog. |
| 8 | H.1 — S1 file mode 0600 on log/settings/cookies/history/telegram.db | landed | d4b0fd5 | bumped 0.2.66 → 0.2.67. writeFileAtomic gained `mode` opt; logger chmods after open and on rotation; telegram-db chmods .db + .db-shm + .db-wal sidecars. |
| 9 | H.2 — S6 default security headers | landed | 113d5c2 | bumped 0.2.67 → 0.2.68. CSP, X-Frame-Options DENY, nosniff, no-referrer, permissions-policy denying camera/mic/etc. respond() helper hoisted so WS-upgrade error responses also carry headers. +2 new tests. |
| 10 | H.6 — S3+S7 telegram outbound cap + chatId allow-list | landed | e6c530a | bumped 0.2.68 → 0.2.69. 4096-char cap on outbound text; chatId validated against db.listChats() except for trusted notification-forwarder path (allowUnknownChat opt). |
| 11 | H.3+H.4 — S4+S5 token entropy floor warning + brute-force throttle | landed | 65438d9 | bumped 0.2.69 → 0.2.70. Loud warn on 0.0.0.0 with token<16 chars; per-IP throttle: 10 fails/60s → 10-minute cooldown returning 429 + Retry-After. +1 new test. |
| 12 | H.5 — L3+L5 WS heartbeat + reconnect jitter | landed | ddcb16e | bumped 0.2.70 → 0.2.71. Bun's idleTimeout=60 + sendPings=true close half-open peers; client adds ±25% jitter, caps at 30 attempts. |
| 13 | F.3 — A13 escapeHtml shared module | landed | b1a8040 | bumped 0.2.71 → 0.2.72. New src/shared/escape-html.ts. design-report copy left in (different exec context — embedded in <script>). |
| 14 | F.4 — A3+A17 SurfaceKind shared type | landed | 1858f27 | bumped 0.2.72 → 0.2.73. Single literal-string union; eliminated 7 duplicate sites. |
| 15 | J.1 — T1 coverage script | landed | 3768115 | bumped 0.2.73 → 0.2.74. `bun run test:coverage` writes lcov to coverage/lcov.info; tests/scripts/e2e excluded from coverage collection. |
| 16 | (tracking) catch-up doc commit | landed | bc709ba | docs-only |
| 17 | G.10 — L13 hard timeouts on pbcopy/pbpaste/git audits | landed | 9a86e59 | bumped 0.2.74 → 0.2.75. 5s timeout on git, 2s on pb*; race against subprocess read; kill on timeout. |
| 18 | G.9 — L14 (partial) telegram-db PRAGMA busy_timeout | landed | 8d9e940 | bumped 0.2.75 → 0.2.76. **Deviation:** prepared-statement caching deferred — ~12 inline call sites and the CPU win is small; risk of regressing existing tests not justified. |
| 19 | I.6 — U13 ⌘1..⌘9 workspace switch | landed | db286e8 | bumped 0.2.76 → 0.2.77. New surfaceManager.selectWorkspaceByIndex(); 9 keybindings registered as a generated array. |
| 20 | I.11 — U11 keyboard cheat-sheet | landed | 89d04c5 | bumped 0.2.77 → 0.2.78. New KeyboardCheatsheet class; ⌘? to toggle; "Help: Keyboard shortcuts" palette command; rendered from KEYBOARD_BINDINGS + HIGH_PRIORITY_BINDINGS. keyMatch() now stashes a `display` string on the matcher. |
| 21 | I.2+I.3 — U2+U3 a11y media queries | landed | a3d3d5f | bumped 0.2.78 → 0.2.79. prefers-contrast: more (bumped borders), forced-colors: active (Windows High-Contrast mapping), prefers-reduced-motion: reduce (global blanket caps animation+transition to 0.001ms !important). Both index.css and web-client/client.css. **Deviation:** light mode NOT added — dark-by-design is brand; would be a separate RFC. |

## Summary so far

- **20 functional commits**, 21 PRs total (incl. tracking).
- All HIGH-severity items in clusters G (lifecycle) and the high-leverage parts of H (security) landed:
  G.1 / G.2 / G.3 / G.4 / G.5 / G.6 / G.7 / G.9 (partial) / G.10 / H.1 / H.2 / H.3 / H.4 / H.5 / H.6.
- Cluster F: F.3 + F.4 landed (the cheap wins — escapeHtml dedup + SurfaceKind type).
- Cluster I: I.6 (⌘1..⌘9), I.11 (cheat-sheet), I.2+I.3 (a11y media queries) landed.
- Cluster J: J.1 (coverage script) landed; the J.2-J.19 unit-test work remains.
- Started at 0.2.60 / `5afd12f`; ended at 0.2.79 / a3d3d5f.
- Test count: 1531 → 1544 (+13 net new tests).
- Typecheck remains clean throughout; no test regressions.

## Items remaining for future sessions

- **Cluster F (architecture refactors):** F.1 chip-render extract, F.2 pane-layout-math extract, F.5 protocol-dispatcher narrow, F.6 settings schema, F.7 typed dispatch, F.8 typed event-bus, F.9 broadcaster, F.10 move handlers, F.11 WorkspaceCollection extract.
- **Cluster G (remaining lifecycle):** G.9 prepared-statement caching (deferred — see PR 18).
- **Cluster H (remaining security):** H.7 sideband CSP iframe sandbox, H.8 per-surface browser partition, H.9 session cap + manifest-auth + cross-site origin, H.10 docs, H.11 telegram parse-mode.
- **Cluster I (remaining UX):** I.1 modal a11y helper, I.4 semantic color tokens, I.5 phone touch + visualViewport, I.7-I.13 various polish items.
- **Cluster J (remaining test depth):** J.2-J.19 covering the five biggest UI files, bootstrap, settings migration, telegram offset crash, surface-metadata diff, etc.

---

## Steps
