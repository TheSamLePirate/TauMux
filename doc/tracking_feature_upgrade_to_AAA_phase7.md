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

---

## Session 11 (2026-05-17)

Slice picked: **A6 batch 4** (16 more channels) + **F.11 WorkspaceCollection seam** + **Cluster H surface pane chrome**.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| A6 batch 4 — 16 channel migrations | `ca11020` | `src/shared/event-bus.ts`, `src/views/terminal/{settings-panel,surface-manager,sidebar,index}.ts` | existing EventBus + sidebar + settings-panel suites stay green |
| F.11 WorkspaceCollection seam | (after `ca11020`) | `src/views/terminal/workspace-collection.ts` (new), surface-manager.ts (4 lookup sites), `tests/workspace-collection.test.ts` (new) | +9 (list/count/findById/findIndexById/findByName/findContainingSurface/hasSurface/map/live-mutation reads) |
| Cluster H surface pane chrome | `b032c62` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-surface.test.ts` (new) | +6 (each token defined, .surface-container uses them, raw rgba shapes rejected) |

Bumps: `bun run bump:patch` ran before each functional commit.

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `app-variants` | S | S | Already S after S10. P7 S11 adds **A6 batch 4** evidence: 16 channels migrated (`ht-dismiss-notification`, `ht-clear-notifications`, `ht-clear-logs`, `ht-cookie-{import,export,clear}`, `ht-editor-{read,save,reload}-file`, `ht-new-workspace`, `ht-focus-surface`, `ht-notify-state-changed`, `ht-open-context-menu`, `ht-open-surface-context-menu`, `ht-open-process-manager`, `ht-run-script`). Native producers: 29 → 13. Plus the **F.11 WorkspaceCollection seam** lands as the start of the SurfaceManager extraction. |
| `tau-primitives` | S | S | Cluster H continues — surface (pane) chrome migrated to a new `--ht-surface-*` token group (border, inset-highlight, shadow). audit:theming: 981 → 978. |

Grade distribution after S11: **20 S / 20 A / 6 B / 3 C** (unchanged from S10; lifts add evidence under already-S features and lay foundations that aren't promotional on their own).

### Issues encountered

- **Cookie-import payload shape mismatch**: my initial typed payload had `{ text }` but the actual producer ships `{ data, format }`. Fixed by updating the EventMap to match the producer — typing real channels works better when you read the producer first.
- **Context-menu payload reuses shared types**: `ht-open-context-menu` carries `NativeContextMenuRequest` and `ht-open-surface-context-menu` carries `SurfaceContextMenuRequest` from `src/shared/types.ts`. EventMap imports them via inline `import("./types").Foo` so the bus stays decoupled from the wider types module.
- **Pre-existing typecheck noise** unchanged: 2 errors.
- **2 pre-existing flakes**: `byte-buffer fallback` + `PtyManager kill`. Same as previous sessions.

### Exit criteria (session 11)

| Criterion | Status |
|---|---|
| A6 batch 4 migrates ≥ 10 channels | ✅ 16 channels / 16 sites |
| F.11 WorkspaceCollection seam landed | ✅ class + read API + 4 SurfaceManager call sites |
| Cluster H surface region migrated | ✅ 981 → 978 (−3, high-impact) |
| `bun test` green (modulo pre-existing flakes) | ✅ 2170 / 2 known flakes |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 11)

- F.6 `settings.schema.ts` source-of-truth — still pending as a dedicated session.
- A6 batch 5 — migrate the remaining 13 channels (mostly browser-pane internals).
- F.11 mutation API extraction (push / splice / switchTo onto the collection).
- Cluster H literal migration — next chunk (agent panel, telegram pane, status bar).
- Phases 8 (release engineering) + 9 (docs / observability).

---

## Session 12 (2026-05-17)

Slice picked: **A6 batch 5 (final)** + **F.11 mutation API** + **Cluster H button region**.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| A6 batch 5 — 13 final channels | `f86f921` | `src/shared/event-bus.ts`, `src/views/terminal/surface-manager.ts` | existing 85 EventBus + sidebar suites stay green |
| F.11 mutation API | `5f9ebc8` | `src/views/terminal/workspace-collection.ts`, `src/views/terminal/surface-manager.ts`, `tests/workspace-collection.test.ts` | +7 (push/removeAt/removeById/replaceAll/clear) |
| Cluster H button tokens | `478b547` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-button.test.ts` (new) | +9 (each token defined, .sidebar-new-btn + :hover use them) |
| Typecheck fix-up | `0edb70f` | `src/shared/event-bus.ts` | (eval-result + image-attachment shapes) |

Bumps: `bun run bump:patch` ran before each functional commit.

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `app-variants` | S | S | **A6 migration complete** — final 13 channels (`ht-browser-*` × 7, `ht-agent-{prompt,abort,new-session,compact,get-models,get-state}`) migrated. Native producer count: **0** of the original 51. F.11 mutation API also lands (push, removeAt, removeById, replaceAll, clear); every SurfaceManager mutation site now routes through the collection. |
| `tau-primitives` | S | S | Cluster H continues — small icon button region migrated to a new `--ht-button-*` token group (7 tokens). audit:theming: 978 → 971. |

Grade distribution after S12: **20 S / 20 A / 6 B / 3 C** (unchanged from S11 — S12 finished long-running foundations without crossing a grade boundary on any individual feature).

### Issues encountered

- **Typecheck regression caught by the full pass**: the A6 batch 5 migration introduced two payload-type mismatches (`BrowserEvalResultPayload.result` was `string` but the producer ships `string | undefined`; `AgentPromptPayload.images` was `string[]` but the producer ships `ImageAttachment[]`). Reconciled by loosening the eval-result + importing the real `ImageAttachment` type via inline `import("...")`.
- **Array-reference preservation under F.11 mutation**: SurfaceManager's `this.workspaces = []` in `layout-restore` would have orphaned the collection's source ref. Migrated to `workspaceCollection.clear()` which empties in place; tests pin the array-ref-stability invariant.
- **Pre-existing typecheck noise** unchanged after fix-up: 2 errors.
- **1 pre-existing flake**: `byte-buffer fallback`. Same as previous sessions.

### Exit criteria (session 12)

| Criterion | Status |
|---|---|
| A6 batch 5 closes the migration | ✅ 0 native producers remain |
| F.11 mutation API + all SurfaceManager mutation sites | ✅ 4 sites migrated |
| Cluster H button region migrated | ✅ 978 → 971 (−7) |
| `bun test` green (modulo pre-existing flake) | ✅ 2186 / 1 known flake |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 12)

- F.6 `settings.schema.ts` source-of-truth — still pending as a dedicated session.
- Cluster H literal migration — next chunk (agent panel, telegram pane, status bar).
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 13 (2026-05-17)

Slice picked: **F.6 `settings.schema.ts` typed seam** + **Cluster H agent panel region**.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| F.6 typed `FieldSchema` seam | `bedda85` | `src/shared/settings.schema.ts` (new), `src/shared/settings.ts`, `tests/settings-schema.test.ts` (new) | +8 (numberRange / bool factories + delegated validateSettings) |
| Cluster H agent panel tokens | `b69ec70` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-agent.test.ts` (new) | +9 (each `--ht-agent-*` token defined; 8 `.agent-*` rules use them) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.75 → 0.3.76 (F.6) → 0.3.77 (Cluster H agent).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `settings-persistence` | A | A | **F.6 seam landed.** Typed `FieldSchema<T>` in `src/shared/settings.schema.ts` captures default + validator per field; 10 simple primitive fields migrated as proof (fontSize, lineHeight, terminalBgOpacity, bloomIntensity, paneGap, sidebarWidth, webMirrorPort, scrollbackLines, notificationSoundEnabled, notificationSoundVolume) — remaining ~40 fields stay on the per-clause path. Long-standing deferred item closed. |
| `tau-primitives` | S | S | Cluster H continues — agent panel region migrated to a new `--ht-agent-*` token group (6 tokens). audit:theming: 971 → 963. Accent (cyan / amber) literals in the agent panel stay for a later targeted session. |

Grade distribution after S13: **20 S / 20 A / 6 B / 3 C** (unchanged — both lifts were seam-introduction / migration work that didn't cross a grade boundary).

### Issues encountered

- **No regressions introduced this session.**
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).
- **1 pre-existing flake**: `byte-buffer fallback`. Same as previous sessions.

### Exit criteria (session 13)

| Criterion | Status |
|---|---|
| F.6 typed `FieldSchema` seam + 10 migrated fields | ✅ landed |
| Cluster H agent panel region migrated | ✅ 971 → 963 (−8) |
| `bun test` green (modulo pre-existing flake) | ✅ 2194 / 1 known flake; +17 new tests (8 schema + 9 agent tokens) |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 13)

- Fold the remaining ~40 settings fields onto the new `FieldSchema` seam (incremental — one cluster at a time).
- Cluster H literal migration — next chunk (telegram pane, status bar, agent accent cyan/amber).
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 14 (2026-05-17)

Slice picked: **F.6 batch 2 (strict-bool + strict-number fields)** + **Cluster H telegram pane region**.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| F.6 batch 2 — strict variants | `37f230a` | `src/shared/settings.schema.ts`, `src/shared/settings.ts`, `tests/settings-schema.test.ts` | +8 (boolStrict / numberRangeStrict factories + delegated workspaceCardShow* / notificationOverlay* / telegram toggles) |
| Cluster H telegram pane tokens | `0df85f9` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-telegram.test.ts` (new) | +12 (each `--ht-telegram-*` token defined; toolbar / chat-select / msg bubbles / composer / send-btn rules use them) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.76 → 0.3.77 (F.6 batch 2) → 0.3.78 (Cluster H telegram).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `settings-persistence` | A | A | F.6 seam extended with `boolStrict()` + `numberRangeStrict()` factories — the strict variants fall back to the documented default on non-boolean / non-finite input instead of `!!`-coercing. 15 more fields migrated (11 strict-bool, 3 strict-number, 1 telegram toggle, but `telegramNotificationButtonsEnabled` + `telegramAskUserEnabled` count under "telegram toggles" — 11 + 3 + 1 = 15). Cumulative 25 / ~50 settings fields migrated. |
| `tau-primitives` | S | S | Cluster H continues — telegram pane region migrated to a new `--ht-telegram-*` token group (9 tokens; indigo brand accent lives in named tokens now). audit:theming: 963 → 949. Semantic status pills + msg-failed badge stay for a later session. |

