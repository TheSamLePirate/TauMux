# Master Plan — τ-mux to AAA across every feature

**Version baseline:** 0.3.5
**Generated:** 2026-05-16
**Branch:** main
**Inputs:** `doc/feature_grades.md` (per-feature grades), `doc/triple_a_analysis.md` (issue catalogue with `A#/L#/S#/U#/T#` ids), `doc/tracking_triple_a_analysis.md` (execution log of clusters F–J).

This is a **plan of plans**. Each phase below is a self-contained workstream that will own its own tracking doc under this directory (`doc/feature_upgrade_to_AAA/`). The master plan defines *what* and *why*; sub-plans define *how* and *who*.

---

## Goal

Move every graded feature in `feature_grades.md` to **A or S**. Current distribution: 0 S · 14 A · 20 B · 3 C · 0 D/F across 40 features. Target after full execution: ≥ 30 features at S, the remainder at A with documented justification for why S is not pursued (cost > benefit).

**Definition of done** for the whole programme:

- Every feature in `doc/feature_grades.md` re-graded; ≥ 75 % at S, 100 % at ≥ A.
- All HIGH items in `triple_a_analysis.md` either landed (per tracking doc) or explicitly deferred with a written rationale.
- A coverage gate, a design-report gate, and a τ-focus-audit gate are wired into CI and block merges.
- A `bun run report:feature-grades` command regenerates the per-feature grading from a structured input file so the grade stays honest over time (no rotting prose).

---

## Why a phased "plan of plans"

The 40 features touch the same five cross-cutting concerns (a11y, types, tests, theming, lifecycle). Going feature-by-feature would mean writing the same modal-a11y kit five times, or duplicating reduced-motion CSS across dozens of components. The phases below extract the **shared upgrade** into a single workstream, then sweep the per-feature polish only after the foundations exist. This mirrors the F→J cluster cadence already established in `tracking_triple_a_analysis.md`.

The ordering is chosen to **maximise the number of feature grades lifted per unit of work**, not by feature category. Phase numbering does not strictly imply serial execution: phases marked `║` can run in parallel with the previous phase.

---

## Phase map (high-level)

| # | Phase | Owner | Parallel? | Lifts to ≥A | Lifts to ≥S | Sub-plan file |
|---|---|---|---|---:|---:|---|
| 0 | Foundation & verification | platform | — | (regression) | — | `01_phase0_foundation.md` |
| 1 | A11y kit (modal + reduced-motion + roving tabindex) | webview | — | 8 | 5 | `02_phase1_a11y_kit.md` |
| 2 | Architecture detoxification (typed dispatch, shared modules, event bus) | platform | ║ with P1 | 6 | 4 | `03_phase2_architecture.md` |
| 3 | Test depth — five big UI modules + coverage gate | tests | ║ with P1/P2 | 7 | 3 | `04_phase3_test_depth.md` |
| 4 | Security hardening (sandbox HTML/SVG, CSP, brute-force, file modes verify) | platform | — | 3 | 4 | `05_phase4_security.md` |
| 5 | Theme system (light mode, high contrast, semantic tokens) | webview | ║ with P4 | 6 | 6 | `06_phase5_theming.md` |
| 6 | Lifecycle regression tests for landed L1–L7 fixes | platform | ║ with P4/P5 | 4 | 2 | `07_phase6_lifecycle.md` |
| 7 | Per-feature polish sweep (the named gaps left after P1–P6) | per-feature | — | 12 | 18 | `08_phase7_polish.md` |
| 8 | Release engineering (changelog, gated CI, cross-platform packaging) | infra | ║ with P7 | 2 | 3 | `09_phase8_release.md` |
| 9 | Documentation & observability (regrade pipeline, README sync) | docs | ║ with P7 | — | — | `10_phase9_docs.md` |

Total "feature grade lifts" mapped: roughly 48 ≥A steps + 45 ≥S steps across 40 features (multiple lifts per feature). Sub-plans tie each step to a specific feature id in `feature_grades.md`.

---

## Phase 0 — Foundation & verification

