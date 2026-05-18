# Phase 9 — Observability + deferred-P8

Closes the deferred P8 items (CI coverage gate) and starts P9
proper (logging improvements + CHANGELOG.md). Phase 7 + headline
P8 already closed in earlier pushes.

## Scope

1. **CI coverage gate** (deferred P8 item) — wire
   `bun run report:coverage:check` into the GitHub workflow so a
   per-file coverage regression fails a PR.
2. **Logging** (A → S) — size-based rotation alongside the existing
   daily rotation; configurable via `HT_LOG_MAX_BYTES` env.
3. **CHANGELOG.md** — populate using the P8 `--changelog` tooling on
   real history (proves the tool round-trips on a 300+ commit range)
   and gives users a first-class release-notes file.

## Sessions

### Session 1 (2026-05-18) — CI coverage gate

`.github/workflows/ci.yml` gains a `coverage-gate` job that runs
`bun run test:coverage` then `bun run report:coverage:check` on
macOS-14. The two jobs (typecheck-and-unit + coverage-gate) run
in parallel — no serial dependency. 4 source-grep tests in
`tests/ci-coverage-gate.test.ts` lock in the job declaration so
the gate can't be silently removed in a future workflow refactor.

### Session 2 (2026-05-18) — logger size rotation

`src/bun/logger.ts` extended with size-based rotation. New:
- `resolveMaxBytes()` reads `HT_LOG_MAX_BYTES` (default 50 MiB,
  ≤ 0 disables).
- `rotateForSize()` renames `app-DATE.log` → `app-DATE.<n>.log`
  (next available index 1, 2, 3, …) and opens a fresh active
  chunk.
- `bytesInActive` tracked across writes; seeded from `fstatSync`
  on open so a same-day restart picks up where we left off.
- `PRUNE_PATTERN` extended to match the numbered rotated chunks
  (`^app-(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.log$`) so the 14-day
  retention sweep prunes them too.

4 new tests in `tests/logger.test.ts`: prune-numbered-chunks,
threshold-rotate-via-console.log, env-zero-disables, and same-day-
resume-picks-up-existing-size.

### Session 3 (2026-05-18) — populate CHANGELOG.md

Ran `bun scripts/bump-version.ts patch --changelog` against the
real repo. Generated `CHANGELOG.md` from 312 commits since
v0.2.30 (Phase 6 close), grouped by conventional-commit type
(Features / Bug fixes / Performance / Refactoring / Documentation
/ Tests / Chores / Other). Exercises the P8 S1 tooling on real
history and proves the changelog generator scales to multi-
hundred-commit ranges.

## Exit criteria (P9)

| Criterion | Status |
|---|---|
| CI coverage gate wired into .github/workflows/ci.yml | ✅ |
| Logger size-based rotation (50 MiB default, env override) | ✅ |
| CHANGELOG.md populated from real history | ✅ |
| `bun test` green modulo known pty-timing flakes | ✅ 2868 / 2870 (2 known flakes) |
| `bun run typecheck` shows only pre-existing 2 errors | ✅ |

Remaining stretch items (still owned by a future phase or live-env
infra):
- Failure-path Playwright cases (network loss, subprocess crash) —
  needs a live Playwright env.
- Mobile-viewport touch-target Playwright assertion (I.5) — same.
- Logger gzip of old rotated chunks — small follow-up; the chunks
  are owner-readable and 50 MiB is already manageable for
  short-term retention.
- Structured log-level filter — would need a logger API change;
  current code is fire-and-forget.