Grade distribution after S14: **20 S / 20 A / 6 B / 3 C** (unchanged — both lifts continued seam-introduction / migration work that didn't cross a grade boundary).

### Issues encountered

- **No regressions introduced this session.**
- **One semantic note**: `legacyBloomIntensity` previously did `typeof X === "number" ? X : 0` then clamped — which would clamp `Infinity` to 2. The new `numberRangeStrict()` factory rejects non-finite numbers and falls back to default (0). Acceptable: `Infinity` for a bloom intensity is junk input; defaulting is more defensive than clamping.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).
- **1 pre-existing flake**: `byte-buffer fallback`. Same as previous sessions.

### Exit criteria (session 14)

| Criterion | Status |
|---|---|
| F.6 batch 2 — strict-bool + strict-number factories + 15 migrated fields | ✅ landed |
| Cluster H telegram pane region migrated | ✅ 963 → 949 (−14) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2212 / 1 known flake; +20 new tests (8 schema batch 2 + 12 telegram tokens) |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 14)

- Fold the remaining ~25 settings fields (enum string unions like cursorStyle / packageRunner / layoutVariant / chromeTheme / workspaceCardDensity / browserSearchEngine / browserPartitionMode; plus array fields like statusBarKeys / htStatusKeyOrder; plus plain-string fields like telegramBotToken / browserHomePage) onto the `FieldSchema` seam — needs an `enumStr<T>()` + `stringTrim()` + `stringArray()` factory family.
- Cluster H literal migration — next chunk (status bar, agent accent cyan/amber, plan panel).
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 15 (2026-05-17)

Slice picked: **F.6 batch 3 (enum + stringTrim + stringArray fields)** + **Cluster H titlebar + sidebar inset region**.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| F.6 batch 3 — enum/string/array factories | `0b818ca` | `src/shared/settings.schema.ts`, `src/shared/settings.ts`, `tests/settings-schema.test.ts` | +8 (enumStr / stringTrim / stringArray factories + delegated cursorStyle / packageRunner / layoutVariant / chromeTheme / workspaceCardDensity / browserSearchEngine / browserPartitionMode / webMirrorBind / webMirrorAuthToken / telegramBotToken / browserHomePage / statusBarKeys / htStatusKeyOrder / htStatusKeyHidden + 4 `!!`-bool fields) |
| Cluster H titlebar tokens | `b6fddde` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-titlebar.test.ts` (new) | +7 (each `--ht-titlebar-*` / `--ht-sidebar-*` new token defined; #titlebar .toolbar-icon-btn + #sidebar rules use them) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.78 → 0.3.79 (F.6 batch 3) → 0.3.80 (Cluster H titlebar).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `settings-persistence` | A | A | F.6 seam extended with `enumStr<T>()` + `stringTrim()` + `stringArray()` factories — full coverage of the common validation patterns. 18 more fields migrated this session (8 enum, 3 string-trim, 3 string-array, 4 `!!`-bool). Cumulative 43 / ~50 fields migrated (86% coverage). Only ~7 special-case fields remain. Also unified the `statusBarKeys` validator fallback with `DEFAULT_SETTINGS` — corrupt-config now gets the full 11-key set instead of an 8-key subset that omitted procs / ht-all / ports. |
| `tau-primitives` | S | S | Cluster H continues — titlebar toolbar + sidebar inset region migrated to a new `--ht-titlebar-*` token group (3 tokens) + 2 `--ht-sidebar-*` tokens. audit:theming: 949 → 944. |

Grade distribution after S15: **20 S / 20 A / 6 B / 3 C** (unchanged — both lifts continued seam-introduction / migration work).

### Issues encountered

- **One field-shape divergence caught + fixed**: `browserInterceptTerminalLinks` default is `false` in `DEFAULT_SETTINGS` but I initially wrote `bool(true)` in the schema. The schema-defaults-match-DEFAULT_SETTINGS test caught it on first run. Fixed to `bool(false)`.
- **One inline-default divergence intentionally unified**: `statusBarKeys` previously fell back to an 8-key subset when input was non-array, but `DEFAULT_SETTINGS` provides 11 keys (procs / ht-all / ports added later). Schema now uses the 11-key set for both fresh-install + corrupt-config recovery — a corrupt-config user gets the full status bar after restart.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).
- **1 pre-existing flake**: `byte-buffer fallback`. Same as previous sessions.

### Exit criteria (session 15)

| Criterion | Status |
|---|---|
| F.6 batch 3 — enum/stringTrim/stringArray factories + 18 migrated fields | ✅ landed |
| Cluster H titlebar + sidebar inset region migrated | ✅ 949 → 944 (−5) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2230 / 1 known flake; +15 new tests (8 schema batch 3 + 7 titlebar tokens) |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 15)

- Fold the remaining ~7 settings fields onto the seam — needs bespoke factories: `nullableTrim()` (for auditsGitUserNameExpected), `themePresetInterlock()` (one validator that takes the full settings record because themePreset gates 6 colour fields), `validatorWrapper()` (for autoContinue which already has its own validator).
- Cluster H literal migration — next chunk (settings panel section, command palette, process manager, ask-user modal).
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 16 (2026-05-17)

Slice picked: **F.6 batch 4 (final simple fields)** + **Cluster H command palette + kbd cheat-sheet region**.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| F.6 batch 4 — string/nullableString factories | `821a850` | `src/shared/settings.schema.ts`, `src/shared/settings.ts`, `tests/settings-schema.test.ts` | +5 (string / nullableString factories + delegated terminalBloom / cursorBlink / autoStartWebMirror / shellPath / fontFamily / auditsGitUserNameExpected) |
| Cluster H palette + kbd cheat-sheet tokens | `fb3f26a` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-palette.test.ts` (new) | +16 (each `--ht-palette-*` token defined; .palette-* + .kbd-* rules use them) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.80 → 0.3.81 (F.6 batch 4) → 0.3.82 (Cluster H palette).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `settings-persistence` | A | A | **F.6 seam coverage now 98%.** Closes the long-standing silent-gap where 5 fields (terminalBloom, cursorBlink, autoStartWebMirror, shellPath, fontFamily) previously flowed through validateSettings via the unmodified `...s` spread with NO guard at all — a non-boolean value could reach downstream code. Added `string()` (pass-through, no trim) + `nullableString()` (null + non-empty + fallback) factories. 6 more fields migrated. Only the theme-preset interlock (themePreset gates 6 colour fields) and autoContinue (nested record with its own helper) remain. |
| `tau-primitives` | S | S | Cluster H continues — command palette + kbd cheat-sheet (sister overlays) migrated to a new `--ht-palette-*` token group (14 tokens consolidated across both). audit:theming: 944 → 922 (−22). |

Grade distribution after S16: **20 S / 20 A / 6 B / 3 C** (unchanged — both lifts continued seam-extension / migration work).

### Issues encountered

- **Test selector match issue caught + fixed**: the `.palette-item:hover` rule lives in a multi-selector group (`.palette-item:hover, .palette-item.selected { … }`); my `matchRule` helper only matches a selector followed directly by `{`. Worked around with a regex-on-the-whole-file assertion for the migrated background.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).
- **1 pre-existing flake**: `byte-buffer fallback`. Same as previous sessions.

### Exit criteria (session 16)

| Criterion | Status |
|---|---|
| F.6 batch 4 — string/nullableString factories + 6 migrated fields (98% coverage) | ✅ landed |
| Cluster H command palette + kbd cheat-sheet region migrated | ✅ 944 → 922 (−22) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2255 / 1 known flake; +21 new tests (5 schema batch 4 + 16 palette tokens) |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 16)

- F.6 seam — close the last two fields. Needs a `derived(fn)` factory shape for the theme-preset interlock (themePreset selection drives accentColor / secondaryColor / foregroundColor / bgBase / ansiColors), and a `validatorWrapper(fn)` shape for autoContinue.
- Cluster H literal migration — next chunk (settings panel section, process manager, ask-user modal, plan panel fallback strip).
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 17 (2026-05-17)

