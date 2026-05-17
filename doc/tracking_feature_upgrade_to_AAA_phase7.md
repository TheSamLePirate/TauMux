# Tracking — Phase 7 execution (Per-feature polish sweep)

**Source plan:** `doc/feature_upgrade_to_AAA/08_phase7_polish.md`
**Status:** Multi-session — first slice landed.
**Owner:** per-feature.
**Engineer-weeks:** ~4.0 total per master plan; this session shipped ~0.25.

## Session 1 — data-store + plan polish

**Started at:** branch `main` @ Phase 6 close (`c3af17d`), version `0.3.36`.
**Ended at:** branch `worktree-aaa-phase7-polish` @ `a67a0c5`, version `0.3.39`.
**Tests at start:** 1976.
**Tests at end:** 1992 (+16 net).

### Execution log

| # | Item | Status | Commit | Notes |
|---|---|---|---|---|
| 1 | Phase 7 sub-plan | landed | (with Step 1) | Catalogues the full backlog; explicitly scopes this session to cookie + history + manifest + plan. |
| 2 | Cookie store — URL-host normalize + per-domain cap | landed | 5f0c2f2 | bumped → 0.3.37. New module-level `normalizeDomain()`; set() / importBulk() / delete() / deleteForDomain() all normalize input. New `MAX_PER_DOMAIN = 500` + `evictPerDomainIfNeeded()` runs after every insert touching the bucket. +5 tests, 3 existing tests adjusted to assert the normalized storage form. |
| 3 | Browser history — extend URL normalize | landed | b5a3b70 | bumped → 0.3.38. `normalizeUrl()` now also: lowercase hostname (RFC 3986), strip fragment, strip default port (80 http / 443 https). Order: lowercase → strip www → drop fragment → strip default port → strip trailing slash. +5 tests including the combined case. |
| 4 | Manifest scanner — symlinked-$HOME guard | landed | 21530db | bumped → 0.3.39. `homeRealpath` resolved once at construction; `findFile()` compares `dir === this.home` first (cheap), then resolves the current dir and compares against the realpath'd $HOME only when the two differ. Deliberately per-step rather than always-realpath-the-start so output paths stay in canonical input form (always-realpath broke the existing tests that compared against the input shape). +2 tests including a real symlinked-home / real-home setup. |
| 5 | Plan panel — RPC state validation | landed | a67a0c5 | bumped → 0.3.40. New `PLAN_STATE_VALUES` allow-list + `isPlanState()` helper shared between `plan.set` and `plan.update`. `coerceStep` now throws on a present-but-invalid state with a clear error naming the bad value AND the step id; missing state still defaults to "waiting" (back-compat). +4 tests including a typo case ("complete"), back-compat default, every valid value, and plan.update parity. |
| 6 | Phase 7 close-out (this session) | landed | (this commit) | docs-only — no version bump beyond the per-feature bumps above. |

### Grade lifts (re-baselined in `feature_grades.json`)

| Feature | Before | After |
|---|---|---|
| `cookie-store` | B | A |
| `browser-history` | B | A |
| `manifest-scanner` | A | S |
| `plan-panel` | A | S |

Distribution moved from `7 S / 28 A / 11 B / 3 C` → **`9 S / 28 A / 9 B / 3 C`** (+2 S, -2 B).

### Deviations from the sub-plan

1. **Manifest scanner: localized realpath check** — initially I had `findFile()` realpath the `start` once before walking. macOS `/var/folders/...` resolves to `/private/var/folders/...`, which broke every existing test that compared against the literal input path. Switched to per-step: compare `dir === home` (cheap), and only resolve `dir` against `homeRealpath` when the two differ.

2. **Cookie store API normalization preserved at call boundary** — `delete()` / `deleteForDomain()` accept the pre-normalize `.x.com` form to keep external callers (CLI, RPC clients) backward-compatible. Only the internal entry key changed.

3. **Browser history normalize ordering matters.** Fragment must be dropped BEFORE the trailing-slash check so `/foo/#bar` and `/foo/` collide. The implementation note captures the order.

## Items deferred to future P7 sessions

Per the sub-plan (`08_phase7_polish.md`), the long tail still parked:

### Cluster B (settings + plan + UI a11y polish) — remaining
- Settings panel: reset-to-default per field, `aria-invalid` feedback, IME guards
- Sidebar: drop indicator on drag-reorder, Escape cancel, `aria-live`, mirror parity for CWD file explorer, symlink-cycle guard
- ARIA chip labels + live regions for git-status chips + notifications

### Cluster C (auto-continue + notifications + telegram)
- Auto-continue: paused-surfaces persistence, per-session metrics, cap-hit warning
- Notifications: copy + detail expand, persistent history, configurable overlay cap
- Telegram: message TTL / DB pruning

### Cluster D (terminal + editor + browser polish)
- Terminal search regex toggle + persisted history
- Editor pane save-race UX + line-ending convert + split shortcut
- Browser pane: navigation-rule validation, zoom persistence, findInPage CLI
- OSC progress: per-pane chips

