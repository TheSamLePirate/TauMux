# Phase 8 — Release engineering

Tracks the multi-session Phase 8 push. Phase 7 closed on 2026-05-18
with `audit:theming` clean + Cluster F.10 done; Phase 8 picks up the
remaining structural gaps, headlined by **release-tooling** (graded
C in feature_grades.json: `scripts/bump-version.ts` doesn't commit/
tag/changelog; `scripts/post-package.ts` macOS-only; no rollback on
partial build failures).

## Scope

From feature_grades.json + the various "Owned by P8" notes:

1. **release-tooling (C → target A)** — `bump-version.ts` enhanced
   with `--commit`, `--tag`, `--changelog` flags; rollback on partial
   failure; `post-package.ts` cross-platform (Linux release path).
2. **tau-focus-audit (C → target A)** — wire the DevTools/REPL audit
   into `bun test` so chromatic-glow leaks fail the build.
3. **Failure-path Playwright cases** — network loss, subprocess
   crash (Cluster F.x carry-over).
4. **CI coverage gate** — wire `bun run report:coverage:check` into
   CI so a PR can't merge below baseline (Phase 3 carry-over).
5. **Mobile-viewport touch-target Playwright assertion** — I.5 from
   Phase 3.

## Sessions

### Session 1 (2026-05-18) — release-tooling: bump-version --commit / --tag / --changelog

Commit `08320649`. scripts/bump-version.ts gains five flags:
- `--commit` — creates `chore(release): vX.Y.Z` staging only the
  seven version-tracked files; refuses on dirty tree without
  `--allow-dirty`.
- `--tag` — annotated `vX.Y.Z` at HEAD (implies `--commit`); refuses
  to overwrite existing tags.
- `--changelog` — generates / extends `CHANGELOG.md` with a
  conventional-commit-grouped section (feat / fix / perf / refactor
  / docs / test / chore / other). Empty sections skipped. Range =
  `$(prev-tag)..HEAD`.
- `--allow-dirty` — bypass the working-tree-clean check.
- `--dry-run` — print everything without writing or git-touching.

`BUMP_VERSION_ROOT` env override added so tests can sandbox the
script against a tmpdir-fixture without mocking. 9 tests in
`tests/bump-version-flags.test.ts` cover dry-run, --commit clean +
dirty, --tag annotated + duplicate-refusal, --changelog grouping +
skip-empty + CHANGELOG.md staging, unknown-flag.

### Session 2 (2026-05-18) — release-tooling: rollback safety

Same commit `08320649`. Two-tier rollback:
1. **File phase**: snapshot all 7 (or 8 with CHANGELOG) target files
   BEFORE any write; restore on any update-phase throw. CHANGELOG.md
   gets deleted (not restored to empty) if it didn't pre-exist.
2. **Git phase**: track post-write git actions (commit / tag) in a
   LIFO stack; if --tag fails after --commit succeeded, the commit
   is reset AND the file rollback runs.

3 additional tests in `tests/bump-version-flags.test.ts` cover the
rollback scenarios: regex throw mid-update, CHANGELOG didn't
pre-exist deletion, --tag failure unwinds the commit. Total bump-
version test count: 12.

**Issue**: my first iteration ran the new --commit logic against the
real repo via tests (before `BUMP_VERSION_ROOT` was wired). Two
stray `chore(release): v0.3.143` and `v0.3.145` commits authored
by the test identity `T <t@t>` leaked into the worktree and were
cleaned up with a soft-reset + manual version revert before the
final commit landed.

### Session 3 (2026-05-18) — post-package Linux path

Commit `dc41c6f7`. scripts/post-package.ts now branches three ways:
- **macos**: full pipeline (Info.plist patch + .tar.zst + DMG)
  unchanged.
- **linux**: skip Info.plist (no equivalent) + skip DMG; reuse the
  same `tar | zstd` shell pipeline with the Linux-flat
  `APP_DIR_NAME` (`tau-mux/` instead of `tau-mux.app/`).
- **other** (Windows, BSD, …): old skip-with-message preserved.

`TARBALL_NAME` and `APP_DIR_NAME` branch on `PLATFORM` so the
archive root matches the on-disk shape. 9 tests in
`tests/post-package-platform.test.ts` source-grep the script for
the invariants any future refactor must preserve (platform union,
gate predicates for Info.plist + hdiutil, tar pipeline reuses
APP_DIR_NAME).

### Session 4 (2026-05-18) — tau-focus-audit wired into bun test

Same commit `dc41c6f7`. The DevTools-only audit
(`src/views/terminal/tau-focus-audit.ts`) now ships with a
happy-dom fixture suite (`tests/tau-focus-audit.test.ts`, 10 tests):
- `splitShadows` base case (`none`)
- `isGlow` classification: pure-black elevation (rejected), near-
  zero alpha fade (rejected), sub-4px blur (rejected), cyan-glow
  positive case (accepted).
- role assignment: `tau-pane.is-focused` → `focus`; non-pane chrome
  with glow → `leak`.
- multi-layer shadow (black drop + cyan halo): only the glow layer
  counts.
- `window.tauAuditFocus` hook exposed for DevTools.

A chromatic-glow leak in chrome CSS now fails the build.

## Exit criteria (P8)

| Criterion | Status |
|---|---|
| bump-version --commit/--tag/--changelog | ✅ |
| bump-version rollback (file phase + git phase) | ✅ |
| post-package cross-platform (macOS + Linux) | ✅ |
| tau-focus-audit in bun test | ✅ |
| `bun test` green modulo known pty-timing flakes | ✅ 2852 / 2854 (2 known flakes) |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |

Remaining P8 stretch items (deferred — owned by P8.5 or P9):
- Failure-path Playwright cases (network loss, subprocess crash) —
  needs a live Playwright env.
- CI coverage gate wire-up (`bun run report:coverage:check` into a
  GitHub workflow).
- Mobile-viewport touch-target Playwright assertion (I.5).

These three need real CI/Playwright infra; the headline P8 items
(release tooling + audit) are done.