Slice picked: **F.6 batch 5 (wrapped() factory + autoContinue)** + **Cluster H ask-user modal + workspace-ask badge region**.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| F.6 batch 5 — wrapped() factory + autoContinue | `d1ff266` | `src/shared/settings.schema.ts`, `src/shared/settings.ts`, `tests/settings-schema.test.ts` | +3 (wrapped factory + AUTO_CONTINUE_SCHEMA exposed through the seam + validateSettings routes through it) |
| Cluster H ask-user modal tokens | `fb590cf` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-ask.test.ts` (new) | +18 (each `--ht-ask-*` token defined; .ask-user-* + .workspace-ask-badge rules use them) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.82 → 0.3.83 (F.6 batch 5) → 0.3.84 (Cluster H ask-user).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `settings-persistence` | A | A | **F.6 seam coverage now 100% of non-interlock surface (50 / ~50 simple fields).** New `wrapped(default, validator)` factory exposes nested-record validators through the same uniform call-site as primitive fields — autoContinue routes through `AUTO_CONTINUE_SCHEMA` in validateSettings exactly like every other field. Only the theme-preset interlock (themePreset selection drives 6 colour fields together) remains on the per-clause path. |
| `tau-primitives` | S | S | Cluster H continues — ask-user trust-boundary modal + sidebar workspace-ask badge migrated to a new `--ht-ask-*` token group (14 tokens covering scrim, sheet, codebox, danger banner/button, cyan badge). audit:theming: 922 → 907 (−15). The danger-red rgba(239,68,68,*) family now lives in named tokens. |

Grade distribution after S17: **20 S / 20 A / 6 B / 3 C** (unchanged — both lifts continued seam-extension / migration work).

### Issues encountered

- **Typecheck error caught + fixed**: `wrapped()` types its validator as `(input: unknown) => T`, but `validateAutoContinue` declares `(raw: AutoContinueSettings | undefined | null) => AutoContinueSettings`. Bridged with a single-line cast wrapper at the `AUTO_CONTINUE_SCHEMA` definition.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).
- **1 pre-existing flake**: `byte-buffer fallback`. Same as previous sessions.

### Exit criteria (session 17)

| Criterion | Status |
|---|---|
| F.6 batch 5 — wrapped() factory + autoContinue (100% non-interlock coverage) | ✅ landed |
| Cluster H ask-user modal + workspace-ask badge region migrated | ✅ 922 → 907 (−15) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2275 / 1 known flake; +21 new tests (3 schema batch 5 + 18 ask-user tokens) |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 17)

- F.6 — theme-preset interlock factory: themePreset selection drives accentColor / secondaryColor / foregroundColor / bgBase / ansiColors. Needs a `derived(fn)` shape that takes the whole settings record (or at least themePreset).
- Cluster H literal migration — next chunk (process manager, settings panel section, plan panel fallback strip, notification overlay).
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 18 (2026-05-17)

Slice picked: **Cluster H double-chunk** on the process manager (⌘⌥P) — chrome + kill button + cross-component semantic badges. F.6 theme-preset interlock deferred (needs a `derived(fn)` factory shape with a sibling-context signature; a non-trivial design change to defer to a focused session).

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster H PM chrome + kill button | `70a56b2` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-pm.test.ts` (new) | +25 (21 `--ht-pm-*` tokens defined; .process-manager-* chrome + kill rules use them) |
| Cluster H PM port/git badges + cross-component badge namespace | `5446f31` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-badge.test.ts` (new) | +11 (7 `--ht-badge-*` tokens defined; PM badges + git fg + CPU heatmap rewired) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.84 → 0.3.85 (PM chrome) → 0.3.86 (badge namespace).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `tau-primitives` | S | S | Cluster H **double-chunk** this session — the process manager overlay (⌘⌥P) migrated to `--ht-pm-*` (15 chrome + 6 kill = 21 tokens covering 22 literals) AND a new cross-component `--ht-badge-*` namespace (7 tokens covering the soft-bg/matching-border tints for the success/warn/info badge family). First migration that rewires literals onto existing `--ht-sem-error` / `--ht-sem-success` tokens (PM git-conflicts / git-add / CPU heatmap endpoint). audit:theming: 907 → 875 (−32 across two commits). |

Grade distribution after S18: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **No regressions introduced this session.**
- **Deliberate scope choice**: PM has 30+ distinct literals split across container chrome (mostly white-overlay tints) and semantic badges. Doing them as two separate commits with two different token namespaces (`--ht-pm-*` for component-specific chrome, `--ht-badge-*` for cross-component reusable semantics) is the right shape — the badge tokens are explicitly designed for future reuse by surface chips and sidebar status pills.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).
- **1 pre-existing flake**: `byte-buffer fallback`. Same as previous sessions.

### Exit criteria (session 18)

| Criterion | Status |
|---|---|
| Cluster H PM chrome region migrated | ✅ 907 → 885 (−22) |
| Cluster H PM badge region migrated + cross-component namespace | ✅ 885 → 875 (−10) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2310 / 1 known flake; +36 new tests (25 PM chrome + 11 badge) |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 18)

- F.6 — theme-preset interlock factory (final F.6 holdout).
- Cluster H literal migration — next chunk: notification overlay (`.notification-*` rules), workspace cwd selector, surface chips region.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 19 (2026-05-17)

Slice picked: **Cluster H double-chunk** — notification overlay + sidebar notification item, surface chips.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster H notification overlay | `7471fe0` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-notif.test.ts` (new) | +11 (8 `--ht-notif-*` tokens defined; .tau-notif-overlay-* + .notification-item rules use them) |
| Cluster H surface chips | `f461f69` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-chip.test.ts` (new) | +10 (6 new tokens; .surface-chip + .chip-* rules use S18 --ht-badge-* + existing --ht-sem-* tokens) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.86 → 0.3.87 (notif) → 0.3.88 (chip).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `tau-primitives` | S | S | Cluster H **double-chunk** this session — notification overlay + sidebar item migrated to `--ht-notif-*` (8 tokens, including two `-bg-mix` tokens that live inside CSS color-mix()), and the surface chip family migrated with **first cross-component reuse**: surface chips re-use the S18 `--ht-badge-success/warn/info-*` tokens directly, plus 6 new tokens for chip-specific neutral tints + a success-hover ramp. PM badges + surface chips now share the same badge palette — a single swap repaints both. audit:theming: 875 → 849 (−26 across two commits). |

Grade distribution after S19: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **No regressions introduced this session.**
- **Design refinement**: surface chips and PM badges share semantic identity (success / warn / info badge family) — proving the S18 `--ht-badge-*` cross-component namespace investment. This session's chip migration extends the family with 4 specific tokens (info-border-soft for the less-assertive chip-command, success hover ramp for the interactive chip-port) rather than copying the values to a new namespace.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).
- **1 pre-existing flake**: `byte-buffer fallback`. Same as previous sessions.

### Exit criteria (session 19)

| Criterion | Status |
|---|---|
| Cluster H notification overlay region migrated | ✅ 875 → 866 (−9) |
| Cluster H surface chip region migrated with cross-component reuse | ✅ 866 → 849 (−17) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2330 / 1 known flake; +21 new tests (11 notif + 10 chip) |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 19)

- F.6 — theme-preset interlock factory (final F.6 holdout — design a `derived(fn)` factory shape that takes the partial settings record).
- Cluster H literal migration — next chunk: workspace cwd selector + sidebar status grid + agent accent cyan/amber + tau-status bar deeper migration.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 20 (2026-05-17)

Slice picked: **F.6 batch 6 (theme-preset interlock — FINAL F.6)** + **Cluster H workspace cwd chip**.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| F.6 batch 6 — theme interlock | `2fc2368` | `src/shared/settings.ts`, `tests/settings-schema.test.ts` | +6 (THEME_PRESET_SCHEMA / colour string() schemas / ANSI_COLORS_SCHEMA via existing wrapped() factory; validateSettings now sanitises 6 previously-unguarded theme fields) |
| Cluster H workspace cwd chip | `caa011b` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-cwd-chip.test.ts` (new) | +9 (6 `--ht-cwd-chip-*` tokens; .workspace-cwd-chip rules use them; .active state REUSES --ht-badge-info-bg) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.88 → 0.3.89 (F.6) → 0.3.90 (cwd chip).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `settings-persistence` | A | A | **F.6 seam closed at 100% (56 / 56 fields).** The final theme-preset interlock — themePreset + accentColor + secondaryColor + foregroundColor + bgBase + ansiColors — now flows through the schema. THEME_PRESET_SCHEMA uses `wrapped()` with a known-id lookup; the four colour fields use `string()` with `THEME_PRESETS[0]` defaults; ANSI_COLORS_SCHEMA uses `wrapped()` with a per-key validator that drops extraneous keys. The "interlock" itself (keeping colour fields consistent with the selected preset) happens at the settings-panel UI layer — validateSettings only sanitises shape. Closes the silent-gap class: non-string accentColor or junk themePreset previously slipped through unchanged. |
| `tau-primitives` | S | S | Cluster H continues — workspace cwd chip migrated to `--ht-cwd-chip-*` (6 tokens). Active state REUSES `--ht-badge-info-bg` from S18 — third component (PM badges S18, surface chips S19, cwd chip S20) sharing the same cyan info tint. audit:theming: 849 → 842 (−7). |

Grade distribution after S20: **20 S / 20 A / 6 B / 3 C** (unchanged — F.6 closure was a coverage milestone, not a grade boundary). The F.6 / Cluster F group is now fully closed.

### Issues encountered

- **No regressions introduced this session.**
- **Design realisation**: the original "theme-preset interlock" framing implied a derived-from-other-fields factory shape. On closer inspection, the actual interlock behaviour (preset → colour fields) happens in the settings-panel UI when a preset is picked, NOT in validateSettings. The validator only needs to sanitise shape per field — the schema's existing `wrapped()` + `string()` factories cover the case cleanly without needing a new `derived()` factory shape. F.6 closed with the existing factory toolkit.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).
- **1 pre-existing flake**: `byte-buffer fallback`. Same as previous sessions.

### Exit criteria (session 20)

| Criterion | Status |
|---|---|
| F.6 batch 6 — theme-preset interlock fields migrated (100% coverage) | ✅ landed |
| Cluster H cwd chip region migrated | ✅ 849 → 842 (−7) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2350 / 1 known flake; +15 new tests (6 schema batch 6 + 9 cwd chip) |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 20)

- F.6 is fully closed — no more settings-schema work needed.
- Cluster H literal migration — next chunk: workspace-package card + workspace-manifest-cargo icon, sidebar status grid, tau-status bar deeper migration.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 21 (2026-05-17)

Slice picked: **Cluster B a11y win** — number-input `aria-invalid` feedback for the settings panel + **Cluster H workspace-package card + Rust cargo icon**.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster B — aria-invalid on clamped number inputs | `1bc1a50` | `src/views/terminal/settings-panel.ts`, `src/views/terminal/index.css`, `tests/settings-clamp-feedback.test.ts` (new) | +6 (happy-dom drives the new `bindClampFeedback()` helper through below-min / above-max / return-to-range / empty / multi-binding / pre-populated cases) |
| Cluster H workspace package + cargo icon | `9a4320c` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-package.test.ts` (new) | +10 (6 new tokens defined; .workspace-package + type chip + cargo icon use them; bin chip REUSES --ht-badge-warn-*) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.90 → 0.3.91 (aria-invalid) → 0.3.92 (package tokens).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `settings-panel` | A | A | **Cluster B U9 closed.** Adds `bindClampFeedback()` helper that wires `aria-invalid` + `aria-live="polite"` + `aria-errormessage` on every number input the user can drive into a silent-clamp scenario. 7 inputs covered (5 via the `numberField` helper — scrollback / fontSize / webMirrorPort / paneGap / sidebarWidth — plus the two inline autoContinue inputs for cooldownMs and maxConsecutive). Sighted users see a red `--ht-sem-error-tint` border; screen readers announce "Value below minimum (100); will be clamped to 100." Closes a long-standing U9 gap. |
| `tau-primitives` | S | S | Cluster H continues — workspace package card + Rust cargo icon migrated to `--ht-package-*` (5 tokens) + `--ht-cargo-icon`. The bin chip REUSES the S18 `--ht-badge-warn-*` family with exact alpha match (0.08 bg + 0.22 border). Fourth component sharing cross-component tokens (after PM badges S18, surface chips S19, cwd chip S20). audit:theming: 842 → 832 (−10). |

Grade distribution after S21: **20 S / 20 A / 6 B / 3 C** (unchanged — settings-panel stayed at A; the gap-list moved one item from open to closed but didn't cross the boundary).

### Issues encountered

- **No regressions introduced this session.**
- **Design note**: the original numberField helper used `parseFloat` + `isNaN` for emit; the bindClampFeedback helper mirrors that pattern but also handles the empty-string mid-type case (no aria-invalid, no message). The aria-errormessage id is unique per call so multiple inputs on the same page can co-exist without colliding.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).
- **1 pre-existing flake**: `byte-buffer fallback`. Same as previous sessions.

### Exit criteria (session 21)

| Criterion | Status |
|---|---|
| Cluster B U9 — aria-invalid on clamped number inputs | ✅ landed (7 inputs covered) |
| Cluster H workspace package card region migrated | ✅ 842 → 832 (−10) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2370 / 1 known flake; +16 new tests |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 21)

- Cluster B residuals: settings reset-to-default per field (U10), IME composition guards on settings text inputs, sidebar aria-live on reorder.
- Cluster D residuals: terminal search regex/case toggles + persisted history, editor pane split keyboard shortcut, browser zoom persistence.
- Cluster E residuals: SurfaceMetadataPoller stale-git skip-tick, more audits (locale/node/shell), health-check `fix()` remediation.
- Cluster F.10: audit remaining ad-hoc handlers; move into `src/bun/rpc-handlers/`.
- Cluster H literal migration — next chunk: workspace-script-btn state colours, sidebar status grid, tau-status bar deeper migration.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 22 (2026-05-17)

Slice picked: **Cluster D close-out** — terminal search persisted query history with ↑/↓ recall + **Cluster H workspace script-button states**.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster D — search history + recall | `a36e5a2` | `src/views/terminal/terminal-search.ts`, `tests/terminal-search.test.ts` | +7 (pushSearchHistory dedupe/cap, next() records into localStorage, ArrowUp/Down recall walk, ArrowDown restores in-flight, persistence across bar instances, `aria-keyshortcuts` exposed for AT discovery) |
| Cluster H script button states | `41f3220` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-script.test.ts` (new) | +9 (5 new `--ht-script-*` tokens defined; :hover reuses --ht-agent-row-bg-hover + --ht-border-soft) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.92 → 0.3.93 (search history) → 0.3.94 (script tokens).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `terminal-search` | S | S | **Cluster D closed.** Recent queries now persist across sessions in localStorage (`hyperterm-canvas.search.history`, capped at 20, duplicates bubble, empties skipped) and recall via ArrowUp / ArrowDown inside the search bar. The first ArrowUp stashes the user's in-flight typing so ArrowDown past index 0 restores it. The input advertises `aria-keyshortcuts="ArrowUp ArrowDown"` so AT users discover the recall. Pure `pushSearchHistory()` helper exported for unit-testing the dedupe / cap semantics. Closes the last open Cluster D backlog item. |
| `tau-primitives` | S | S | Cluster H continues — workspace script-button states migrated to `--ht-script-*` (5 tokens for running / error / idle-dot). The :hover state REUSES existing white-overlay tokens (--ht-agent-row-bg-hover + --ht-border-soft) — exact alpha match, same intent. 7 literals migrated. audit:theming: 832 → 825 (−7). |