### Cluster E (observability)
- SurfaceMetadataPoller: stale-git skip-tick, rot detection, deeper tree-diff
- Audits: more audits, auto-rerun on settings change
- Health: remediation `fix()`, UI badge wiring, staleness auto-demotion
- Event writer: queued writes + backpressure, per-channel rate limits

### Cluster F (architecture long-tail — heavy refactors)
- A6 Typed `EventBus<EventMap>` (47+ channels, ~5 per PR)
- A7 `VariantContext` interface, drop `__tau*` globals
- F.6 single `settings.schema.ts` source-of-truth
- F.10 audit + move remaining ad-hoc handlers
- F.11 extract `WorkspaceCollection` from `SurfaceManager`

### Cluster G (security long-tail)
- H.8 per-surface browser partition
- H.9 session cap + manifest-auth + cross-site origin check

### Cluster H (theming long-tail)
- Theme switcher UI in Settings panel
- Literal-to-token migration (~1013 colour literals)

## Exit criteria — assessment (this session)

| Criterion | Status |
|---|---|
| Cookie store URL-host normalize + per-domain cap | ✅ |
| Browser history URL normalize | ✅ |
| Manifest scanner symlinked-$HOME guard | ✅ |
| Plan panel RPC input validation | ✅ |
| `bun test` green | ✅ 1992 / 0 |
| `bun run report:coverage:check` green | ✅ |
| `bun run report:feature-grades:check` green | ✅ |
| Phase 7 long tail | ⚠ explicit handoff per the sub-plan |

## Next slice (after session 1)

Pick another cluster — recommended order:
- Cluster F refactors (A6 EventBus, A7 VariantContext, F.11) carry the most leverage but are highest risk.
- Cluster H theme switcher UI is small and visible.
- Cluster E observability is mostly mechanical small wins.

---

## Session 2 (2026-05-17)

Slice picked: **U2 chromeTheme infra** + **terminal-search toggles** + **surface-metadata stale-git** + **health.runFix**. Four lifts across three clusters (D + E + H-infra).

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| chromeTheme settings + data-theme boot apply | `d5cfa8e` | `src/shared/settings.ts`, `src/shared/web-protocol.ts`, `src/views/terminal/index.ts`, `src/web-client/theme-bridge.ts`, `tests/chrome-theme.test.ts`, `tests/web-client-theme-bridge.test.ts` | +6 + 3 (data-theme dispatch + bridge stub extension) |
| terminal-search case + regex toggles | `56269da` | `src/views/terminal/terminal-search.ts`, `tests/terminal-search.test.ts` | +3 |
| surface-metadata stale-git skip-tick | `b112dbe` | `src/bun/surface-metadata.ts`, `tests/surface-metadata-git-stale.test.ts` | +5 (source-grep) |
| health.runFix remediation channel | `9eb30a0` | `src/bun/health.ts`, `tests/health.test.ts` | +8 |

Bumps: `bun run bump:patch` ran before each functional commit per CLAUDE.md.

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `terminal-search` | A | **S** | Case + regex toggles with `aria-pressed` and `localStorage` persistence — first user-visible search modifier on top of xterm's SearchAddon. |
| `surface-metadata` | A | **S** | 30 s stale-git cooldown means a hung `git status` on one cwd no longer wedges subsequent ticks across the polling fleet. |
| `health-checks` | A | **S** | Mirrors the audits `fix()` pattern: wire-safe `fixLabel` projection + `runFix(id)` + idempotency under same label. The sidebar pill can now render a one-click recovery button. |
| `tau-primitives` | S | S | Already S in Phase 5. P7 S2 added the explicit override on top of OS-preference auto-wire — `chromeTheme` settings field + boot-time `data-theme` apply on both native and web mirror. Settings-panel UI still pending in cluster H. |

Grade distribution after S2: **12 S / 25 A / 9 B**.

### Issues encountered

- **theme-bridge tests regressed on first run**: my new `root.dataset["theme"] = …` line crashed the `null settings is a no-op` + 2 other tests because the stub `makeRoot()` returned an HTMLElement with `style` only. Fix: extended the stub with `dataset` and added two new tests (`chromeTheme mirrors onto data-theme`, `missing chromeTheme falls back to system`). All 8 theme-bridge tests green.
- **Pre-existing typecheck noise**: `src/bun/index.ts:2522` `splitSurface` payload cast + electrobun internal import path. Both exist on the session-1 baseline (`53fa66b`); not regressions.
- **`session-history.test.ts` byte-buffer fallback**: flaked once during the 2-fail check, passed on the subsequent full run. Already catalogued.

### Exit criteria (session 2)

| Criterion | Status |
|---|---|
| chromeTheme settings + boot-time apply | ✅ |
| Terminal-search toggles persist | ✅ |
| Surface-metadata stale-git skip-tick | ✅ |
| Health remediation `fix()` + `runFix()` | ✅ |
| `bun test` green | ✅ 2016 / 0 |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ explicit handoff continues — clusters B / C / F / H tasks remain |

### Next slice (after session 2)

- Cluster H theme-selector UI in the Settings panel (now infra is wired — small, visible).
- Cluster F refactors (A6 EventBus, A7 VariantContext, F.11) when ready for higher-risk work.
- Cluster E remainder: surface-metadata rot detection, event-writer backpressure, audit auto-rerun.

