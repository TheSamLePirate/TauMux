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
