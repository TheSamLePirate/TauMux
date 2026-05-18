---
title: Release process
description: How a τ-mux release is cut — version bumping, changelog generation, packaging, rollback.
sidebar:
  order: 4
---

τ-mux ships releases by running a small set of scripts that propagate a single version string across seven files, optionally commit + tag + write `CHANGELOG.md`, then build platform-specific artifacts. Everything lives in `scripts/`; nothing in the build pipeline reaches outside the repo.

## The seven version-tracked files

The version string in `package.json` is the **source of truth**. `scripts/bump-version.ts` propagates it to six additional places:

```
package.json
electrobun.config.ts
src/bun/rpc-handlers/system.ts        (returned by `system.version` RPC)
website-doc/src/content/docs/cli/system.md      (example output in `ht version`)
website-doc/src/content/docs/api/system.md      (example output in `system.version` RPC)
website-doc/src/content/docs/fr/cli/system.md   (French mirror of the above)
website-doc/src/content/docs/fr/api/system.md   (French mirror of the above)
```

If any of those drift, the next bump will bring them all to the new version — the targeted regex replacements are written to converge.

## `bump-version` flags

```bash
bun scripts/bump-version.ts <patch|minor|major|x.y.z> [flags]
```

| Flag | What it does |
|---|---|
| `--commit` | Create a `chore(release): vX.Y.Z` commit staging only the seven version-tracked files. Refuses on a dirty working tree unless `--allow-dirty` is also passed. |
| `--tag` | Create an annotated `vX.Y.Z` tag at HEAD (implies `--commit`). Refuses to overwrite an existing tag. |
| `--changelog` | Generate / extend `CHANGELOG.md` with a conventional-commit-grouped section (feat / fix / perf / refactor / docs / test / chore / other). Empty sections are skipped. Range = `$(prev-tag)..HEAD`. |
| `--allow-dirty` | Skip the working-tree-clean check. |
| `--dry-run` | Print everything that would change without writing files or touching git. |

Wired as npm scripts:

```bash
bun run bump:patch    # 0.3.148 → 0.3.149
bun run bump:minor    # 0.3.148 → 0.4.0
bun run bump:major    # 0.3.148 → 1.0.0
```

## Typical release cut

```bash
# 1. (Optional) preview the changelog entry
bun scripts/bump-version.ts patch --dry-run --changelog

# 2. Bump, write CHANGELOG.md, commit, and tag in one shot
bun scripts/bump-version.ts patch --changelog --tag

# 3. Build platform artifacts
bun run build

# 4. (Optional) push the tag
git push --follow-tags
```

The `--changelog --tag` form is the recommended path: the resulting commit (`chore(release): vX.Y.Z`) contains the file bumps **and** the new `CHANGELOG.md` section, and the annotated tag points at it.

## Rollback safety

`bump-version` runs in two phases. If anything fails, it unwinds in the reverse order.

1. **File phase.** Before any write, the script snapshots the current contents (or "did not exist") of every target file. If any update throws — typically because a regex didn't match a file that was hand-edited out of shape — all snapshots are restored. `CHANGELOG.md` is **deleted** rather than restored to empty when it didn't pre-exist.
2. **Git phase.** Each post-write git action (commit, tag) pushes an undo callback onto a LIFO stack. If `--tag` fails after `--commit` succeeded, the commit is `reset --soft`'d and the file rollback runs too. The user sees the same starting state.

Failure exits with code 3 and a `[bump] ERROR — rolling back: …` line.

## Test sandboxing

To make the script unit-testable, it honours a `BUMP_VERSION_ROOT` env var that overrides the repo-root path it operates on. Tests in `tests/bump-version-flags.test.ts` build a fresh tmpdir, seed it with the seven version-tracked files plus a `git init`, then invoke the script with `BUMP_VERSION_ROOT=<tmpdir>`. 12 tests cover happy paths, dirty-tree refusal, duplicate-tag refusal, changelog grouping + empty-section skip + CHANGELOG.md staging, and three rollback scenarios.

## Project `CHANGELOG.md`

The repo root carries a `CHANGELOG.md` populated by `bump-version --changelog`. The format is conventional-commit-grouped, e.g.:

```md
## v0.3.148 — 2026-05-18

### Features

- **panel-registry**: per-surface panel cap with oldest-eviction (b4e2e084)
- **workspaces**: strict layout.json validator + truncation recovery (f41f2484)

### Refactoring

- **rpc**: extract bunMessageHandlers into per-domain modules (Cluster F.10 / P7) (e6f3f530)
```

The website's [Changelog](/changelog/) is the curated narrative; the project `CHANGELOG.md` is the literal commit-grouped record.

## Platform packaging — `scripts/post-package.ts`

Runs after `electrobun build`. Branches on platform:

| Platform | What happens |
|---|---|
| **macos** | Patches `CFBundleDisplayName="τ-mux"` into the bundle's `Info.plist` (Electrobun regenerates the plist late in its pipeline, so this step is required to ship the pretty name); rebuilds `.tar.zst` from the patched `.app/` using `tar | zstd -19`; rebuilds the DMG via `hdiutil` with an `Applications` drag-target. |
| **linux** | Skips the `Info.plist` step (no equivalent on Linux). Skips the DMG step. Rebuilds `.tar.zst` from the flat `tau-mux/` build directory (Linux electrobun emits a directory, not a `.app/` bundle). |
| **other** (Windows, BSD, …) | Logs `[post-package] Skipping — no post-package recipe for platform=<x>` and exits 0. |

The `.tar.zst` rebuild uses `tar -cf - -C <BUILD_DIR> <APP_DIR_NAME> \| zstd -19 -q -o <TARBALL>` — same shell pipeline on both supported platforms; the only thing that branches is the archive root name (`tau-mux.app/` on macOS, `tau-mux/` on Linux).

## Where the tests live

| File | What it covers |
|---|---|
| `tests/bump-version-flags.test.ts` | 12 tests — happy paths + dirty-tree refusal + duplicate-tag refusal + changelog grouping + rollback scenarios |
| `tests/post-package-platform.test.ts` | 9 source-grep tests — platform union, gate predicates for Info.plist / hdiutil, tar pipeline reuses `APP_DIR_NAME`, BUILD_DIR template, unknown-platform skip |
| `tests/ci-coverage-gate.test.ts` | 4 source-grep tests — `coverage-gate` job declaration in `.github/workflows/ci.yml`, runs `test:coverage` then `report:coverage:check`, macOS runner, timeout set |

## Read more

- Project `CHANGELOG.md` at the repo root (generated, conventional-commit grouped).
- [Changelog](/changelog/) — curated user-facing changes.
- [Testing](/development/testing/) — how the CI coverage gate works.