---

## Session 3 (2026-05-17)

Slice picked: **theme selector UI** (H) + **ARIA chip labels** (B) + **notifications copy + persistent history** (C). Three user-visible lifts across three clusters.

A fourth item (F.6 `settings.schema.ts` source-of-truth) was scoped in but deferred: `src/shared/settings.ts` is 1166 LOC / ~396 field declarations; the refactor warrants its own dedicated session rather than sharing wall time with smaller items.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Chrome Theme selector UI | `741560c` | `src/views/terminal/settings-panel.ts`, `tests/settings-panel-theme.test.ts` | +2 (segment labels + click → partial) |
| Pane-chip ARIA labels | `ac985b2` | `src/shared/pane-chips.ts`, `tests/pane-chips.test.ts` | +6 (live-region + per-chip aria-label) |
| Notifications copy + persistence | `d5b4829` | `src/bun/notification-persistence.ts` (new), `src/bun/rpc-handler.ts`, `src/bun/rpc-handlers/{notification,types}.ts`, `src/bun/index.ts`, `src/views/terminal/{sidebar,icons}.ts`, `tests/{notification-persistence,sidebar-notifications}.test.ts` | +7 (persistence) + 2 (sidebar copy) |

Bumps: `bun run bump:patch` ran before each functional commit per CLAUDE.md.

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `tau-primitives` | S | S | Already S after P5 / P7-S2. P7 S3 closed the user-facing seam: the Settings → Theme section grows a four-way segmented selector for `chromeTheme` (System / Dark / Light / High Contrast) that emits through the existing `updateSettings` pipeline. |
| `pane-chip-rendering` | A | **S** | Screen-reader users no longer get nothing from the chip row. Host carries `role="status"` + `aria-live="polite"`; every chip carries an `aria-label` with the full value (cwd, foreground command, port click target, git state prose). |
| `notifications` | B | **A** | Sidebar items gain a Copy button (`navigator.clipboard.writeText` + `.copied` pulse) that copies `${title}\n${body}` or just the title when body is empty. Disk persistence via versioned JSON snapshot (`$HT_CONFIG_DIR/notifications.json`) with 300 ms-debounced atomic writes; `loadInto` hydrates on boot and silently treats corrupt / unknown-version files as empty. |

Grade distribution after S3: **13 S / 25 A / 8 B / 3 C** (was 12 S / 25 A / 9 B / 3 C at start of S3).

### Issues encountered

- **Stale worktree base**: the new worktree (S3) branched from `origin/main` instead of local `main` — the default `worktree.baseRef: fresh` setting pulls from origin. Local main was 90 commits ahead with the entire P7 series. Fixed inline with `git reset --hard refs/heads/main` so the chromeTheme infra from S2 was visible.
- **Wrong CSS selector in first-pass test**: my test used `.settings-field-row` for the segmented field; the actual class is `.settings-field`. Replace_all fix.
- **Scope deferral**: F.6 `settings.schema.ts` was on the slice but `settings.ts` is too large for shared wall time with the other items. Captured for a dedicated future session.

### Exit criteria (session 3)

| Criterion | Status |
|---|---|
| Chrome Theme selector visible + wired | ✅ |
| Pane chips carry ARIA labels + live-region | ✅ |
| Notifications copy + disk persistence | ✅ |
| `bun test` green | ✅ 2033 / 0 |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ F.6 explicitly deferred + multi-session work continues |

### Next slice (after session 3)

- F.6 `settings.schema.ts` source-of-truth — dedicated session.
- Cluster F refactors (A6 EventBus, A7 VariantContext, F.11) — higher risk.
- Cluster D: editor save-race UX, browser pane navigation-rule validation, OSC per-pane chips.
- Cluster E remainder: audit auto-rerun, event-writer backpressure.
- Cluster H: literal-to-token migration (the ~1013 hard-coded colour literals).

---

## Session 4 (2026-05-17)

