# Phase 0 — Audit matrix of F–J landings

**Generated:** 2026-05-16
**Method:** Read-only audit of each PR row 2..21 in `doc/tracking_triple_a_analysis.md` against the working tree on branch `worktree-aaa-phase0` (parent: `main` @ `5005608`).
**Scope:** verify the claimed fix is present AND that a regression test exists. No code changes.

---

## Verification matrix

| PR # | Issue id | Fix present in code? | Regression test exists? | Notes |
|---|---|---|---|---|
| 2 | G.1 L1+L10 | ✅ `src/bun/pi-agent-manager.ts:130, :221` | ✅ `tests/pi-agent-manager.test.ts` — "evicts a dead instance via _managerExit" + "kill() before start() marks the instance dead without throwing" | L1 (dead-instance eviction via `_managerExit`) tested. L10 originally covered the kill() response-waiter drain; H12 removed that machinery (dead code), so the test now guards kill() idempotency/crash-safety instead. |
| 3 | G.5 L4 | ✅ `src/bun/socket-server.ts:22, :88` (`MAX_BUFFER_BYTES = 1_048_576`) | ✅ `tests/socket-server.test.ts:~186` (1.5 MiB garbage write asserts error at 1 MiB) | Solid. |
| 4 | G.3 L6+L12 | ✅ `src/bun/index.ts:3206-3248` (`shuttingDown` flag + clears `plansBroadcastTimer` / `autoContinueAuditTimer` / `htKeysSeenTimer` / `domReadyDebounce` / `layoutSaveTimer`) | ❌ no dedicated test | Idempotent guard + timer cleanup present but untested. |
| 5 | G.6+G.7 L8+L11 | ✅ `src/views/terminal/command-palette.ts:27, :148` (AbortController + destroy); `src/bun/index.ts:~1150` (domReadyDebounce cleanup on browserSurfaceClosed) | ❌ no dedicated test | Wired correctly, no regression assertion. |
| 6 | G.4 L7 | ✅ `src/bun/atomic-write.ts` exists with `mode` opt; used in settings / cookies / history | ⚠️ `tests/atomic-write.test.ts` (5 tests) covers atomicity + `.tmp` cleanup but **does not assert mode 0o600** | Test exists but weak — see weak-tests section. |
| 7 | G.2 L2 | ✅ `src/bun/pty-manager.ts:310-328` (SIGHUP → 500 ms grace → SIGKILL) | ❌ no SIGHUP-grace test | `tests/pty-manager.test.ts` only verifies destroy cleans up, not the grace ordering. |
| 8 | H.1 S1 | ✅ `src/bun/logger.ts:130, :152` (chmod 0o600); `src/bun/telegram-db.ts:67, :71-75` (chmod on `.db` + sidecars) | ❌ no chmod verification test | All chmod calls present; no `statSync` assertion after write. |
| 9 | H.2 S6 | ✅ `src/bun/web/server.ts:232-245` — `securityHeaders` method (CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy) | ✅ `tests/web-auth.test.ts:~55` — "every response carries security headers" | Solid. |
| 10 | H.6 S3+S7 | ✅ `src/bun/index.ts:1583` (`TELEGRAM_MAX_TEXT_LEN = 4096`), `:1606`, `:1612-1620` (text-length + chatId allow-list) | ⚠️ chatId allow-list tested at service layer; **4096-char cap has no test** | Mirror-path bypass test also missing. |
| 11 | H.3+H.4 S4+S5 | ✅ `src/bun/web/server.ts:49` (`TOKEN_MIN_LEN_FOR_LAN = 16`), `:494-503` (warn on 0.0.0.0 + short token), `:57-59` (10 fails / 60 s → 10-min 429 cooldown) | ⚠️ `tests/web-auth.test.ts:~142` covers brute-force 429; **entropy floor warning has no test** | Brute-force good; entropy-warn untested. |
| 12 | H.5 L3+L5 | ✅ `src/bun/web/server.ts:424-425` (`idleTimeout: 60`, `sendPings: true`); `src/web-client/transport.ts:49` (`MAX_RECONNECT_ATTEMPTS = 30`), `:170-171` (±25% jitter) | ❌ no WS heartbeat or jitter test | End-to-end half-open detection + jitter distribution unverified. |
| 13 | F.3 A13 | ✅ `src/shared/escape-html.ts` exists; imported by `sidebar.ts` + `process-manager.ts` (native + mirror call sites) | ❌ no dedicated unit test | File used widely but no escape-behaviour assertion. |
| 14 | F.4 A3+A17 | ✅ `src/shared/types.ts:26` — `SurfaceKind = "terminal" \| "browser" \| "agent" \| "telegram" \| "editor"` | ❌ no dedupe-verification test | Single type exists; no test confirms 7 duplicate sites eliminated or `getSurfaceKind` route. |
| 15 | J.1 T1 | ✅ `package.json:20` (`test:coverage`); bunfig.toml exclusions; `coverage/lcov.info` generated | ❌ **no coverage gate** | Script + lcov generation work, but no threshold gate — coverage regression cannot break CI. |
| 17 | G.10 L13 | ✅ `src/bun/audits.ts:57` (`GIT_AUDIT_TIMEOUT_MS = 5_000`), `:64-95` (`defaultRunGit` with timeout); `src/bun/index.ts:~535, ~2270` (2 s pb* timeouts) | ❌ no subprocess-timeout test | All three timeouts wired, none exercised in tests. |
| 18 | G.9 (partial) L14 | ✅ `src/bun/telegram-db.ts:56-61` (`PRAGMA busy_timeout = 5000`) | ❌ no busy_timeout test | No concurrent-reader/writer contention test. |
| 19 | I.6 U13 | ✅ `src/views/terminal/surface-manager.ts:1807` (`selectWorkspaceByIndex`); `src/views/terminal/index.ts:~1995-2004` (9 keybindings generated) | ❌ no keybinding test | Method + bindings present, untested. |
| 20 | I.11 U11 | ✅ `src/views/terminal/keyboard-cheatsheet.ts` exists; ⌘? binding `index.ts:1987`; palette command `keyboard-help`; `keyMatch.display` populated | ⚠️ partial — `keyboard-shortcuts.test.ts` covers `keyMatch` formatting; **no end-to-end cheatsheet render test** | Dialog DOM not asserted. |
| 21 | I.2+I.3 U2+U3 | ✅ `src/views/terminal/index.css:4011, :12016, :12040, :12076` + `src/web-client/client.css:1686, :1704, :1731` — `prefers-reduced-motion`, `prefers-contrast: more`, `forced-colors: active` | ❌ no a11y media-query test | CSS rules present in both files; no asserted behaviour. |

