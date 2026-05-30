# Tracking — Wave 4: deferred maintainability items (from `full_app_review_2026-05.md`)

Started: 2026-05-30. Effort: high. Follows Wave 3 (`tracking_wave3_xterm_and_cleanup.md`, commit 2071da80, v0.3.164).
Source: `doc/full_app_review_2026-05.md` §14.2 / §18.3 / §18.4.

Picking up the lower-risk, high-value deferred items as focused commits.

## Scope

| ID | Item | Sev | Commit | Status |
|----|------|-----|--------|--------|
| W4-1 | Settings `schemaVersion` + ordered migration runner (§14.2) — enables future field rename/removal without silent data loss | medium | A | 🔄 |
| W4-2 | Supply-chain: `renovate.json` (bun-aware) + non-blocking vuln-scan CI job (§18.3) | medium | B | ⬜ |
| W4-3 | Remove dead devDeps `@ai-hero/sandcastle`, `@typescript-eslint/parser`, `typescript-eslint` (§18.4 — no eslint config uses them; `typescript-eslint` appears only in a disable-comment) | medium | B | ⬜ |

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
- typecheck / bun test / bun start: (see log)

## Commit / release
- (pending)