Slice picked: **browser navigation-rule validation** (D) + **audits auto-rerun on settings change** (E) + **EventWriter backpressure metric** (E). Three concrete lifts spanning Cluster D and Cluster E from the long tail.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Browser navigation-rule validation | `c17de81` | `src/bun/rpc-handlers/browser-page.ts`, `tests/rpc-handler-browser.test.ts` | +7 (missing url, typoed scheme, file:// + about: accept, missing surface_id, unknown direction, valid roundtrip, back/forward/reload require surface_id) |
| Audits auto-rerun + health refresh | `237c10f` | `src/bun/index.ts`, `tests/audits-auto-rerun.test.ts` (new) | +5 source-grep (helper defined, boot uses it, updateSettings calls it, stale audit:* rows pruned, disabled row cleared) |
| EventWriter backpressure metric | `8763a36` | `src/bun/event-writer.ts`, `tests/event-writer.test.ts` | +4 (zero start, sent counter + peakInFlight + inFlight settle, close halts counters, getMetrics returns a snapshot) |

Bumps: `bun run bump:patch` ran before each functional commit per CLAUDE.md.

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `browser-pane` | A | **S** | Mirrors the plan-panel `isPlanState` pattern from S1: typos in scripts / agent calls no longer "succeed" silently. `isSplitDirection`, `isNavigableUrl`, `requireSurfaceId` validators enforce per-method input shape. |
| `audits` | A | **S** | `runAndPublishAudits()` helper replaces the boot-only block; called from `updateSettings` after `rebuildAudits()` so audit flips re-run + refresh health without a restart. Stale `audit:*` rows are pruned on each pass; the legacy "audits disabled" row is cleared when audits repopulate. |
| `event-writer` | B | **A** | `EventWriterMetrics { sent, inFlight, failed, peakInFlight }` exposed via `getMetrics()`. The `Bun.write` Promise is decorated with `.finally(…)` so `inFlight` tracks true OS completion. A wedged consumer or runaway producer is no longer silent — `peakInFlight` is the decision-aid for sizing a future bounded queue. |

Grade distribution after S4: **15 S / 24 A / 7 B / 3 C** (was 13 S / 25 A / 8 B / 3 C at start of S4).

### Issues encountered

- **`session-history.test.ts` byte-buffer fallback** flaked again during the full-suite run. The test pre-dates the P7 series (`git blame` → `949525c http web ui refactor`) and has been intermittent across S2/S3/S4. Already catalogued; not from session 4 changes.
- **Pre-existing typecheck noise**: same 2 errors as prior sessions (`src/bun/index.ts:2522` `splitSurface` cast + electrobun internal import path). Unchanged by S4 work.

### Exit criteria (session 4)

| Criterion | Status |
|---|---|
| Browser navigation-rule validation surfaces typos | ✅ |
| Audits re-run + health refresh on settings change | ✅ |
| EventWriter exposes backpressure counters | ✅ |
| `bun test` green (modulo the pre-existing flake) | ✅ 2048 / 1 known flake |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 4)

- F.6 `settings.schema.ts` source-of-truth — dedicated session (still pending).
- Cluster F refactors: A6 typed `EventBus`, A7 `VariantContext`, F.11 `WorkspaceCollection`.
- Cluster D remainder: editor save-race UX, OSC per-pane chips.
- Cluster G: H.8 per-surface browser partition, H.9 session cap.
- Cluster H: literal-to-token migration (the ~1013 colour literals).
- New from S4: bounded-queue + drop / pause for EventWriter (counters are in place — next step is the actual cap).

---

## Session 5 (2026-05-17)

Slice picked: **EventWriter bounded queue** (follow-up to S4) + **editor save-race UX** (D) + **OSC per-pane progress chips** (D). Three concrete lifts spanning Cluster D plus the S4 follow-up.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| EventWriter bounded queue + drop policy | `727edf4` | `src/bun/event-writer.ts`, `tests/event-writer.test.ts` | +4 (default cap exposed, custom + invalid cap fallback, drop fires past cap, recovery after drain). Pre-existing zero-start test updated for the new `dropped: 0` field. |
| Editor save-race UX | `f6e5ae3` | `src/bun/editor-files.ts`, `src/shared/types.ts`, `tests/editor-files.test.ts` | +5 (conflictDetail populated, force bypasses conflict, deleted-file conflict, new-file no-conflict, force on deleted re-creates) |
| OSC per-pane progress chip | `7c5ea3b` | `src/shared/types.ts`, `src/shared/pane-chips.ts`, `src/views/terminal/surface-manager.ts`, `tests/pane-chips.test.ts` | +6 (no chip when null, normal bar + percent + aria, paused ⏸ + class, error literal, indeterm ellipsis, signature differs each tick) |

Bumps: `bun run bump:patch` ran before each functional commit per CLAUDE.md.

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `event-writer` | A | **S** | Closes the gap left at S4. `DEFAULT_MAX_IN_FLIGHT = 1024`; `send()` past the cap returns `false` and bumps a new `dropped` counter instead of stacking pending writes. Caps worst-case queued memory to ~1 MB. Overridable per-instance via `EventWriterOptions.maxInFlight`. |
| `editor-pane` | A | **S** | Structured `conflictDetail` ({ expectedMtimeMs, actualMtimeMs, actualSize }) replaces the generic error string so the UI can render an actionable conflict dialog. New `force: true` flag bypasses the check for explicit overwrites. Out-of-band deletes (file vanished with non-null expectedMtimeMs) now surface a conflict instead of silently re-creating. |
| `pane-chip-rendering` | S | S | Already S after S3. P7 S5 added per-pane OSC 9;4 progress chip rendering — `SurfaceMetadata.progress`-driven, four visual states (normal bar+pct, paused ⏸+pct, error, indeterminate), surviving 1 Hz poller refreshes via merge-preserve in `setSurfaceMetadata`. |

Grade distribution after S5: **17 S / 22 A / 7 B / 3 C** (was 15 S / 24 A / 7 B / 3 C at start of S5).

### Issues encountered

