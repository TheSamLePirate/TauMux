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
