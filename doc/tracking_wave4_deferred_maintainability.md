# Tracking — Wave 4: deferred maintainability items (from `full_app_review_2026-05.md`)

Started: 2026-05-30. Effort: high. Follows Wave 3 (`tracking_wave3_xterm_and_cleanup.md`, commit 2071da80, v0.3.164).
Source: `doc/full_app_review_2026-05.md` §14.2 / §18.3 / §18.4.

Picking up the lower-risk, high-value deferred items as focused commits.

## Scope

| ID | Item | Sev | Commit | Status |
|----|------|-----|--------|--------|
| W4-1 | Settings `schemaVersion` + ordered migration runner (§14.2) — enables future field rename/removal without silent data loss | medium | A `f40a5bea` | ✅ |
| W4-2 | Supply-chain: `renovate.json` (bun-aware) + non-blocking vuln-scan CI job (§18.3) | medium | B | ✅ |
| W4-3 | ~~Remove dead devDeps~~ | — | — | ❌ **INVALID — withdrawn** |

### ⚠️ Correction to the review (§18.4)
The review claimed `@ai-hero/sandcastle` + the `@typescript-eslint` pair were **unused** ("no eslint config exists"). **This is wrong** — verified against the repo:
- `eslint.config.js` EXISTS and imports `typescript-eslint` (+ `tseslint.parser` = `@typescript-eslint/parser`).
- `.sandcastle/main.ts` (a multi-agent orchestration template) uses `@ai-hero/sandcastle`.
The earlier "no eslint config" reading came from a `ls eslint.config.*` zsh glob that silently no-matched. **All three deps are in use — none removed.**

The *real* gap is that eslint is **configured but never run and currently broken**: there's no `lint` script / CI step, `eslint` core isn't a direct devDep, and `eslint .` emits **22,023 errors over ~1.1M lines** because the config's `ignores` miss `.claude/worktrees/`, generated bundles, etc., plus a `tsconfigRootDir` parser error. Fixing the ignores + parser config + triaging real findings is a dedicated cleanup — **deferred** (a noisy lint rollout would drown this history). Not the "remove dead deps" the review suggested.

Legend: ⬜ todo · 🔄 in progress · ✅ done · ⚠️ deviation

### Still deferred (with rationale)
- **`SurfaceManager`/`Sidebar`/`bin/ht` decomposition + shared sidebar-card renderer** (§3, L) — large refactors; each its own bisectable PR.
- **OS-keystore at-rest encryption** (§13.2, L, macOS `security` CLI) — Electrobun has no Keychain API.
- **Brand-string `brand.ts` + config-dir migration** (§20.1, M) — touches load-bearing identifiers; needs a careful one-time rename-on-launch.
- **Archive stale `doc/`** (§20.2) — REASSESSED: `doc/full_analysis.md` + `triple_a_analysis.md` are referenced by ~9 source-comment locations + `scripts/build-feature-grades.ts`, so a naïve `git mv` would create stale path refs. Lower-value tidiness not worth churning source files; left in place. The truly-dead phase trackers could be moved later in a dedicated housekeeping commit that does NOT touch the two code-referenced analyses.
- **eslint/biome rollout** (§18.4) — a full lint config over 64k LOC surfaces a large backlog + (biome) reformats everything; deferred so the noise doesn't drown the security/dep history. W4-3 takes the review's other offered path (remove the dead lint packages).

## W4-1 design
- Schema version is **persistence metadata**, NOT a typed `AppSettings` field — stored as a top-level `__schemaVersion` JSON key handled entirely by `SettingsManager` + `src/shared/settings-migrations.ts`. Keeps `AppSettings`/`validateSettings`/the web snapshot/tests untouched (`validateSettings` rebuilds from known fields and drops unknown keys, so `__schemaVersion` never leaks into the in-memory object).
- `migrateSettings(raw, target, migrations)`: missing version ⇒ treat as v0 (pre-versioning) so a future v0→v1 migration can run; apply `MIGRATIONS[v]` for v in [from, target); stamp `__schemaVersion = target`. A file claiming a FUTURE version (downgrade) is returned as-is (no backward migration); a throwing migration stops gracefully (never bricks startup).
- Baseline `SETTINGS_SCHEMA_VERSION = 1`, registry empty (v1 is today's shape). The existing idempotent `applyBloomMigration` stays separate and unchanged.

## Verification
- **W4-1**: typecheck clean; `bun test` 2989/0; `bun start` boots on the new load path. Committed `f40a5bea` (v0.3.165).
- **W4-2**: `renovate.json` valid JSON; `bun audit` runs and **surfaced 7 vulnerabilities (4 high, 3 moderate)** — confirms the scan's value (fixing them is a separate dependency-update effort that renovate + the scan will drive; `bun audit` exits 0 so the job is informational, with `continue-on-error` as belt-and-suspenders). CI job added to `ci.yml`.

## Follow-ups surfaced
- **7 dependency vulnerabilities** (4 high) flagged by `bun audit` — triage + `bun update` in a dedicated dep-bump change (renovate will also open grouped PRs).
- **Fix the broken eslint config** (ignores + tsconfigRootDir + `eslint` direct dep + `lint` script + CI), then triage src/ findings — dedicated cleanup.

## Commit / release
- Commit A (W4-1): `f40a5bea` (v0.3.165).
- Commit B (W4-2): (recorded below)