**Why first:** Several HIGH items in `triple_a_analysis.md` were claimed landed in `tracking_triple_a_analysis.md` (PR 2..21). A grade only moves when the regression test that proves the fix exists. Phase 0 closes that loop before any new work.

**Scope**

- Audit `tracking_triple_a_analysis.md` PRs 2–21 against the working tree. For each landed item, ensure a regression test exists in `tests/` and confirm it fails when the fix is reverted.
- Land the items still missing (per the "Items remaining" list): F.1/F.2/F.5–F.11, G.9 (prepared statements), H.7–H.11, I.1/I.4/I.5/I.7–I.13, J.2–J.19.
- Set up `bun run report:feature-grades`: a script that reads `doc/feature_grades.yaml` (new, structured input) and renders `doc/feature_grades.md`. Stops the grading doc from rotting.

**Acceptance criteria**

- Every landed HIGH item from the tracking doc has a named test in `tests/` referenced by a line comment with the issue id (`// fix: L1 — manager-level onExit cleanup`).
- `bun run report:feature-grades` produces a doc byte-identical to a hand-edited reference snapshot in CI.
- `bun test` + `bun run typecheck` + `bun run report:design:web` all green on a fresh checkout.

**Risk**

- Some PR claims may not survive verification (e.g. `_managerExit` wired but never exercised). Treat regressions as new HIGHs and land before moving on.

---

## Phase 1 — A11y kit (highest single-step leverage)

**Why this gets done first among the workstreams:** five feature grades sit at B specifically because their modals lack `role="dialog"` / `aria-modal` / focus trap / focus restore. A shared a11y helper lifts all five in one PR.

**Scope**

