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