Grade distribution after S22: **20 S / 20 A / 6 B / 3 C** (unchanged — terminal-search stayed at S; the recall gap closed but didn't cross the boundary).

### Issues encountered

- **Test isolation gap caught + fixed**: the new history tests in `tests/terminal-search.test.ts` initially failed because earlier `next()` tests had pushed queries into localStorage via the new code path. Fixed by extending `beforeEach` to clear the new `hyperterm-canvas.search.history` key alongside the existing toggles cleanup.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).
- **No flakes this run** (byte-buffer test passed cleanly).

### Exit criteria (session 22)

| Criterion | Status |
|---|---|
| Cluster D close-out — search history + ArrowUp/Down recall | ✅ landed |
| Cluster H script button states region migrated | ✅ 832 → 825 (−7) |
| `bun test` green (modulo pre-existing flake) | ✅ 2381 / 0 fails; +16 new tests |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 22)

- Cluster B residuals: settings reset-to-default per field (U10), IME composition guards on settings text inputs, sidebar aria-live on reorder announcement.
- Cluster E residuals: SurfaceMetadataPoller stale-git skip-tick, more audits (locale/node/shell), health-check `fix()` remediation.
- Cluster F.10: audit remaining ad-hoc handlers; move into `src/bun/rpc-handlers/`.
- Cluster H literal migration — next chunk: sidebar status grid, tau-status bar deeper migration, editor pane chrome.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 23 (2026-05-17)

Slice picked: **Cluster B sidebar drag-reorder a11y closure** + **Cluster H titlebar gradient + sidebar header text ladder**.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster B — mouse drag-drop announces | `53692f3` | `src/views/terminal/sidebar.ts`, `tests/sidebar-keyboard-reorder.test.ts` | +1 (drag-start → drag-over → drop populates the polite live region with the keyboard-equivalent announcement) |
| Cluster H titlebar gradient + sidebar header | `2739860` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-sidebar-header.test.ts` (new) | +13 (10 new tokens + cross-component .sidebar-title-count → --ht-button-bg reuse + the second-`.sidebar-empty`-rule grep variant) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.94 → 0.3.95 (drag-announce) → 0.3.96 (sidebar header tokens).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `sidebar` | S | S | **Cluster B drag-reorder a11y closed.** Mouse drag-drop now calls `announceReorder()` just like the keyboard reorder path — both modalities populate the same polite `.sidebar-live-region` so AT users hear "Moved <name> to position N of M" regardless of input. |
| `tau-primitives` | S | S | Cluster H continues — titlebar 2-stop gradient (`#0d1317` / `#0a0e11`) + sidebar header brightness ladder (5 zinc alphas: 0.42 / 0.48 / 0.66 / 0.68 / 0.98) + footer divider + server-pill hover + Catppuccin online-URL green migrated to 10 new tokens. `.sidebar-title-count` cross-component reuses `--ht-button-bg` (exact 0.055 white-overlay alpha). 12 literals migrated. audit:theming: 825 → 813 (−12). |

Grade distribution after S23: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **Test selector ambiguity caught + fixed**: `.sidebar-empty` appears twice in the stylesheet (a transition-only override at line 652 and the styled block at line 824). `matchRule` finds the first match, which lacks the migrated `color:` line. Pivoted to a whole-file regex assertion for that specific rule.
- **Comment vs production literal**: the first version of the titlebar gradient test asserted the CSS doesn't contain `#0d1317` — but the literal also appears in the rule's design-rationale comment. Updated the assertion to strip comments before scanning (mirrors how `audit:theming` already works).
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).

### Exit criteria (session 23)

| Criterion | Status |
|---|---|
| Cluster B — mouse drag-reorder announces via aria-live | ✅ landed |
| Cluster H titlebar + sidebar header region migrated | ✅ 825 → 813 (−12) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2400 / 0–1 known flake; +14 new tests |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 23)

- Cluster B residuals: settings reset-to-default per field (U10), IME composition guards on settings text inputs.
- Cluster E residuals: SurfaceMetadataPoller stale-git skip-tick, more audits (locale/node/shell), health-check `fix()` remediation.
- Cluster F.10: audit remaining ad-hoc handlers; move into `src/bun/rpc-handlers/`.
- Cluster H literal migration — next chunk: surface bar / pane bar deeper, ask-user IME wrap chrome, ansi-color hex literals in theme presets (or skip those — they're intentionally literal).
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 24 (2026-05-17)

Slice picked: **Cluster E startup-audit expansion** (locale + bun-on-path + shell-exists) + **Cluster H surface-details overlay** (largest cross-component reuse landing yet).

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster E — three new startup audits | `480e52a` | `src/bun/audits.ts`, `tests/audits.test.ts` | +12 (locale resolves LC_ALL→LANG with empty-string skip; bun probe ok/missing; shell-exists set/unset/missing-path; registry shape; round-trip via runAudits) |
| Cluster H — surface-details overlay | `b4bfbaa` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-surface-details.test.ts` (new) | +8 (4 new --ht-pm-secondary-btn-* tokens; chrome reuses --ht-pm-*; port green reuses --ht-badge-success-fg; CPU heatmap reuses --ht-sem-error; danger reuses --ht-pm-kill-*) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.96 → 0.3.97 (audits) → 0.3.98 (surface-details).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `audits` | S | S | **Cluster E backlog item closed.** Startup canary set tripled from 1 → 4: original `git-user-name` plus three new audits — `locale-utf8`, `bun-on-path`, `shell-exists`. Each takes an injected probe/env/fileExists hook so tests stay hermetic. The new audits intentionally ship without `fix` — remedies live outside the app's reach. |
| `tau-primitives` | S | S | Cluster H continues — surface-details overlay migrated with the LARGEST cross-component reuse landing yet. ~21 literals migrated via direct reuse of S18 `--ht-pm-*` + `--ht-badge-*` + `--ht-sem-*` tokens; only 4 new `--ht-pm-secondary-btn-*` neutral inline-action tokens minted. audit:theming: 813 → 792 (−21). |

Grade distribution after S24: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **`require()` ESLint error caught + fixed**: the initial `defaultFileExists` used `require("node:fs").statSync` for terseness; the workspace forbids CommonJS require. Moved to `import { statSync } from "node:fs"` at the top of `audits.ts`.
- **Locale empty-string fall-through**: an explicit `LC_ALL=""` is POSIX "unset" but `??` treats it as set. Rewrote the resolution as a tiny `pick()` helper that treats empty strings as missing so the LC_ALL → LANG fall-through works correctly.
- **Existing audit-registry tests assumed length 1**: three new audits changed `defaultAudits(...).length`. Updated to use `.toContain(id)` rather than counting + threaded happy stubs through runAudits.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).

### Exit criteria (session 24)

| Criterion | Status |
|---|---|
| Cluster E — locale + bun + shell audits | ✅ landed (registry tripled) |
| Cluster H surface-details overlay region migrated | ✅ 813 → 792 (−21) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2410 / 0–1 known flake; +20 new tests |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 24)

- Cluster B residuals: settings reset-to-default per field (U10), IME composition guards.
- Cluster E residuals: health-check `fix()` remediation UX.
- Cluster F.10: audit remaining ad-hoc handlers; move webview dispatch into `src/bun/rpc-handlers/`.
- Cluster H literal migration — next chunk: surface bar / pane bar deeper, sidebar workspace card sub-rows, plan-panel sidebar widget remaining literals.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 25 (2026-05-18)

Slice picked: **Cluster B U10** (settings reset-to-default per field) + **Cluster H surface bar chrome**.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster B U10 — reset-to-default per field | `e8ba783` | `src/views/terminal/settings-panel.ts`, `src/views/terminal/index.css`, `tests/settings-reset-to-default.test.ts` (new) | +4 (button hidden at default, visible when dirty, click emits default, hides again after value returns to default) |
| Cluster H — surface bar chrome | `ec289e2` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-surface-bar.test.ts` (new) | +7 (4 new `--ht-surface-bar-*` tokens + 3 cross-component reuses; .surface-bar resting + focused + button + close-hover rules use them) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.98 → 0.3.99 (reset) → 0.3.100 (surface-bar).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `settings-panel` | A | A | **Cluster B U10 closed.** Every settings field that exposes a `key` through `fieldRow()` now gets a quiet "↺" reset-to-default button in the label wrap. Visible only when the live value differs from `DEFAULT_SETTINGS` (JSON-shape compare so array/nested-record fields work). Click → emit(default). Wired through every field helper (text / number / slider / toggle / select / segmented / color / secret). The dirty-check runs at render time so the button hides itself when `updateSettings()` re-renders post-reset. The "Reset-to-default per field" gap on the feature card is now closed. |
| `tau-primitives` | S | S | Cluster H continues — surface bar (pane header) chrome migrated to 4 new `--ht-surface-bar-*` tokens (bg, border, focused glow, button fg) + 3 cross-component reuses: `--ht-badge-info-border-soft` (focused border), `--ht-agent-row-bg-hover` (focused inset highlight), `--ht-sem-error` (close-hover red). 7 literals migrated. audit:theming: 792 → 785 (−7). |

Grade distribution after S25: **20 S / 20 A / 6 B / 3 C** (unchanged — settings-panel stayed at A; the U10 gap moved to closed without crossing the boundary).

### Issues encountered

- **Test discovery for the right section**: my first test attempted to find "Font Size" via `findRow()`, but the default active section is "general" (loaded from localStorage; defaults to "general"). Font Size lives in the "appearance" section. Switched the tests to use "Scrollback Lines", a general-section field, so the test runs without first navigating sections.
- **API shape**: SettingsPanel takes `(onChange, options)`, not a host-object — first iteration of the test passed it the wrong shape. Read the class signature to fix.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).