1. `src/views/terminal/a11y/modal-host.ts` — a class that wraps any element and applies: `role="dialog"`, `aria-modal="true"`, focus trap (cycle tab + shift-tab inside), focus restore on close, escape-to-close, scrim click + escape options, an `aria-labelledby`/`aria-describedby` plumbing.
2. Apply the helper to: Process Manager overlay, Command Palette, Settings Panel, Ask-user modal, Keyboard Cheatsheet, Telegram chat-pick dialog, agent-panel dialogs.
3. Reduced-motion blanket — `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; } }` in `index.css` AND `web-client/client.css`; spot-check that terminal-effects canvas honours it via JS guard (canvas isn't covered by CSS).
4. Sidebar roving-tabindex on workspace list (U12). IME composition guard on Enter in palette + settings text inputs (U15).
5. Touch-target sweep: every `.chip-*`, `.toast`, button → minimum 44 × 44 px hit area on mobile mirror (U/I.5). Use a `min-target.css` shim.
6. ARIA labels + live regions for git-status chip transitions and notifications history (U7/U8).

**Acceptance criteria**

- All seven modals pass an axe-core scan with zero serious/critical violations.
- A new Playwright test verifies: open palette → tab cycles within → escape closes → focus returns to the previously focused element.
- The reduced-motion blanket reduces `report:design` animation-step screenshots to identical-to-prev-frame counts; a new test asserts this.
- Touch-target check via Playwright mobile viewport: no interactive element has bounding box smaller than 44 × 44 px.

**Lifts** (per feature_grades.md): Process Manager B→A, Command Palette B→A, Settings Panel B→A, Ask-user B→A, Cheatsheet A→S, Notifications B→A, Sidebar B→A, Tau primitives A→S. Plus reduced-motion improves Terminal Effects B→A (with the JS canvas guard).

---

## Phase 2 — Architecture detoxification

**Why now, in parallel with P1:** A1 and A2 are typed-dispatch regressions. They keep growing while features evolve. Killing them now stops new features from inheriting the debt.

**Scope** (mirrors cluster F items still open)

1. `WebviewActionEnvelope` — discriminated union typed against every dispatchable action; replace the ~180 LOC `dispatch(action: string, …)` router in `src/bun/index.ts:2331-2508` (A1).
2. `protocol-dispatcher.ts` narrowing — accept `ServerMessage` union; `switch(msg.type)` with per-branch narrowing (A2).
3. `src/shared/chip-render.ts` — extract chip rendering (F.1); native + mirror import it (A4).
4. `src/shared/pane-layout-math.ts` — extract pure `computeRects` (F.2); both native and mirror wrap it (A5).
5. Typed `EventBus<EventMap>` — replace 47+ `window.dispatchEvent("ht-…")` channels (A6).
6. `VariantContext` — drop `__tauSurfaceManager` + sibling globals; pass an interface into `VariantController` (A7).
7. Settings JSON-schema source-of-truth — generate `AppSettings`, `DEFAULT_SETTINGS`, `validateSettings`, and migrations from a single `settings.schema.ts` (F.6 + migration story).
8. `WorkspaceCollection` extract from `SurfaceManager` (F.11).
9. RPC handlers split — move remaining ad-hoc handlers into `src/bun/rpc-handlers/*.ts` (F.10).

**Acceptance criteria**

- `tsc --noEmit` clean; no `: any` in `protocol-dispatcher.ts`; `WebviewActionEnvelope` exhaustive `switch` enforced by `noFallthroughCasesInSwitch`.
- `grep -rn "window.dispatchEvent\\|new CustomEvent.*ht-" src/views/` returns ≤ 5 lines (residual legacy paths documented).
- `grep -rn "__tauSurfaceManager\\|__tauNotify" src/` returns 0 lines.
- A new test verifies adding a method to `TauMuxRPC["bun"]["messages"]` without a handler is a compile error.

**Lifts:** RPC handlers B→A, Web mirror B+→A, Variants B→A, Chip rendering B→A, Settings persistence B+→A, Workspaces B→A.

---

## Phase 3 — Test depth for the five biggest UI modules

**Why parallel:** independent of P1/P2; can start immediately. Test author can do per-module work without blocking the helper extracts.

**Scope**

- For each of `sidebar.ts` (2964), `settings-panel.ts` (1891), `agent-panel.ts` (1755), `terminal-effects.ts` (1011), `browser-pane.ts` (999): DOM-level unit tests with happy-dom covering the public surface — open, render under representative state, key user actions, destroy. Target ≥ 60 % line coverage per file.
- Bootstrap path test: spin up SessionManager → RPC handlers → SurfaceManager with mocked Electrobun RPC; assert the wiring is correct.
- `bun run test:coverage` gate in CI at ≥ 65 % lines, ≥ 70 % funcs, ≥ 55 % branches across the repo. Numbers adjusted based on baseline after Phase 0.
- Failure-path Playwright cases: subprocess crash (PTY exit code ≠ 0), WS disconnect mid-session, settings file corruption, sideband malformed frames.
- Fuzz corpus for the sideband parser (T9) and OSC parser.
- Add a test that asserts every RPC method declared in `TauMuxRPC` has a corresponding handler registered (closes a class of A1 bugs at runtime even if a future regression slips past typecheck).

**Acceptance criteria**

- 100 % of the five UI modules have a `tests/<module>.test.ts` next to them.
- Coverage thresholds enforced in CI.
- Playwright failure-path suite runs in CI on every PR.
- Sideband fuzz corpus + harness lives at `tests/fuzz/sideband/`.

**Lifts:** Sidebar B→A, Settings Panel B→A, Browser pane B→A, Terminal effects B→A, Editor pane B→A, Plan panel A→S, Pi agent B→A (regression L1 lands here too).

---

## Phase 4 — Security hardening (LAN-visible mirror)

**Scope** (mirrors remaining cluster H items)

1. iframe-sandbox HTML/SVG panels in the mirror — `srcdoc` + `sandbox="allow-same-origin"` only (no scripts), strict CSP `default-src 'self'; frame-ancestors 'none'; object-src 'none'`. (S2, H.7)
2. Per-surface browser partition + cross-origin auth for browser surface. (H.8)
3. Session cap + manifest-auth + cross-site origin check on web mirror. (H.9)
4. Telegram `parse_mode` validation (S11, H.11).
5. Brute-force throttle verification — confirm H.4 lands a per-IP throttle that returns 429 + Retry-After; add a test that hammers the endpoint and asserts cooldown.
6. File-mode verification — confirm logger/settings/cookies/history/telegram.db all open with 0o600 (H.1); add a test that stats each file post-write.
7. Docs page `doc/system-security.md` cataloguing the LAN trust model (H.10).

**Acceptance criteria**

- A red-team checklist (10–15 items) in `doc/system-security.md`, each item paired to a test or a CI grep that prevents regression.
- Mirror page CSP report-only mode → enforcing mode without console violations on the demo flow.
- `stat -f %p` (or equivalent) check on every sensitive file in a smoke test.

**Lifts:** Web mirror B+→S, Panel content renderers B→A, Telegram A→S, Cookie store B→A, Browser history B→A, Logging A→S.

---

## Phase 5 — Theme system

**Scope**

1. Token layer reorg — every colour in `index.css` + `web-client/client.css` derived from a semantic token (e.g. `--tau-color-surface`, `--tau-color-text-primary`). Map current Graphite palette as the "Graphite Dark" theme.
2. Ship "Graphite Light" + "High Contrast" themes; user-selectable in Settings.
3. Honour `prefers-color-scheme: light` automatic switch when the user picks "system".
4. `forced-colors: active` mapping for Windows High-Contrast.
5. Reduced-motion: extend the Phase 1 blanket with per-component overrides where the blanket is too aggressive (e.g. crucial state transitions that need ≥ 16 ms to register).
6. Design-report visual baselines per theme — `report:design` runs for Dark + Light + HC; all three gated.
7. Icon stroke-width + sizing token review (currently hard-coded 0.8 default in tau-icons.ts).

**Acceptance criteria**

- A `bun run audit:theming` script scans CSS for hard-coded colour literals and fails on any non-token value.
- Design-report has three baseline sets; CI gates against all three.
- Manual screenshot review: every screen looks correct in Light + HC.

**Lifts:** Tau primitives A→S, Sidebar B→A→S (with P1 + P3 + P5 stacked), Settings Panel A→S, Notifications B→A→S, Native menus A→S, Web mirror A→S, Tau focus audit C→A (it now has more to assert).

---

## Phase 6 — Lifecycle regression tests

**Why parallel with P4/P5:** mechanically independent.

**Scope** — for each of L1..L7 (and L8..L14 from the tracking doc), add a regression test that:

- Reproduces the original failure mode against a "broken" copy of the code (we keep a `tests/regressions/` folder of "buggy" snapshots for this).
- Asserts the current fix prevents the failure.

Items:

- L1 — Pi agent crash → manager removes dead instance + emits `agentSurfaceCrashed`.
- L2 — SIGHUP delivered first, child has 500 ms to trap.
- L3 — WS heartbeat closes half-open peer ≤ 120 s.
- L4 — socket buffer cap drops oversized writes.
- L5 — reconnect jitter spread observed across 10 simulated clients.
- L6 — second SIGINT during shutdown does not re-enter steps.
- L7 — crash during settings write leaves the previous file intact (test by SIGKILL mid-`rename`).
- L8..L14 — palette destroy, debounce cleanup, telegram-db PRAGMA, audit timeouts.

**Acceptance criteria**

- One named test per L#, each tagged `@regression-Lxx` in test output.
- A reverted fix causes its named test to fail loudly.

**Lifts:** PTY lifecycle B→A, Pi agent B→A, ht CLI A→S (with file modes + heartbeat + jitter all verified), Settings persistence A→S, Web mirror residual B+ items.

---

## Phase 7 — Per-feature polish sweep

This is the long tail. Each named gap in `feature_grades.md` that wasn't already covered by P1–P6 gets a small PR. The sub-plan groups them by ownership and risk.

**Buckets**

- **Sidebar polish:** drop indicator on drag-reorder, Escape-cancel, mirror parity for CWD file explorer, symlink-cycle guard, truncation indicator.
- **Settings panel polish:** reset-to-default per field, validation feedback, schema-version field, sync-on-quit for secrets.
- **Editor pane polish:** save-race detection with `expectedMtimeMs`, conflict UX, line-ending convert on save, split keyboard shortcut.
- **Browser pane polish:** navigation-rule validation + diagnostics, zoom persistence, `findInPage` CLI binding.
- **Auto-continue polish:** paused-surfaces persistence, per-session metrics, cap-hit warning.
- **Notifications polish:** copy + detail expand, persistent history, configurable overlay cap.
- **Demo scripts polish:** CI smoke tests for the eight demos; library parity gate (Python + TS expose identical helpers).
- **Manifest scanner polish:** symlinked `$HOME`, 4× TTL test, parser symmetry.
- **Cookie store polish:** per-domain cap, export/import, URL-host normalize.
- **Browser history polish:** URL normalize, time-window filter, privacy clear.
- **Terminal search polish:** regex toggle, persisted history.
- **OSC progress polish:** per-pane chips.
- **Plan panel polish:** RPC input validation, configurable audit-ring size, mirror audit persistence.
- **SurfaceMetadataPoller polish:** stale-git skip-tick, rot detection, deeper tree-diff.
- **Audits polish:** more audits (locale, node, shell caps), auto-rerun on settings change.
- **Health polish:** remediation `fix()`, UI badge wiring, staleness auto-demotion.
- **Event writer polish:** queued writes + backpressure, per-channel rate limits.

**Acceptance criteria**

- Each item closes with a test and a one-line entry in `tracking_feature_upgrade_to_AAA.md` (created at the start of Phase 7).
- Re-running `bun run report:feature-grades` shifts the relevant feature to its target grade.

**Lifts:** the remaining B→A and A→S transitions for ~18 features.

---

## Phase 8 — Release engineering

**Scope**

- `scripts/bump-version.ts` extended to optionally commit, tag, and append a Keep-A-Changelog entry derived from `git log` since the previous tag.
- `report:design:gate` + `test:design:audit` + `audit:test-hooks` + `audit:emoji` + `audit:animations` + `audit:guideline` + new `audit:theming` (P5) all wired into CI (GitHub Actions or equivalent — needs a CI config decision).
- Linux packaging path: at minimum a tarball + `.deb` step in `scripts/post-package.ts` gated by `if (process.platform === "linux")`. Document the trade-off if we choose Mac-only as an intentional non-goal.
- Rollback story for partial build failures.

**Acceptance criteria**

- A failing design-report blocks merge.
- Cutting a release is one command (`bun run release patch|minor|major`); manual steps are documented as failure-mode recovery only.

**Lifts:** Version bumping C→A, Design report C+→S, Tau focus audit C→A.

---

## Phase 9 — Documentation & observability

**Scope**

- `bun run report:feature-grades` regenerates `doc/feature_grades.md` from `doc/feature_grades.yaml` (one entry per feature, fields `grade`, `evidence`, `gaps`). The yaml is the source of truth.
- A GitHub Action runs the regen on every push to detect manual edits that bypass the yaml.
- README + website-doc updated with the AAA stance: link to `feature_grades.md` from a "Quality" page.
- French translations of any newly added website-doc pages, per `CLAUDE.md`.
- A short "Quality bar" page in `doc/` explaining the grade scale and how to propose a regrade.

**Acceptance criteria**

- The grading doc rebuilds deterministically.
- Manual edits to the .md without a matching yaml change fail CI.

---

## Cross-cutting dependencies

```
P0  ──→ P1  ─────────────────────────→ P7 ──→ P8 ──→ done
   ╰─→ P2  ─╮                       ↗
       P3  ─┼──→ P6 ────────────────╯
            ╰──→ P4 ──→ P5 ─────────╯
                                    P9 runs continuously from P0
```

- P0 unblocks everything.
- P1, P2, P3 can start once P0 sets up `bun run report:feature-grades` and verifies the F–J landings.
- P4 needs P2.7 (settings schema) for one item but otherwise independent.
- P5 needs P4 token layer to land first (security headers + CSP must not contradict theming inline styles).
- P6 needs nothing beyond P0.
- P7 needs the foundations of P1–P5 in place (otherwise polish work would duplicate effort).
- P8 needs the gates that exist after P5/P3.
- P9 runs continuously.

---

## Effort sizing (rough, in "engineer-weeks")

These are coarse buckets to enable sequencing decisions, not commitments.

| Phase | Engineer-weeks | Confidence |
|---|---:|---|
| P0 | 1.0 | high |
| P1 | 1.5 | high |
| P2 | 3.0 | medium |
| P3 | 3.0 | medium |
| P4 | 1.5 | medium |
| P5 | 2.0 | medium-low (depends on Light mode polish) |
| P6 | 1.0 | high |
| P7 | 4.0 | low (long tail) |
| P8 | 1.0 | high |
| P9 | 0.5 (continuous) | high |
| **Total** | **~18.5** | — |

With three engineers in parallel (one platform, one webview/UX, one tests/infra), realistic calendar time is ~8 weeks. With one engineer, ~18–20 weeks.

---

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| F–J landings claimed but missing | P0 | Treat verification gaps as new HIGHs and land in P0 before anything else. |
| Modal a11y kit fights existing CSS positioning | P1 | Build it as a wrapper that takes existing DOM, not a replacement. Test against each call site before rolling out. |
| Typed dispatch refactor breaks RPC compatibility | P2 | Land the union alongside the string router; deprecate-then-remove across two patch versions. |
| Light mode reveals palette-only assumptions in 100+ components | P5 | Token-audit script (P5 step 1) fails CI on hard-coded colours before any visual work begins. |
| Coverage gate floor too low and ratchets down | P3 | Set the floor to current baseline + 5 pp; any PR that lowers coverage requires explicit override. |
| Test fuzz corpus finds new HIGH bugs | P3 | Treat as part of P3 acceptance, not a separate phase. |
| Cross-platform packaging (P8) drags in OS-specific issues | P8 | Explicit non-goal decision documented; Mac-only is a defensible scope. |
| Per-feature polish accumulates "almost-S" items that never quite reach S | P7 | Sub-plan tracks each item to a target grade; "A is fine, declared non-goal for S" is a valid resolution. |

---

## Tracking convention

Per `CLAUDE.md`:

- Each phase gets a sub-plan file (`02_phase1_*.md` … `10_phase9_*.md`) in this directory.
- Progress for each phase is tracked in `doc/tracking_feature_upgrade_to_AAA_phaseN.md` (sibling of the existing `tracking_*` docs).
- Every functional commit is preceded by `bun run bump:patch` unless the change is docs/tracking-only.
- Commit messages reference the issue id from `triple_a_analysis.md` when applicable.
- When changes ship to website-doc, the version is bumped in `website-doc/src/content/docs/api/system.md` and `website-doc/src/content/docs/cli/system.md`; French translations follow.
- `doc/changes_to_document.md` is kept current; cleared when the website-doc lands the changes.

---

## Sub-plan templates

Each sub-plan file should contain:

1. **Goal** — one paragraph.
2. **Steps** — numbered list with file:line refs.
3. **Per-step acceptance criteria** — specific assertion(s).
4. **Test plan** — names of tests added.
5. **Lifts to track** — which features in `feature_grades.md` move to which grade.
6. **Rollback** — how to revert if the phase regresses something.
7. **Open questions** — explicit unknowns to resolve before starting.

---

## Next action

1. **Decide:** one-engineer serial vs. three-engineer parallel execution. (Affects which sub-plans get written first.)
2. **Create:** `01_phase0_foundation.md` and execute Phase 0 to verify the F–J landings and stand up `bun run report:feature-grades`.
3. **Re-baseline:** after Phase 0, re-run the grading audit; if any grades moved (up or down) because of the verification pass, update `feature_grades.md` before starting P1.
4. **Snapshot:** capture the lcov coverage baseline, the design-report baseline, and the τ-focus-audit baseline. All three are inputs to the gates that land in P3 / P5 / P8.

---

## Companion docs

- `doc/feature_grades.md` — per-feature grading (the success metric for this programme).
- `doc/triple_a_analysis.md` — the issue catalogue (source of `A#/L#/S#/U#/T#` ids).
- `doc/tracking_triple_a_analysis.md` — execution log for F–J clusters; Phase 0 verifies its claims.
- `doc/full_analysis.md`, `doc/issues_now.md`, `doc/deferred_items.md` — earlier audit rounds (context only).
- `doc/changes_to_document.md` — running website-doc changelog (per CLAUDE.md convention).
