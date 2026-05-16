# Phase 0 — Foundation & verification

**Parent plan:** `00_master_plan.md`
**Tracking doc:** `doc/tracking_feature_upgrade_to_AAA_phase0.md` (created at the start of execution).
**Status:** In progress — started 2026-05-16.
**Owner:** platform.
**Engineer-weeks:** ~1.0 (high confidence).

---

## Goal

Establish trustworthy ground truth before any new feature work begins. The triple-A programme rests on the assumption that everything claimed landed in `tracking_triple_a_analysis.md` actually works. Phase 0 verifies that assumption, backfills regression tests where they're missing, and stands up the structured grading pipeline (`bun run report:feature-grades`) so the success metric stays honest as the codebase evolves.

If Phase 0 finds regressions, those become new HIGH items and land here — no later phase starts until the baseline is solid.

---

## Steps

### Step 1 — Audit the F–J landings against the working tree

For each PR row 2–21 in `doc/tracking_triple_a_analysis.md`, verify:

1. The fix is present in the working tree (open the cited file:line refs).
2. A test in `tests/` covers the failure mode (either pre-existing or named in the PR row).
3. Reverting the fix on a scratch branch causes the test to fail.

Items to verify (mapping PR # → issue id):

| PR # | Issue id | Cited file(s) |
|---|---|---|
| 2 | G.1 L1 | `src/bun/pi-agent-manager.ts` (`_managerExit` hook), `tests/pi-agent-manager.test.ts` |
| 3 | G.5 L4 | `src/bun/socket-server.ts` |
| 4 | G.3 L6+L12 | `src/bun/index.ts` (gracefulShutdown guard + timer clears) |
| 5 | G.6+G.7 L8+L11 | `src/views/terminal/command-palette.ts` (AbortController), `src/bun/index.ts` (debounce cleanup) |
| 6 | G.4 L7 | `src/bun/atomic-write.ts`, settings/cookies/history call sites |
| 7 | G.2 L2 | `src/bun/pty-manager.ts` (SIGHUP → 500ms → SIGKILL) |
| 8 | H.1 S1 | logger / settings / cookies / history / telegram.db file modes |
| 9 | H.2 S6 | `src/bun/web/server.ts` (CSP, X-Frame-Options, nosniff, referrer-policy, permissions-policy) |
| 10 | H.6 S3+S7 | `src/bun/telegram-service.ts` (4096-char cap, chatId allow-list) |
| 11 | H.3+H.4 S4+S5 | token entropy warn, per-IP brute-force throttle |
| 12 | H.5 L3+L5 | WS `idleTimeout` + `sendPings`, client reconnect jitter |
| 13 | F.3 A13 | `src/shared/escape-html.ts` |
| 14 | F.4 A3+A17 | `SurfaceKind` shared type |
| 15 | J.1 T1 | `bun run test:coverage` + lcov |
| 17 | G.10 L13 | git/pbcopy/pbpaste timeouts |
| 18 | G.9 L14 | `telegram-db` PRAGMA busy_timeout |
| 19 | I.6 U13 | `selectWorkspaceByIndex` + ⌘1..⌘9 |
| 20 | I.11 U11 | `KeyboardCheatsheet` |
| 21 | I.2+I.3 U2+U3 | reduced-motion + prefers-contrast + forced-colors |

**Deliverable:** `doc/feature_upgrade_to_AAA/phase0_audit_matrix.md` — one row per item with columns `present?`, `tested?`, `revert-fails?`, `notes`. Items that fail any column become Step 4 work.

### Step 2 — Backfill regression tests

For every "tested?: no" item from Step 1, write a regression test that:

- Reproduces the original failure mode (asserts the bug).
- Currently passes (proves the fix is in place).
- Tagged in the test name with the issue id, e.g. `it("[L1] removes dead PiAgentInstance on exit", …)`.

If no test framework support exists for a specific failure mode (e.g. simulating a SIGKILL mid-rename), document a manual test plan in the audit matrix instead of skipping.

### Step 3 — Stand up `bun run report:feature-grades`

Goal: stop the grading doc from rotting.

1. Create `doc/feature_grades.yaml` — structured input, one entry per feature with fields:
   ```yaml
   - id: pty-session-lifecycle
     cluster: core
     name: PTY session lifecycle
     grade: B
     evidence: |
       pty-manager.ts:275-305 — SIGHUP → 500ms → SIGKILL …
     gaps:
       - Tests for failure spawns + zombie reaping.
       - Configurable grace period.
     last-graded: 2026-05-16
   ```
2. Create `scripts/build-feature-grades.ts` — reads the yaml, renders `doc/feature_grades.md` in the same layout as today (header, scale, distribution, per-cluster sections, top-10 blockers).
3. Add `package.json` script: `"report:feature-grades": "bun scripts/build-feature-grades.ts"`.
4. Add a CI check: `bun run report:feature-grades --check` exits non-zero if the rendered output drifts from the committed `.md`.

### Step 4 — Land items still missing (per master plan §P0)

From the "Items remaining" list in `tracking_triple_a_analysis.md`:

- **Cluster F (deferred):** F.1 chip-render extract, F.2 pane-layout-math extract, F.5 protocol-dispatcher narrow, F.6 settings schema, F.7 typed dispatch, F.8 typed event-bus, F.9 broadcaster, F.10 move handlers, F.11 WorkspaceCollection extract.
- **Cluster G:** G.9 prepared-statement caching (decided deferred — re-confirm or land).
- **Cluster H:** H.7 sideband CSP iframe sandbox, H.8 per-surface browser partition, H.9 session cap + manifest-auth + cross-site origin, H.10 docs, H.11 telegram parse-mode.
- **Cluster I:** I.1 modal a11y helper, I.4 semantic color tokens, I.5 phone touch + visualViewport, I.7–I.13.
- **Cluster J:** J.2–J.19 UI module test depth, bootstrap test, settings migration test, telegram offset crash, surface-metadata diff, …

**Important:** Most of these items are owned by later phases (F.* → P2 architecture; H.7 → P4 security; I.1 → P1 a11y kit; J.2+ → P3 test depth). Phase 0 does **not** land them — it lists them, confirms ownership, and updates the master-plan tracking table. The only items Phase 0 itself completes are those that don't fit a later phase cleanly.

### Step 5 — Capture baselines

Three artefacts that anchor later gates:

- `tests/baselines/coverage-baseline.lcov` — output of `bun run test:coverage`. P3 gate sets the floor at `baseline + 5pp`.
- `tests/baselines/design-report/` — snapshot of `report:design:web` artefacts. P5/P8 gate against these.
- `tests/baselines/tau-focus-audit.json` — snapshot of `tau-focus-audit.ts` output. P8 gate compares.

Each baseline file is committed; PR description must justify any change.

---

## Per-step acceptance criteria

| Step | Acceptance |
|---|---|
| 1 | `phase0_audit_matrix.md` exists with all 19 PR rows graded. Zero "untested" or "missing" rows pass into Step 5. |
| 2 | New regression tests land in `tests/`; each has the issue id in its name; `bun test` green. |
| 3 | `bun run report:feature-grades` regenerates `doc/feature_grades.md` byte-identical to the current hand-written file. `--check` mode wired into CI. |
| 4 | The master plan's "remaining items" list is updated to reflect which item is owned by which phase. |
| 5 | Three baseline files exist under `tests/baselines/` and are referenced by `package.json` scripts. |

---

## Test plan

New tests to land in this phase (named with their issue id):

- `tests/pi-agent-manager.test.ts` — `[L1] removes dead PiAgentInstance on exit` (likely already present from PR 2; verify).
- `tests/socket-server.test.ts` — `[L4] drops connection at >1MiB buffer`.
- `tests/index-shutdown.test.ts` — `[L6] re-entry of gracefulShutdown is no-op`.
- `tests/atomic-write.test.ts` — `[L7] crash mid-rename leaves previous file intact`.
- `tests/pty-manager.test.ts` — `[L2] SIGHUP delivered before SIGKILL`.
- `tests/web-server.test.ts` — `[S6] required security headers present`, `[H.4 S5] brute-force throttle returns 429`.
- `tests/telegram-service.test.ts` — `[S3] outbound text capped at 4096`, `[S7] chatId allow-list enforced`.
- `tests/web-ws.test.ts` — `[L3] idleTimeout closes half-open peer`.
- `tests/scripts/build-feature-grades.test.ts` — yaml → md rendering is deterministic.

(Tests already shipped per the tracking doc are confirmed, not re-created.)

---

## Lifts to track

Phase 0 does **not** lift any feature grade by itself. It enables every subsequent phase to lift grades with confidence. The only "movement" expected is:

- If verification finds a regression, the affected feature **drops** a grade in `feature_grades.md` until the regression is fixed. That re-grade is published via `bun run report:feature-grades` so the success metric reflects truth.

---

## Rollback

Phase 0 is non-destructive — it adds tests, a script, baselines, and an audit doc. Rollback = `git revert` of the Phase 0 commits. No production code changes are introduced in this phase (beyond test fixtures).

If `bun run report:feature-grades` proves unworkable (e.g. yaml format too rigid), revert just that step and continue with hand-edited `.md`.

---

## Open questions

1. **YAML vs. JSON for `feature_grades.yaml`?** YAML is more human-editable; JSON is more deterministic. Recommendation: YAML with a `--check` gate that runs `js-yaml` parse then re-stringify to normalise. Decide at start of Step 3.
2. **Where do baselines live?** `tests/baselines/` puts them under version control (good for blame, large diffs). `.baselines/` (gitignored, snapshot-uploaded) keeps git lean. Recommendation: `tests/baselines/` for the lcov + json (small files); `.design-artifacts/` already exists for design-report (keep as-is, but add a `tests/baselines/design-report-manifest.json` that locks the artefact set).
3. **CI provider?** Master plan §P8 punts the CI config decision. Phase 0 wires `--check` into a local script; the CI integration happens in P8. Confirm: ok to defer?
4. **Scope of Step 4 within Phase 0:** the master plan says "Phase 0 does not land them" (later phases own them). But Step 4 in this sub-plan also says Phase 0 lists/confirms ownership. Decision: Step 4 only updates docs, does not land code. Confirm.

---

## Exit criteria

Phase 0 is **complete** when:

- The audit matrix is green (no missing fixes, no untested fixes).
- `bun run report:feature-grades` is the source of truth (the .md is generated).
- Three baseline artefacts are committed.
- The "items remaining" list in `tracking_triple_a_analysis.md` has been re-distributed to the correct phase owners in the master plan tracking table.

The next phase (P1 — a11y kit) can then start with confidence.
