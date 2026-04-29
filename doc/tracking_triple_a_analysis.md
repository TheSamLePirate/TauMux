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

---

## Steps