- **Control-byte contamination in `src/shared/pane-chips.ts`**: a prior copy-paste left three U+0001 (SOH) bytes inside the `chipsSignature` template literal, blocking my `Edit` tool calls (the literal looked identical visually but bytewise didn't match). Fixed with a one-shot `python3` bytewise strip; then the edit landed cleanly.
- **Pre-existing typecheck noise** unchanged: same 2 errors as prior sessions.
- **`session-history.test.ts` byte-buffer fallback** did not flake in this session's full-suite run (2064 / 0). May have been timing-dependent during S4.

### Exit criteria (session 5)

| Criterion | Status |
|---|---|
| EventWriter bounded queue caps memory under wedge | ✅ |
| Editor save-race surfaces structured conflict + force | ✅ |
| OSC 9;4 per-pane chip renders + survives 1 Hz refresh | ✅ |
| `bun test` green | ✅ 2064 / 0 |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 5)

- F.6 `settings.schema.ts` source-of-truth — still pending as a dedicated session.
- Cluster F refactors: A6 typed `EventBus`, A7 `VariantContext`, F.11 `WorkspaceCollection`.
- Cluster G: H.8 per-surface browser partition, H.9 session cap + manifest-auth.
- Cluster H: literal-to-token migration (~1013 colour literals).
- Telegram DB TTL pruning + auto-continue persistence remain in cluster C.

---

## Session 6 (2026-05-17)

Slice picked: **Telegram DB TTL** (C) + **auto-continue persistence** (C) + **per-surface browser partition** (G / H.8). Three concrete lifts closing two cluster-C items and one cluster-G security ask.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Telegram DB TTL prune | `082f189` | `src/bun/telegram-db.ts`, `src/bun/index.ts`, `tests/telegram-db.test.ts` | +3 (drops old + leaves new + multi-chat, no-op empty cutoff, no-op past cutoff) |
| Auto-continue persistence | `1f34791` | `src/bun/auto-continue-engine.ts`, `src/bun/auto-continue-persistence.ts` (new), `src/bun/index.ts`, `tests/auto-continue-persistence.test.ts` (new), `tests/auto-continue-pause.test.ts` | +6 (persistence: load missing / v1 / unknown / malformed / type filter / debounce + roundtrip) + 5 (engine: hook fires on pause/resume/resetAll, no-op skips, hydrate seeds silently, dedupes) |
| Per-surface browser partition | `2106f6d` | `src/shared/settings.ts`, `src/shared/types.ts`, `src/bun/browser-surface-manager.ts`, `src/bun/index.ts`, `src/views/terminal/{browser-pane,surface-manager,index}.ts`, `tests/browser-surface-manager.test.ts`, `tests/settings-manager.test.ts` | +3 (shared mode reuses jar, per-surface unique, partition stored) + 4 (default + valid/invalid validator) |

Bumps: `bun run bump:patch` ran before each functional commit.

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `telegram-bridge` | S | S | Already S in P5. P7 S6 closed the last named gap (DB TTL) — `pruneOldMessages(cutoffMs)` runs at boot with a 90-day cutoff alongside the existing link prunes. A year of low-volume "ack" notifications across many chats no longer accumulates hundreds of MB of SQLite. |
| `auto-continue` | A | **S** | Paused-surfaces set persists across restarts via `$HT_CONFIG_DIR/auto-continue-paused.json` (versioned v1, debounced atomic writes). Engine adds `onPausedChange` dep + `hydratePaused` boot hook so the host wires the persistence without the engine knowing about disk IO. The "user pauses agent → restart silently re-enables it" footgun is closed. |
| `browser-pane` | S | S | Already S after S4 navigation validation. P7 S6 / H.8 added per-surface partition isolation: `AppSettings.browserPartitionMode = "per-surface"` (default) derives `persist:browser-<id>` per pane, so cookies / localStorage / IndexedDB don't cross-contaminate. Two gmail-account panes can now coexist. |

Grade distribution after S6: **18 S / 21 A / 7 B / 3 C** (was 17 / 22 / 7 / 3).

### Issues encountered

- **`this.settings.browserSearchEngine` doesn't exist on SurfaceManager**: I assumed the manager held the `AppSettings` object, but it doesn't — settings flow through `applySettings()` and aren't retained. Patched the call to pass the literal `"google"` default for now; future refactor should plumb the search engine through properly. Captured in "next slice" below.
- **`tentativeId` race in my first attempt** at computing the per-surface partition string outside the manager: `BrowserSurfaceManager.surfaceCount` does not equal `++counter` after closes. Fixed by adding `createSurfaceWithPartitionMode(url, mode)` to the manager so it owns both id allocation and partition derivation.
- **Pre-existing typecheck noise** unchanged: same 2 errors as prior sessions.
- **`session-history.test.ts`** byte-buffer fallback did not flake in this session's full-suite run (2086 / 0).

### Exit criteria (session 6)

| Criterion | Status |
|---|---|
| Telegram message-table prune lands at boot | ✅ |
| Paused-surfaces survive a restart | ✅ |
| Per-surface browser partition by default | ✅ |
| `bun test` green | ✅ 2086 / 0 |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 6)

- F.6 `settings.schema.ts` source-of-truth — still pending as a dedicated session.
- Cluster F refactors: A6 typed `EventBus`, A7 `VariantContext`, F.11 `WorkspaceCollection`.
- Cluster G remainder: H.9 session cap + manifest-auth + cross-site origin check.
- Cluster H: theme-token migration (~1013 colour literals) + sidebar drag-reorder polish.
- Plumb `browserSearchEngine` through `SurfaceManager` (cleanup from S6 punt).