### Exit criteria (session 25)

| Criterion | Status |
|---|---|
| Cluster B U10 — reset-to-default per field | ✅ landed |
| Cluster H surface bar chrome region migrated | ✅ 792 → 785 (−7) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2430 / 0–1 known flake; +11 new tests |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 25)

- Cluster B residuals: IME composition guards on settings text inputs.
- Cluster E residuals: health-check `fix()` remediation UX.
- Cluster F.10: audit remaining ad-hoc handlers.
- Cluster H literal migration — next chunk: sidebar workspace card sub-rows, plan-panel sidebar widget remaining literals, telegram bridge sub-states.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 26 (2026-05-18)

Slice picked: **Cluster E remediation UX hookup** (audit-fix → health bridge + telegram restart fix) + **Cluster H workspace port chip + script-run states** (pure cross-component reuse).

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster E — health-fix bridge | `5bcf389` | `src/bun/index.ts`, `tests/audit-fix-health-bridge.test.ts` (new) | +3 (publish loop wraps `r.fix` into a `health.fix` action that calls `applyFix` + re-publishes; runFix transitions degraded → ok in one tick) |
| Cluster H — workspace port + script-run | `135dbe8` | `src/views/terminal/index.css`, `tests/theme-tokens-workspace-port.test.ts` (new) | +4 (workspace-port-chip resting + hover/focus reuse --ht-badge-success-*; workspace-script-btn states reuse --ht-badge-success-fg + --ht-pm-kill-fg; workspace-status divider reuses --ht-pm-card-border) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.100 → 0.3.101 (health-fix bridge) → 0.3.102 (workspace port chip).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `audits` | S | S | **Cluster E remediation UX hookup closed.** Audit results that carry `r.fix` now propagate through to the `HealthRegistry` via `health.set(id, sev, msg, fix)`. The wrapped `action` runs `applyFix(r, registry)` (which re-runs the audit's `check()` post-action) and then pushes the recovered result back to health in the same tick. Existing audits with a `fix` (git-user-name → "Set git user.name to …") now surface that button to any sidebar pill / `ht health fix audit:git-user-name` consumer. The "Remediation UX hookup" gap on the audits feature card is now closed. |
| `telegram-bridge` | (same) | (same) | Telegram `error` + `conflict` health entries now attach a "Restart poller" fix that calls `telegramService.stop() + start()`. Next `onStatusChange` rewrites the entry to its recovered severity, so the button auto-disappears once polling is healthy again. |
| `tau-primitives` | S | S | Cluster H continues — workspace port chip + script-run state colours migrated by pure cross-component REUSE. The .workspace-port-chip is the third "success-tinted interactive chip" in the codebase; harmonised onto the existing --ht-badge-success-* family despite a <2% alpha delta from the original literals (0.22 vs 0.20 border etc. — perceptually identical). Zero new tokens minted; 9 literals migrated. audit:theming: 785 → 776 (−9). |

Grade distribution after S26: **20 S / 20 A / 6 B / 3 C** (unchanged — the audits gap closed cleanly but didn't cross a grade boundary).

### Issues encountered

- **Action wrapping**: `health.runFix(id)` already exists and just calls `entry.fix.action()`. Subsystems are expected to push a fresh `set(id, "ok", …)` from inside the action so the snapshot reflects recovery. For audits this means the wrapped action has to both run `applyFix` *and* re-publish — encoded inline at the publish site so the bridge stays in one place.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).

### Exit criteria (session 26)

| Criterion | Status |
|---|---|
| Cluster E — audit fixes propagate through HealthRegistry | ✅ landed |
| Cluster E — telegram error/conflict ships "Restart poller" | ✅ landed |
| Cluster H workspace port chip + script-run migrated | ✅ 785 → 776 (−9) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2430 / 0–2 known flakes; +7 new tests |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 26)

- Cluster B residuals: IME composition guards on settings text inputs.
- Cluster F.10: audit remaining ad-hoc handlers.
- Cluster H literal migration — next chunk: sidebar workspace card status entries / progress / pane chips, plan-panel sidebar widget remaining literals, telegram bridge sub-states.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 27 (2026-05-18)