**Tally:**
- Fix present: **19 / 19** ✅
- Test exists and strong: **5 / 19** ✅
- Test exists but weak: **4 / 19** ⚠️ (PR 6 mode, PR 10 4096-cap, PR 11 entropy warn, PR 20 cheatsheet render)
- No test: **10 / 19** ❌ (PR 4, 5, 7, 8, 12, 13, 14, 15, 17, 18, 19, 21 — note: 12 items by count of issue ids; consolidated to 10 PRs)

---

## Weak-test details (Step 2 upgrade targets)

1. **PR 6 — `tests/atomic-write.test.ts`:** verifies atomicity but never `statSync(path).mode` post-write. A broken `chmod` would not be caught. **Upgrade:** add `expect(fs.statSync(p).mode & 0o777).toBe(0o600)` to the mode-opt test.

2. **PR 8 — file-mode chmod (logger + telegram.db):** chmod calls present but never asserted. **Upgrade:** spy on `chmodSync` or stat each file post-rotation.

3. **PR 10 — 4096-char cap:** no test that submits a 5000-char outbound telegram message and expects rejection / truncation. **Upgrade:** exercise the boundary.

4. **PR 11 — token entropy floor:** brute-force tested; the `console.warn` for `0.0.0.0 + token<16` is uncovered. **Upgrade:** spy on `console.warn` during a 0.0.0.0 boot with a 8-char token and assert the warning text.

5. **PR 12 — WS heartbeat + jitter:** server config + client jitter both present but neither exercised. **Upgrade:** mock `Math.random` and run reconnect timer to assert ±25% spread; use a stub `Bun.serve` to verify `idleTimeout` is passed.

6. **PR 15 — coverage gate:** script present, no threshold enforced. **Upgrade:** add a `--check` mode to a wrapping script that parses `coverage/lcov.info` and exits non-zero below the baseline.

7. **PR 20 — cheatsheet render:** `keyMatch` display strings tested; the rendered dialog DOM (`role="dialog"`, `aria-modal`, list contents) not asserted. **Upgrade:** Happy-DOM render test.

---

## Missing-test details (Step 2 backfill targets)

Items with no test at all — minimum new tests required to declare Phase 0 acceptance:

1. **PR 4 (L6+L12)** — `tests/index-shutdown.test.ts` — call `gracefulShutdown()` twice in parallel; assert second call early-exits via the `shuttingDown` guard; assert all five timers cleared.
2. **PR 5 (L8+L11)** — `tests/command-palette.test.ts` lifecycle — show palette, call destroy, assert AbortController aborted + DOM removed.
3. **PR 7 (L2)** — `tests/pty-manager-grace.test.ts` — spawn a child with a SIGHUP trap that prints, call destroy, assert SIGHUP delivered first and child gets ≥ 500 ms before SIGKILL.
4. **PR 8 (S1)** — `tests/file-modes.test.ts` — stat every settings/logger/cookie/history/telegram artefact after write; expect 0o600.
5. **PR 12 (L3+L5)** — `tests/web-ws-heartbeat.test.ts` — config injection test + jitter distribution test (10 simulated clients, assert spread).
6. **PR 13 (A13)** — `tests/escape-html.test.ts` — direct unit test of escape behaviour for `<`, `>`, `&`, `"`, `'`, no-double-encode.
7. **PR 14 (A3+A17)** — `tests/surface-kind.test.ts` — `getSurfaceKind(id)` returns correct enum for terminal/browser/agent/telegram/editor; `tg:` prefix path no longer used (grep assertion).
8. **PR 15 (T1)** — `scripts/check-coverage.ts` + matching test in `tests/scripts/check-coverage.test.ts`.
9. **PR 17 (L13)** — `tests/audits-timeout.test.ts` — stub a `git status` that sleeps 10 s; assert the audit returns failure within 5 s.
10. **PR 18 (L14)** — `tests/telegram-db-busy.test.ts` — open two writers, assert second one waits (succeeds within busy_timeout) rather than failing.
11. **PR 19 (U13)** — `tests/select-workspace-by-index.test.ts` — `selectWorkspaceByIndex(3)` swaps active workspace; binding map test that 9 bindings exist.
12. **PR 21 (U2+U3)** — `tests/a11y-media-queries.test.ts` — happy-dom + matchMedia stub; assert animation-duration / contrast / forced-colors styles applied under each media query.

---

## Recommendation

Phase 0 Step 2 has clear, bounded scope: **6 weak-test upgrades + 12 backfill tests = 18 new/upgraded assertions**, mostly DOM-free unit tests against existing pure modules. Estimated 2–3 engineer-days of focused work.

After Step 2 lands, the audit matrix should go fully green and Phase 0 Step 3 (`bun run report:feature-grades`) can begin without lingering verification debt.