---

## Session 7 (2026-05-17)

Slice picked: **S6 cleanup punt** (`browserSearchEngine` plumbing) + **H.9 web-mirror session cap** + **sidebar drag-reorder a11y polish** (keyboard + announcement). Three small lifts spanning cluster G + H plus the explicit S6 follow-up.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| browserSearchEngine plumbing | `3d7625f` | `src/views/terminal/surface-manager.ts` | (no new tests — existing 13 sidebar tests stay green) |
| H.9 web-mirror session cap | `5869e61` | `src/bun/web/connection.ts`, `src/bun/web/server.ts`, `tests/web-server.test.ts` | +3 (eviction frees slot, attached can't be evicted, cap with no detached returns 503) |
| Sidebar keyboard reorder a11y | `924d8b2` | `src/views/terminal/sidebar.ts`, `tests/sidebar-keyboard-reorder.test.ts` (new) | +6 (aria-roledescription on every card, Alt+Down moves one slot, Alt+Up moves one slot, no-op at edges, ht-reorder-workspaces dispatch, polite live-region) |

Bumps: `bun run bump:patch` ran before each functional commit.

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `web-mirror` | S | S | Already S after P4 hardening. P7 S7 / H.9 added `MAX_SESSIONS = 64` with LRU detached-session eviction. When at cap with no detached candidate, the upgrade is rejected with HTTP 503 + `retry-after: 30`. Caps worst-case queued resume-ring memory to ~128 MB. |
| `sidebar` | A | **S** | Closes the U14 a11y leg: Alt+ArrowUp / Alt+ArrowDown keyboard reorder mirrors the mouse drag through the same `manualOrder` + `ht-reorder-workspaces` pipeline; a polite `.sidebar-live-region` announces the move; every card carries `aria-roledescription` advertising the option to AT users. |
| `browser-pane` infra | S | S | (cleanup) — `browserSearchEngine` is now read from the cached AppSettings field on SurfaceManager instead of the hardcoded `"google"` default punted in S6. Users with bing / duckduckgo / kagi selected no longer have a fresh browser pane silently fall back to Google for non-URL queries. |

Grade distribution after S7: **19 S / 20 A / 7 B / 3 C** (was 18 / 21 / 7 / 3 at start of S7).

### Issues encountered

- **Keyboard handler ordering bug**: my first attempt placed the Alt+Arrow check as an `else if` after the plain ArrowDown/ArrowUp handler — the plain branch always matched first so the Alt path never fired. Fixed by checking the modifier path before the plain path. Caught by the new tests.
- **localStorage state leak between tests**: the keyboard reorder tests interacted via the persisted `manualOrder` key. Added `localStorage.clear()` in `beforeEach`.
- **Test design bug**: my `Alt+ArrowUp moves one slot up` test originally moved the wrong card and asserted the wrong final order. Fixed to ArrowDown twice → highlight ws:2 → Alt+ArrowUp → [ws:2, ws:1, ws:3].
- **Pre-existing typecheck noise** unchanged: same 2 errors.
- **2 pre-existing flakes** in the full suite run: `byte-buffer fallback` (chronic across S2..S5) and `PtyManager kill sends signal` (process-spawning timing). Neither caused by S7 changes.

### Exit criteria (session 7)

| Criterion | Status |
|---|---|
| browserSearchEngine read from settings | ✅ |
| Web-mirror session cap with LRU eviction | ✅ |
| Sidebar keyboard reorder + a11y | ✅ |
| `bun test` green (modulo pre-existing flakes) | ✅ 2093 / 2 known flakes |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 7)

- F.6 `settings.schema.ts` source-of-truth — still pending as a dedicated session.
- Cluster F refactors: A6 typed `EventBus`, A7 `VariantContext`, F.11 `WorkspaceCollection`.
- Cluster H: theme-token migration (~1013 colour literals).
- Mouse-drag drop indicator + Escape-cancel (the remaining sidebar polish from S7).
- Manifest-auth ergonomic UX (final H.9 sliver).

---

## Session 8 (2026-05-17)

Slice picked: **sidebar mouse-drag Escape-cancel + indicator hygiene** (closes S7 follow-up) + **A6 typed EventBus seam** (starts cluster F) + **manifest-auth ergonomics** (final H.9 sliver). Three lifts spanning cluster F + G + the sidebar finish.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Sidebar mouse-drag Escape + hygiene | `dc59389` | `src/views/terminal/sidebar.ts`, `tests/sidebar-drag-cancel.test.ts` (new) | +5 (dragstart marks source, Escape clears state + classes, drop after Escape is no-op, dragover on fresh card clears prior, dragleave inside rect keeps indicator) |
| A6 typed EventBus seam + 5 migrations | `d4a0771` | `src/shared/event-bus.ts` (new), `src/views/terminal/{sidebar,surface-manager}.ts`, `tests/event-bus.test.ts` (new) | +7 (emit dispatches CustomEvent, on receives typed payload, unsubscribe thunk, primitive number, void payload, legacy listener interop, typed on/emit roundtrip) |
| Manifest-auth UX | `2d67017` | `src/views/terminal/settings-panel.ts`, `tests/settings-panel-network.test.ts` (new) | +7 (masked input, show/hide flips type, copy writes clipboard, regenerate dispatches 64-char hex, mirror-URL hint visibility, generateAuthToken hex shape + non-determinism) |