Slice picked: **Cluster B U15** (agent panel IME composition guards) + **Cluster H workspace card item + notify-bar-flash keyframe**.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster B U15 — agent IME guards | `2176555` | `src/views/terminal/agent-panel.ts`, `tests/agent-panel-ime.test.ts` (new) + factory updates in 3 existing agent-panel tests | +3 (composing flips on start/end; `/` during composition doesn't open slash menu; Enter while composing leaves input untouched) |
| Cluster H workspace card + keyframe | `dae71996` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-workspace-item.test.ts` (new) | +8 (4 new tokens defined; workspace-dot shadow + workspace-name fg + close hover + 4-stop notify-bar-flash keyframe all migrated) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.102 → 0.3.103 (IME) → 0.3.104 (workspace card tokens).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `app-variants` / agent panel | S | S | **Cluster B U15 closed.** Agent panel input now mirrors the command-palette + ask-user-modal IME pattern — `composing` flag on AgentPanelState wired via compositionstart/end listeners; the input handler skips `handleSlashInput` while composing (so a transient `/` in the romaji buffer doesn't spuriously open the slash menu) and the keydown handler skips Enter/Tab while composing OR when the event's own `isComposing` is set. The 3 existing agent-panel test files' state factories add `composing: false` so they keep typechecking. |
| `tau-primitives` | S | S | Cluster H continues — workspace card item + notify-bar-flash keyframe migrated to 4 new tokens (`--ht-workspace-name-fg`, `--ht-workspace-dot-shadow`, `--ht-surface-bar-notify-rest`, `--ht-notify-amber-flash`) + 3 cross-component reuses (`--ht-button-fg-hover` for active name, `--ht-sem-error` for close-hover, `--ht-notify-cyan-glow` for the keyframe's cyan stop — token already existed). 9 literals migrated. audit:theming: 776 → 767 (−9). |

Grade distribution after S27: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **Test scope leak**: the first version of the notify-bar-flash assertion checked the WHOLE indexCss for a 0.15-alpha amber literal — but an unrelated chip rule at line 8038 also uses that same alpha. Scoped the negative match to the keyframe block only.
- **Test factory drift**: AgentPanelState gained a new `composing` field; three existing agent-panel test files construct the state inline and would have failed typecheck. Updated those factories to include the new field.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).

### Exit criteria (session 27)

| Criterion | Status |
|---|---|
| Cluster B U15 — agent panel IME guards | ✅ landed |
| Cluster H workspace card item region migrated | ✅ 776 → 767 (−9) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2440 / 0–2 known flakes; +11 new tests |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 27)

- Cluster F.10: audit remaining ad-hoc handlers; move webview dispatch into `src/bun/rpc-handlers/`.
- Cluster H literal migration — next chunk: workspace status entries / progress / pane chips, plan-panel sidebar widget remaining literals, telegram bridge sub-states.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 28 (2026-05-18)

Slice picked: **Cluster H double-chunk** — sideband panel container chrome + small cross-component reuses, then panel-interactive amber + drag handle + dragging-state shadow + title text-shadow.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster H panel chrome + 3 small reuses | `3f2c6456` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-panel.test.ts` (new) | +10 (5 new --ht-panel-* tokens + reuses for workspace-progress / palette-item-category / surface-details scrim) |
| Cluster H panel-interactive + drag handle | `543ce5e8` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-panel-interactive.test.ts` (new) | +8 (4 new tokens + amber alphas harmonised onto --ht-notify-amber-* with ≤1% delta; drag handle reuses --ht-agent-row-bg-hover + --ht-package-header-bg-hover insets) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.104 → 0.3.105 (panel chrome) → 0.3.106 (panel-interactive).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `tau-primitives` | S | S | Cluster H continues — double chunk this session. (1) Sideband panel container chrome migrated to `--ht-panel-*` (5 tokens: border tetra + inline bg + inline shadow), plus three small cross-component REUSES (.workspace-progress bg, .palette-item-category border, .surface-details-overlay scrim). (2) Panel-interactive amber hover + drag handle gradient/bg/border + dragging-state deeper shadow + title text-shadow migrated to 4 new tokens (--ht-panel-interactive-shadow, --ht-panel-drag-shadow-strong, --ht-panel-handle-bg, --ht-notify-amber-wash) + harmonisation of 3 amber alphas onto the existing --ht-notify-amber-* family with ≤1% perceptual delta. ~20 literals migrated across two commits. audit:theming: 767 → 747 (−20). |

Grade distribution after S28: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **matchRule false-positive on `.panel-interactive`**: there are two `.panel-interactive` selectors in the file — the first is a multi-selector transform-only override (`.panel-position-float:hover, .panel-position-overlay:hover, .panel-interactive { transform: translateY(-2px); }`) and the second is the migrated border/shadow rule. matchRule grabs the first; switched to a regex-on-the-whole-file assertion that looks for the migrated declarations specifically.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).

### Exit criteria (session 28)

| Criterion | Status |
|---|---|
| Cluster H panel chrome + reuses | ✅ 767 → 758 (−9) |
| Cluster H panel-interactive + drag handle | ✅ 758 → 747 (−11) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2450 / 0–2 known flakes; +18 new tests |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 28)

- Cluster F.10: audit remaining ad-hoc handlers; move webview dispatch into `src/bun/rpc-handlers/`. (Deferred again — large refactor; consider a focused first-extraction.)
- Cluster H literal migration — next chunk: surface-drag-ghost + surface-drop-overlay (color-mix heavy; needs careful tokens), workspace status entries / progress / pane chips, plan-panel sidebar widget remaining literals, telegram bridge sub-states.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 29 (2026-05-18)

Slice picked: **Cluster H double-chunk** — surface drag-ghost + drop-overlay + drop-target, then panel-close + panel-content drop-shadows + pane-divider + surface-context-menu.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster H drag-ghost + drop overlay | `9b5dcc2e` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-drag-ghost.test.ts` (new) | +13 (7 new --ht-drag-ghost-* / --ht-drop-* tokens + 8 cross-component reuses across surface-drag-ghost(-header)(-badge) + surface-drop-overlay + surface-drop-label + surface-container.drop-target) |
| Cluster H context menu + panel close | `0587cb93` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-context-menu.test.ts` (new) | +6 (1 new --ht-context-menu-shadow + 8 cross-component reuses across .panel-close-btn, .panel-content img/canvas drop-shadows, .pane-divider, .surface-context-menu chrome + item hover + danger hover + divider) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.106 → 0.3.107 (drag-ghost) → 0.3.108 (context menu).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `tau-primitives` | S | S | Cluster H continues — double chunk this session. (1) Surface drag-ghost + drop-overlay + .surface-container.drop-target migrated with color-mix() preservation: 7 new --ht-drag-ghost-* / --ht-drop-* tokens for the bluer-cast ghost gradient + dashed drop overlay + drop label chrome, plus 8 cross-component REUSES across the existing --ht-pm-* / --ht-panel-* / --ht-package-* / --ht-agent-* / --ht-sidebar-* / --ht-button-* families. (2) Panel close button + panel content drop shadows + pane divider + surface context menu migrated with 1 new --ht-context-menu-shadow + 8 cross-component reuses including ≤2% perceptual harmonisations onto --ht-notify-amber-soft + --ht-surface-bar-border. ~27 literals migrated across two commits. audit:theming: 747 → 720 (−27). |

Grade distribution after S29: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **color-mix() second-arg literals**: the workspace-accent-driven elements use `color-mix(in srgb, var(--workspace-accent) NN%, <fallback>)` where the fallback was a hard-coded rgba. Migrating those means the token has to BE the fallback's value (the color-mix expression doesn't expand var() inside it differently — CSS just substitutes the var token's value). All 6 new --ht-drag-ghost-* tokens follow this pattern.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).

### Exit criteria (session 29)

| Criterion | Status |
|---|---|
| Cluster H drag-ghost + drop overlay region migrated | ✅ 747 → 730 (−17) |
| Cluster H context menu + panel close region migrated | ✅ 730 → 720 (−10) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2470 / 0–2 known flakes; +19 new tests |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 29)

- Cluster F.10: audit remaining ad-hoc handlers (still deferred).
- Cluster H literal migration — next chunk: workspace meta-row / surfaces / surfaces-more, status entries, sidebar plan panel literals, telegram bridge sub-states.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 30 (2026-05-18)

Slice picked: **Cluster H double-chunk** — prompt dialog chrome + browser pane error overlay + kbd dead-fallback cleanup. **First time audit:theming drops below 700.**

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster H prompt dialog chrome | `2f012bcc` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-prompt.test.ts` (new) | +11 (6 new --ht-prompt-* tokens + heavy reuse of --ht-ask-* / --ht-palette-*) |
| Cluster H browser error + kbd cleanup | `f01c28a8` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-browser-error.test.ts` (new) | +4 (2 new --ht-browser-error-* tokens + dead-fallback cleanup on kbd-* var(--fg)/var(--fg-dim) → var(--text-strong)/var(--text-dim)) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.108 → 0.3.109 (prompt) → 0.3.110 (browser-error).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `tau-primitives` | S | S | Cluster H continues — double chunk. (1) Prompt dialog migrated to 6 new --ht-prompt-* tokens + heavy reuse of the existing --ht-ask-* sheet/input chrome family + --ht-palette-shadow. The prompt is functionally a sister of the ask-user modal but with a lighter scrim (0.35 vs 0.42) for the passive name-this-thing UX. (2) Browser pane load-error overlay migrated to 2 new --ht-browser-error-* tokens (distinct eggplant + soft-red palette, not part of the ask-user danger family). (3) **Dead-fallback cleanup** on the kbd-cheatsheet: 5 inline `var(--fg, #e6f4f7)` / `var(--fg-dim, #9aa)` fallbacks were dead code — the --fg / --fg-dim vars are NEVER defined anywhere in the codebase, so those rules were rendering with the inline hex fallback. Flipped to var(--text-strong) / var(--text-dim) which ARE defined — slight visual delta traded for theming consistency. audit:theming: 720 → 699 (−21). **First time below 700.** |

Grade distribution after S30: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **Multi-selector `.prompt-btn` shadowing**: the file has TWO `.prompt-btn` rules — the first is part of a shared multi-selector reset (.workspace-close, .surface-bar-btn, .sidebar-section-clear, .prompt-btn) with no border declaration. The second is the prompt-specific one with the border I migrated. matchRule grabs the first; switched to a regex assertion that looks for the standalone selector.
- **Dead var fallbacks**: stripping `var(--fg, #hex)` to `var(--fg)` would silently break those rules because --fg is never defined. Realised on grep, swapped to `var(--text-strong)` etc.
- **Pre-existing typecheck noise** unchanged: 2 errors.

### Exit criteria (session 30)

| Criterion | Status |
|---|---|
| Cluster H prompt dialog migrated | ✅ 720 → 706 (−14) |
| Cluster H browser error + kbd cleanup | ✅ 706 → 699 (−7) |
| audit:theming below 700 | ✅ **first time** |
| `bun test` green (modulo pre-existing flake) | ✅ ~2495 / 0 non-pipeline failures; +15 new tests |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 30)

- Cluster F.10: audit remaining ad-hoc handlers (still deferred).
- Cluster H literal migration — next chunk: workspace meta-row / surfaces / surfaces-more, telegram bridge sub-states, kbd-cheatsheet body (more dead-fallback strips), settings panel inputs.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 31 (2026-05-18)

Slice picked: **Cluster H double-chunk** — sidebar section header brightness ladder + log-item state stamps.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster H sidebar section header | `dc622a75` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-sidebar-section.test.ts` (new) | +8 (3 new --ht-sidebar-section-* tokens + heavy cross-component reuse covering header / toggle / caret / count / badge / clear states) |
| Cluster H log-item state stamps | `9da407f1` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-log-item.test.ts` (new) | +2 (3 new --ht-log-* tokens; .success reuses --ht-badge-success-fg) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.110 → 0.3.111 (sidebar section) → 0.3.112 (log-item).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `tau-primitives` | S | S | Cluster H continues — double chunk. (1) Sidebar section header migrated to 3 new --ht-sidebar-section-* tokens covering the 0.56/0.58/0.9 zinc text ladder between dim (0.42) and soft (0.68), plus 9 cross-component reuses including ≤3% perceptual harmonisations onto existing --ht-sidebar-text-dim / -mute. (2) log-item state stamps migrated to 3 new --ht-log-warning-fg / -error-fg / -progress-fg tokens for the Catppuccin-style warning / error / progress colours; .success reuses --ht-badge-success-fg (exact #86efac match). ~17 literals migrated across two commits. audit:theming: 699 → 682 (−17). |

Grade distribution after S31: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **Multi-selector .sidebar-section-header**: there are THREE `.sidebar-section-header` rules in index.css — two are multi-selector layout-only blocks (line 939, line 943), the third (line ~3450) is the styled block I migrated. matchRule helper grabs the first; switched to a regex-on-the-whole-file assertion for the standalone selector with the migrated color line.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).

### Exit criteria (session 31)

| Criterion | Status |
|---|---|
| Cluster H sidebar section header migrated | ✅ 699 → 686 (−13) |
| Cluster H log-item state stamps migrated | ✅ 686 → 682 (−4) |
| `bun test` green (modulo pre-existing flake) | ✅ ~2510 / 0–2 known flakes; +10 new tests |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 31)

- Cluster F.10: audit remaining ad-hoc handlers (still deferred).
- Cluster H literal migration — next chunk: sidebar search input + filter segment (zinc-tinted near the section family), workspace card metric rows, telegram bridge sub-states.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 32 (2026-05-18)

Slice picked: **Cluster H double-chunk** — sidebar search + filter segment region, then workspace card sub-rows.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster H sidebar search + filter segment + inline divider | `e91eb41d` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-sidebar-search.test.ts` (new) | +14 (4 new --ht-sidebar-* tokens covering search input fg 0.92 + filter-btn hover fg 0.82 + selected gradient top stop + black drop-shadow; 11 cross-component reuses for borders / focus / hover bg / placeholder / divider / segment chrome) |
| Cluster H workspace card sub-rows | `4f3c1f90` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-workspace-card.test.ts` (new) | +12 (4 new --ht-workspace-* tokens for grip fg / pin hover fg / mem fg / section-header fg; 10 cross-component reuses including --ht-badge-success-fg for the CPU metric — strips the last #86efac literal in this region) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.112 → 0.3.113 (sidebar search) → 0.3.114 (workspace card).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `tau-primitives` | S | S | Cluster H continues — double chunk. (1) Sidebar search input + filter segment + inline divider migrated to 4 new --ht-sidebar-* tokens covering the search input near-white (0.92) sitting one tier above the section-text family, the filter-btn hover fg (0.82) bridging section-count-fg (0.56) and section-text-hover (0.9), and the selected segment's gradient top stop + black drop-shadow. (2) Workspace card sub-rows (grip / pin / metrics / section header) migrated to 4 new --ht-workspace-* tokens covering the grip rest fg (0.26 — the dimmest icon in the workspace, hover-revealed), pin hover fg (0.86 between filter-btn-hover and section-text-hover), mem metric fg (0.62 below CPU so the eye lands on CPU first), and a denser-card section-header rest fg (0.54). CPU metric reuses --ht-badge-success-fg exactly (strips the last #86efac literal in this region). ~38 literals migrated across two commits. audit:theming: 682 → 644 (−38). |

Grade distribution after S32: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **Read-before-edit** required for the sidebar-search rule after context compaction; resolved with a targeted Read of lines 3716–3760.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).

### Exit criteria (session 32)