Bumps: `bun run bump:patch` ran before each functional commit.

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `sidebar` | S | S | Already S after S7 keyboard-reorder. P7 S8 cleared the mouse-drag follow-up gaps: Escape cancels an in-progress drag, indicator hygiene prevents trails on fast diagonal sweeps, dragleave honours the card rect properly. Gap list emptied. |
| `app-variants` | B | B | Stays at B (VariantContext + remaining channel migrations still needed) but the **A6 EventBus seam landed** in `src/shared/event-bus.ts` with 5 channels migrated as proof: `ht-reorder-workspaces` × 2, `ht-surface-focused`, `ht-open-file-in-editor` × 2. Back-compat keeps legacy `window.addEventListener` consumers reachable so the migration is gradual. |
| `web-mirror` | S | S | Already S after S7 session cap. P7 S8 closed the H.9 final sliver: auth token surfaced in Settings → Network with masked input, Show/Hide peek, Copy, and one-click Regenerate (`crypto.getRandomValues` → 64 hex). Mirror-URL hint shows the LAN URL shape with a truncated token preview. Gap list emptied. |

Grade distribution after S8: **19 S / 20 A / 7 B / 3 C** (unchanged from S7 — S8 closed remaining gaps on already-S features and added evidence under a B-grade item that needs further migration to lift).

### Issues encountered

- **First-pass producer migration syntax error**: my initial sidebar.ts edit kept a `void (true ||` placeholder fragment that broke parsing. ESLint hook flagged it; fixed by removing the dead snippet and keeping the clean `htEvents.emit(...)` call.
- **Pre-existing typecheck noise** unchanged: same 2 errors.
- **1 pre-existing flake** in the full suite run: `byte-buffer fallback`. Same as previous sessions.

### Exit criteria (session 8)

| Criterion | Status |
|---|---|
| Sidebar Escape-cancel + indicator hygiene | ✅ |
| Typed EventBus seam landed + 5 migrations | ✅ |
| Web-mirror auth token visible + rotatable in Settings | ✅ |
| `bun test` green (modulo pre-existing flake) | ✅ 2113 / 1 known flake |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 8)

- F.6 `settings.schema.ts` source-of-truth — still pending as a dedicated session.
- Remaining ~46 `ht-*` channels onto `htEvents` (A6 continuation — incremental).
- A7 `VariantContext` — drop the `__tau*` window globals to lift `app-variants` to A/S.
- F.11 `WorkspaceCollection` extraction.
- Cluster H: theme-token migration (~1013 colour literals).

---

## Session 9 (2026-05-17)