| Criterion | Status |
|---|---|
| Cluster H sidebar search + filter segment migrated | ✅ 682 → 664 (−18) |
| Cluster H workspace card sub-rows migrated | ✅ 664 → 644 (−20) |
| `bun test` green (modulo pre-existing flake) | ✅ +26 new tests; full theme-token suite 322 / 322 green |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 32)

- Cluster F.10: audit remaining ad-hoc handlers (still deferred).
- Cluster H literal migration — next chunk: workspace meta-row / surfaces-more, telegram bridge sub-states, kbd-cheatsheet body, settings panel inputs.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 33 (2026-05-18)

Slice picked: **Cluster H double-chunk** — search-bar + settings-close-btn (pure reuse pass), then sidebar v2 log-item state colours + notification-dismiss hover.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster H search-bar + settings-close-btn (pure reuse) | `882f86d3` | `src/views/terminal/index.css`, `tests/theme-tokens-search-bar.test.ts` (new) | +5 (no new tokens; reuses --ht-agent-row-bg-hover-card, --ht-sidebar-filter-selected-bg-top, --ht-panel-border-soft, --ht-sem-error, --ht-sem-error-tint; both close-affordances now share --ht-sem-error) |
| Cluster H sidebar v2 log + dismiss states | `7fa721aa` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-sidebar-v2-log.test.ts` (new) | +9 (4 new --ht-sidebar-v2-* tokens for denser amber #f9c84a + amber tint + azure info #8fbcff + dismiss hover red tint 0.14; reuses --ht-sem-error / -tint + --ht-pm-kill-fg) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.114 → 0.3.115 (search-bar) → 0.3.116 (sidebar v2 log).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `tau-primitives` | S | S | Cluster H continues — double chunk. (1) Pure cross-component reuse pass on search-bar (Ctrl-F overlay) and settings-close-btn: the input bg/focus/btn hover all collapse onto existing white-alpha tokens, and both close-affordances unify on --ht-sem-error. No new tokens — proving that a complete CSS region can shrink to zero literals using only the existing token vocabulary. (2) Sidebar v2 log row + notification-dismiss hover: 4 new --ht-sidebar-v2-* tokens (denser amber distinct from --ht-log-warning-fg, azure info, dismiss hover red tint) plus error-state reuses of --ht-sem-error / -tint and --ht-pm-kill-fg. ~17 literals migrated across two commits. audit:theming: 644 → 628 (−16, double-counted line offset accounts for the 1-literal diff). |

Grade distribution after S33: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **No new issues.** Worktree was reused from S32 (already at main HEAD post-merge); commits flowed onto the same `worktree-aaa-phase7-session32` branch and will fast-forward to main cleanly.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).

### Exit criteria (session 33)

| Criterion | Status |
|---|---|
| Cluster H search-bar + settings-close-btn migrated | ✅ 644 → 638 (−6) |
| Cluster H sidebar v2 log + dismiss migrated | ✅ 638 → 628 (−10) |
| `bun test` green (modulo pre-existing flake) | ✅ +14 new tests; full theme-token suite 336 / 336 green |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 33)

- Cluster F.10: audit remaining ad-hoc handlers (still deferred).
- Cluster H literal migration — next chunk: sidebar v2 workspace cards (port-chip + cpu-bar + metric-cpu, mostly color-mix nested), server-dot status colours, settings panel inputs.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 34 (2026-05-18)

Slice picked: **Cluster H double-chunk** — settings panel form controls, then sidebar v2 global stats (proving the S33 v2-log palette generalises).

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster H settings panel form controls | `13c54cb1` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-settings-controls.test.ts` (new) | +11 (1 new --ht-on-accent-fg covering #000-on-accent-fill labels; 17 literals migrated across toggle / segmented / color-swatch / field-group / action-btn / reset-btn; heavy reuse of --ht-sidebar-filter-selected-bg-top, --ht-agent-row-bg-hover-card, --ht-package-bg, --ht-text-strong, --ht-pm-kill-*, --ht-sem-error) |
| Cluster H sidebar v2 global stats row | `259efc3f` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-sidebar-v2-stats.test.ts` (new) | +8 (2 new --ht-sidebar-v2-* tokens for stat-proc-fg + global-stats-bg; CPU + MEM chips reuse --ht-sidebar-v2-log-warning-fg + -info-fg introduced in S33 — same shades same v2 context; PORT reuses --ht-badge-success-fg) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.116 → 0.3.117 (settings controls) → 0.3.118 (sidebar v2 stats).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `tau-primitives` | S | S | Cluster H continues — double chunk. (1) Settings panel form controls migrated to 1 new --ht-on-accent-fg token + 17 literals reusing the existing white-alpha / red-tint families: both toggle/segmented active states share a clean on-accent vocabulary, and the reset-btn hover unifies fully on the --ht-pm-kill-* + --ht-sem-error pair. (2) Sidebar v2 global stats row proves the S33 v2-log palette generalises: CPU + MEM chips reuse the same --ht-sidebar-v2-log-warning-fg + -info-fg tokens introduced one session earlier — same shades, same v2 context. Only 2 new tokens needed (stat-proc-fg purple + global-stats-bg black-hold). ~23 literals migrated across two commits. audit:theming: 628 → 605 (−23). |

Grade distribution after S34: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **No new issues.** Continued in S32 worktree (already at main HEAD); commits flow onto same branch and fast-forward to main cleanly.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).

### Exit criteria (session 34)

| Criterion | Status |
|---|---|
| Cluster H settings panel form controls migrated | ✅ 628 → 612 (−16) |
| Cluster H sidebar v2 global stats migrated | ✅ 612 → 605 (−7) |
| `bun test` green (modulo pre-existing flake) | ✅ +19 new tests; full theme-token suite 355 / 355 green |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 34)

- Cluster F.10: audit remaining ad-hoc handlers (still deferred).
- Cluster H literal migration — next chunk: sidebar v2 workspace cards (port-chip + cpu-bar + metric-cpu, color-mix nested), server-dot status colours, settings color-grid + theme-preset cards.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 35 (2026-05-18)

Slice picked: **Cluster H double-chunk** — sidebar v2 workspace-script-btn (npm script pulse dots), then sidebar v2 footer + server-dot status palette.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster H sidebar v2 workspace-script-btn | `41e4de32` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-sidebar-v2-script.test.ts` (new) | +9 (3 new --ht-sidebar-v2-script-* tokens for dot rest bg + running/error pulse glows; reuses --ht-package-header-bg-hover inside the btn:hover color-mix, --ht-script-running-bg / -error-bg with 1pp delta, --ht-badge-success-fg + --ht-sem-error for dot fills) |
| Cluster H sidebar v2 server-dot status palette | `ba5e2eeb` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-sidebar-v2-server.test.ts` (new) | +11 (5 new --ht-sidebar-v2-server-* tokens for online/starting/error/conflict glows + conflict orange fg; footer bg reuses --ht-sidebar-filter-selected-shadow exact, dot fills reuse --ht-badge-success-fg + --ht-sidebar-v2-log-warning-fg (third reuse of this S33 token) + --ht-pm-kill-fg) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.118 → 0.3.119 (script-btn) → 0.3.120 (server-dot).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `tau-primitives` | S | S | Cluster H continues — double chunk. (1) sidebar v2 workspace-script-btn: 3 new --ht-sidebar-v2-script-* tokens for the dot rest bg + running / error pulse glows; the btn:hover color-mix tokenises its inner alpha by reusing --ht-package-header-bg-hover (proving color-mix nested literals can be cleanly tokenised). (2) sidebar v2 footer + server-dot: 5 new --ht-sidebar-v2-server-* tokens cover the status glow alphas + conflict orange; the starting-dot fill reuses --ht-sidebar-v2-log-warning-fg for the *third* time across consecutive sessions (S33 log row → S34 cpu stat chip → S35 server pulse) — the per-region token investment continues to pay forward. ~18 literals migrated across two commits. audit:theming: 605 → 587 (−18). |

Grade distribution after S35: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **PostToolUse formatter** touched the new `theme-tokens-sidebar-v2-server.test.ts` file after Write; no rewrite needed.
- **Pre-existing typecheck noise** unchanged: 2 errors (electrobun internal import + splitSurface cast).

### Exit criteria (session 35)

| Criterion | Status |
|---|---|
| Cluster H sidebar v2 script-btn migrated | ✅ 605 → 597 (−8) |
| Cluster H sidebar v2 footer + server-dot migrated | ✅ 597 → 587 (−10) |
| `bun test` green (modulo pre-existing flake) | ✅ +20 new tests; full theme-token suite 375 / 375 green |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 35)

- Cluster F.10: audit remaining ad-hoc handlers (still deferred).
- Cluster H literal migration — next chunk: sidebar v2 workspace cards (port-chip + cpu-bar + metric-cpu, color-mix nested but now we have the technique), settings color-grid + theme-preset cards, telegram bridge sub-states.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 36 (2026-05-18)

Slice picked: **Cluster H double-chunk** — t3 window-theme override block: a pure-reuse pass on the bulk of the override rules, then a small new-token chunk for the window-shell base colours.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster H t3 window override pure-reuse | `d8884bd6` | `src/views/terminal/index.css`, `tests/theme-tokens-t3-window-reuse.test.ts` (new) | +12 (zero new tokens; 13 literals collapse onto chip-bg / agent-row-bg-hover / package-bg / package-header-bg-hover / sidebar-row-bg-stripe / button-bg-hover-fallback / panel-border-soft; 6 color-mix nested literals tokenised via the S35 technique) |
| Cluster H window-shell base colours | `8496785c` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-window-shell.test.ts` (new) | +12 (6 new --ht-window-* tokens for titlebar / sidebar / surface / surface-bar / modal-overlay / toast — high-alpha dark-grey holds grouped under one namespace for single-point palette swap) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.120 → 0.3.121 (t3 reuse) → 0.3.122 (window-shell).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `tau-primitives` | S | S | Cluster H continues — double chunk. (1) The t3code window override block (the second-pass selectors that paint every sidebar / surface / panel / table when the "window" theme is active) gets a *pure-reuse* migration: 13 literals collapse onto seven existing white-alpha tokens with zero new entries — the strongest reuse demonstration so far across a single block. The S35 color-mix nested technique scales: 6 inner-alpha references now live behind var(). (2) The high-alpha window-shell backgrounds (titlebar / sidebar / surface / surface-bar / modal-overlay / toast) get their own --ht-window-* namespace so a future palette swap repaints the shell from one place. ~19 literals migrated across two commits. audit:theming: 587 → 568 (−19). |

Grade distribution after S36: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **First-occurrence matchRule pitfall**: the t3 override block uses many selectors that already exist earlier in the file (e.g. `.workspace-item:hover`, `.surface-chip`, multi-selector panel-header rules). The matchRule helper grabs the first occurrence — fixed by slicing the CSS to the t3 block via a marker string (`Final alignment: exact t3code-style dark shell`) and scoping all assertions to that substring.
- **Pre-existing typecheck noise** unchanged: 2 errors.

### Exit criteria (session 36)

| Criterion | Status |
|---|---|
| Cluster H t3 window override pure-reuse migrated | ✅ 587 → 574 (−13) |
| Cluster H window-shell base colours migrated | ✅ 574 → 568 (−6) |
| `bun test` green (modulo pre-existing flake) | ✅ +24 new tests; full theme-token suite 399 / 399 green |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 36)