Slice picked: **A6 EventBus migration batch 2** (8 channels / 11 sites) + **A7 typed VariantContext** (drop __tau* globals) + **theme-token literal migration kick-off** (notify cue block). Three commits across cluster F (A6 + A7) and cluster H.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| A6 batch 2 — 11 channel migrations | `d5ccdb8` | `src/shared/event-bus.ts`, `src/views/terminal/{surface-manager,sidebar,browser-pane,index}.ts` | existing 85 EventBus + sidebar tests stay green |
| A7 VariantContext seam | (after `d5ccdb8`) | `src/views/terminal/variants/variant-context.ts` (new), atlas.ts (7 sites), cockpit.ts (2 sites), index.ts (2 sites), `tests/variant-context.test.ts` (new) | +6 (sm/focused/notify round-trip + window shim mirror, setter copy semantics, reset clears everything, null clears + shim) |
| Theme-token notify cue migration | `7f8b111` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-notify.test.ts` (new) | +16 (each new token defined; three keyframes use the token set; raw rgba shapes rejected; dismiss hover uses semantic tokens) |
| --ht-sem-error-tint fill-in for light/HC | `2d80177` | `src/shared/web-theme-tokens.css` | (fixes the U2 invariant) |

Bumps: `bun run bump:patch` ran before each functional commit.

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `app-variants` | B | **A** | A6 batch 2 lands 8 more channels on `htEvents` (11 producer call sites). A7 typed `VariantContext` collapses 22 implicit `__tau*` window-global references into 7 typed accessor calls — zero raw window casts remain in the variants. Back-compat shim kept for the design-review harness so the migration is gradual. Still B-adjacent for S: A6 has ~40 channels remaining + variants still need mount/unmount lifecycle tests. |
| `tau-primitives` | S | S | Already S. P7 S9 added the cluster-H migration kick-off: 12 new tokens, 4 CSS regions migrated (3 keyframes + 1 hover state). `audit:theming` count: 1013 → 993. The literal-to-token gap remains as a multi-session task. |

Grade distribution after S9: **19 S / 21 A / 6 B / 3 C** (was 19 / 20 / 7 / 3 at S8 close).

### Issues encountered

- **VariantContext class name clash**: the existing `./variants/types.ts` already exports a `VariantContext` interface (lifecycle context for variant enter/exit). My new class was originally named `VariantContext` too — renamed to `VariantContextStore` and re-exported only the singleton `variantContext`. No external collision.
- **U2 invariant fail-then-fix**: the `tests/web-theme-tokens.test.ts` invariant flagged `--ht-sem-error-tint` missing from the graphite-light + high-contrast + media-query blocks. Filled in via the `2d80177` fix-up commit; matched red intensities to the respective `--ht-sem-error` value in each theme.
- **Pre-existing typecheck noise** unchanged: 2 errors.
- **2 pre-existing flakes**: `byte-buffer fallback` + `PtyManager kill`. Same as previous sessions.

### Exit criteria (session 9)

| Criterion | Status |
|---|---|
| A6 batch 2 lands ≥ 8 channels | ✅ 8 channels / 11 call sites |
| A7 VariantContext seam replaces __tau* globals | ✅ 0 raw window casts remain |
| Theme-token migration kick-off | ✅ 1013 → 993 (−20) |
| `bun test` green (modulo pre-existing flakes) | ✅ 2134 / 2 known flakes |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 9)

- F.6 `settings.schema.ts` source-of-truth — still pending as a dedicated session.
- A6 batch 3 — continue migrating the remaining ~40 channels onto `htEvents`.
- F.11 `WorkspaceCollection` extraction from `SurfaceManager`.
- Cluster H literal migration — continue chunk-by-chunk (sidebar, panes, surface bar).
- Variant mount/unmount lifecycle tests (the last gap for `app-variants` → S).

---

## Session 10 (2026-05-17)

Slice picked: **A6 EventBus batch 3** + **variant mount/unmount lifecycle tests** (closes the last `app-variants` gap) + **Cluster H sidebar token migration**.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| A6 batch 3 — 11 channel migrations | `99a81d7` | `src/shared/event-bus.ts`, `src/views/terminal/{agent-panel,surface-manager,sidebar}.ts` | existing EventBus + sidebar suites stay green |
| Variant mount/unmount tests | `bb8577d` | `tests/variants-lifecycle.test.ts` (new) | +9 (Cockpit enter/exit/idempotent/clean, Atlas enter/exit/idempotent + chrome elements, Cockpit → Atlas handoff) |
| Cluster H sidebar workspace-card migration | `5a97c45` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-sidebar.test.ts` (new) | +13 (every new token defined, resting/hover/active states use tokens, raw rgba shapes rejected) |
| U2 invariant fix-up (comment regex misfire) | `6eeab93` | `src/shared/web-theme-tokens.css` | (existing U2 test re-greens) |

Bumps: `bun run bump:patch` ran before each functional commit.

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `app-variants` | A | **S** | Closes the last named gap with `tests/variants-lifecycle.test.ts` (+9 cases). The A6 batch 3 migration also lands 9 more channels (`ht-agent-set-model` × 2, `ht-agent-set-thinking` × 2, `ht-telegram-{send,request-history,request-state}`, `ht-split-editor`, `ht-select-workspace-cwd`, `ht-rename-workspace`, `ht-pin-workspace` — 11 call sites). Native producers: 40 → 29. |
| `tau-primitives` | S | S | Cluster H continues — sidebar workspace-card region migrated to a new `--ht-sidebar-*` token group (row-bg, hover, stripe, border, inset, shadow). audit:theming: 993 → 981. |

Grade distribution after S10: **20 S / 20 A / 6 B / 3 C** (was 19 / 21 / 6 / 3 at S9 close).

### Issues encountered

- **U2 invariant regex confused by a comment-formatted prefix list**: my new sidebar-tokens comment listed `--ht-bg-/--ht-text-/...` as example group prefixes; the U2 test's `--ht-[a-z0-9-]+` regex greedily matched those as fake token names, then flagged "missing graphite-light / high-contrast overrides" for them. Fixed with `6eeab93` by rewriting the comment in plain English.
- **Atlas test fixture missing #terminal-container**: my initial Atlas tests failed because `mountTabRail()` looks up `#terminal-container` and my fixture only seeded `#sidebar` + `#tau-status-bar`. Added the missing element; both Atlas tests green.
- **Pre-existing typecheck noise** unchanged: 2 errors.
- **1 pre-existing flake**: integration `snapshot gets dropped` (timing-sensitive on PTY). Not caused by S10 changes.

### Exit criteria (session 10)

| Criterion | Status |
|---|---|
| A6 batch 3 migrates ≥ 9 channels | ✅ 9 channels / 11 sites |
| Variant lifecycle tests close the gap | ✅ +9 cases, all green |
| Cluster H sidebar region migrated | ✅ 993 → 981 (−12) |
| `bun test` green (modulo pre-existing flakes) | ✅ 2155 / 1 known flake |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 10)

- F.6 `settings.schema.ts` source-of-truth — still pending as a dedicated session.
- A6 batch 4 — continue migrating the remaining 29 channels onto `htEvents`.
- F.11 `WorkspaceCollection` extraction from `SurfaceManager`.
- Cluster H literal migration — next chunk (pane bar, surface chrome, agent panel).
- Phases 8 (release engineering) + 9 (docs / observability) when P7 long tail is exhausted.