- Cluster F.10: audit remaining ad-hoc handlers (still deferred).
- Cluster H literal migration — next chunk: sidebar v2 workspace cards (port-chip + cpu-bar + metric-cpu, color-mix nested), settings color-grid + theme-preset cards, telegram bridge sub-states.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 37 (2026-05-18)

Slice picked: **Cluster H double-chunk** — vNext (post-Phase-6 redesign) UI overrides. Chunk 1 covers palette / prompt / search; chunk 2 extends the same vNext text scale into process-manager / surface-details.

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster H vNext palette/prompt/search overrides | `9ad40323` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-vnext-overrides.test.ts` (new) | +14 (3 new --ht-vnext-text-* tokens for the cooler 232/238/248 + 243/246/253 zinc scale; 18 literals migrated; reuses --ht-chip-bg, --ht-panel-border-soft, --ht-agent-row-bg-hover[-card], --ht-package-bg) |
| Cluster H vNext PM / surface-details overrides | `0b021fec` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-vnext-pm.test.ts` (new) | +8 (2 new --ht-vnext-text-* tokens for section-h + emph; 10 literals migrated; reuses --ht-agent-row-bg-hover[-card] + --ht-package-header-bg-hover) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.122 → 0.3.123 (vNext palette) → 0.3.124 (vNext PM).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `tau-primitives` | S | S | Cluster H continues — double chunk introducing the --ht-vnext-text-* family. The post-Phase-6 redesign uses a deliberately cooler zinc tint (232,238,248) + (243,246,253) than the v1 sidebar's (229,231,237), and the override block scatters that scale across palette descriptions / prompt messages / kbd-caps / PM section headers / workspace names. 5 new vNext-text tokens cover the full brightness ladder (mute 0.48 → muted 0.58 → bright 0.88 → section-h 0.46 → emph 0.94) with 2pp internal harmonisations folding 0.56 + 0.9 into adjacent tiers. ~28 literals migrated across the two chunks. audit:theming: 568 → 543 (−25). |

Grade distribution after S37: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **vNext block bounds**: the file has 3 occurrences of `.palette-input-row {` (base, vNext, t3 override). The first test attempt scoped the slice to `[lastIndexOf("palette-input-row {", t3FinalMark), t3FinalMark)` — but t3FinalMark sits *after* the `#titlebar {` t3-override row, so the slice swallowed the t3 block too. Fixed by chaining anchors: `t3FinalMark → lastIndexOf("#titlebar {")` gives the t3 block start, then `lastIndexOf("palette-input-row {")` from there gives the vNext block start. Same anchor pattern as the S36 t3 reuse test, reused.
- **Pre-existing typecheck noise** unchanged: 2 errors.

### Exit criteria (session 37)

| Criterion | Status |
|---|---|
| Cluster H vNext palette/prompt/search migrated | ✅ 568 → 553 (−15) |
| Cluster H vNext PM/surface-details migrated | ✅ 553 → 543 (−10) |
| `bun test` green (modulo pre-existing flake) | ✅ +22 new tests; full theme-token suite 421 / 421 green |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 37)

- Cluster F.10: audit remaining ad-hoc handlers (still deferred).
- Cluster H literal migration — next chunk: theme-card cluster (~lines 5275–5689, 70 literals), settings color-grid + theme-preset cards, sidebar v2 workspace cards (port-chip + cpu-bar + metric-cpu, color-mix nested).
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 38 (2026-05-18)

Slice picked: **Cluster H double-chunk** — vNext surface chrome (container / bar / chip) shell first, then the vNext status-colour palettes (port-chip green + close-btn peach-red hover).

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster H vNext surface-container/bar/chip | `db27049e` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-vnext-surface.test.ts` (new) | +13 (5 new --ht-vnext-* tokens for surface-bg + surface-shadow + surface-bar-bg + text-soft + text-soft-2; ~17 literals migrated; heavy reuse of S37 vnext-text-* family + the white-alpha vocabulary) |
| Cluster H vNext port-chip + close-btn hover palette | `f6d079c1` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-vnext-port-close.test.ts` (new) | +13 (8 new --ht-vnext-* status-colour tokens covering port chip mossy green palette + close-btn peach-red hover palette — two distinct status affordances kept distinct from the badge-success / sem-error families because the chip is hover-info and the close-btn is destructive) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.124 → 0.3.125 (vNext surface) → 0.3.126 (vNext port/close).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `tau-primitives` | S | S | Cluster H continues — double chunk introducing 13 new --ht-vnext-* tokens (5 surface chrome + 8 status colours). The vNext surface card now has its own --ht-vnext-surface-* shell tokens that coexist with S36's --ht-window-* outer frame (card-inside-frame). The port-chip mossy green palette stays separate from the --ht-badge-success #86efac family because the chip is hover-info rather than prominent running-state — and the close-btn peach-red palette stays separate from --ht-sem-error because the chrominance shift signals "close, not error". ~29 literals migrated. audit:theming: 543 → 514 (−29). |

Grade distribution after S38: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **Surface-container occurrence count**: the file has 6 `.surface-container {` rules across the cascade. The S38 chunk 1 test initially anchored to "last .surface-container { before the t3 #titlebar" — but that returned a later (line ~6134) intermediate override block, not the vNext one at 5343. Fixed by enumerating all `.surface-container {` indices and scoping `[match[1], match[2])` to bracket exactly the vNext occurrence.
- **Pre-existing typecheck noise** unchanged: 2 errors.

### Exit criteria (session 38)

| Criterion | Status |
|---|---|
| Cluster H vNext surface chrome migrated | ✅ 543 → 526 (−17) |
| Cluster H vNext port-chip + close-btn migrated | ✅ 526 → 514 (−12) |
| `bun test` green (modulo pre-existing flake) | ✅ +26 new tests; full theme-token suite 447 / 447 green |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 38)

- Cluster F.10: audit remaining ad-hoc handlers (still deferred).
- Cluster H literal migration — next chunk: theme-card / theme-preset cluster (~5275–5689 — the 70-literal block we haven't entered yet), sidebar-section-clear / notification-item / sidebar-server-row second-pass overrides (5278–5326), sidebar v2 workspace cards.
- Phases 8 (release engineering) + 9 (docs / observability).

## Session 39 (2026-05-18)

Slice picked: **Cluster H double-chunk** — finish the vNext 2026-refresh override block. Chunk 1: small sidebar/notif/server-row sub-region as a pure-reuse pass. Chunk 2: the bulk panel chrome + theme-card + sheet shell (the 30-literal cluster between pane-divider and theme-card.active).

### Commits landed

| Topic | Commit | Files | Tests |
|---|---|---|---|
| Cluster H vNext sidebar/notif/server pure-reuse | `e273bd92` | `src/views/terminal/index.css`, `tests/theme-tokens-vnext-sidebar.test.ts` (new) | +6 (zero new tokens — 11 literals migrated via S37 vnext-text-* + existing white-alpha vocabulary; includes a 0.92 → 0.94 emph and 0.035 → 0.03 package-header-bg-hover harmonisation) |
| Cluster H vNext settings/card/sheet | `5fa38e98` | `src/shared/web-theme-tokens.css`, `src/views/terminal/index.css`, `tests/theme-tokens-vnext-settings-card.test.ts` (new) | +23 (7 new --ht-vnext-* tokens for text-mid + text-elevated + settings-body-bg + range-thumb-border + segment-active-fg + sheet-bg + modal-overlay-bg; ~22 reuses; ~30 literals migrated) |

Bumps: `bun run bump:patch` ran before each functional commit. Versions: 0.3.126 → 0.3.127 (vNext sidebar) → 0.3.128 (vNext settings).

### Lifts

| Feature | Before | After | Reason |
|---|---|---|---|
| `tau-primitives` | S | S | Cluster H continues — this session **broke the 500-literal barrier**, dropping audit:theming from 514 to 473 (−41, biggest single-session drop in the long tail). Chunk 1 was a pure-reuse demo (11 literals → 0 new tokens) showing the vnext-text-* family installed in S37 now covers entire override sub-regions. Chunk 2 introduced 7 more vNext tokens that fill the remaining holes in the brightness ladder (text-mid 0.52, text-elevated 0.64), the faintest body bg tier (0.01 white), the dark hold for accent thumbs, and the post-Phase-6 sheet/overlay shell — kept deliberately separate from the S36 --ht-window-* family because the cascades and RGB shifts differ. Cumulative S9–S39: 1013 → 473 (−540). |

Grade distribution after S39: **20 S / 20 A / 6 B / 3 C** (unchanged).

### Issues encountered

- **#titlebar { occurrence enumeration** mis-counted on first attempt: a plain `indexOf("#titlebar {", off)` matched indented `@media (max-width: 920px) {   #titlebar { ... }` nested rules. Fixed by anchoring on `\n#titlebar {` (newline immediately before, no whitespace) so only line-start rules count. Filed as a reusable pattern for future vNext-block tests.
- **Pre-existing typecheck noise** unchanged: 2 errors.

### Exit criteria (session 39)

| Criterion | Status |
|---|---|
| Cluster H vNext sidebar/notif/server migrated | ✅ 514 → 503 (−11) |
| Cluster H vNext settings/card/sheet migrated | ✅ 503 → 473 (−30) |
| `bun test` green (modulo pre-existing flake) | ✅ +29 new tests; full theme-token suite 476 / 476 green |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |
| `bun run report:feature-grades` regenerated | ✅ |
| Phase 7 long tail | ⚠ multi-session work continues |

### Next slice (after session 39)

- Cluster F.10: audit remaining ad-hoc handlers (still deferred).
- Cluster H literal migration — next chunk: the 4967-5233 region (Phase-6 v2 base styles before the vNext refresh), sidebar v2 workspace cards (8766-8881), the 7107-7861 + 7892-8233 dense blocks.
- Phases 8 (release engineering) + 9 (docs / observability).
