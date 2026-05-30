# Tracking — fix + wire the broken eslint config

Started: 2026-05-30. Follow-up flagged in `tracking_wave4_deferred_maintainability.md`.
Source: `doc/full_app_review_2026-05.md` §18.4 (corrected — see Wave 4 tracking: the deps were NOT dead; the real gap is eslint configured-but-broken-and-unwired).

## Root cause
`eslint.config.js` existed but `eslint .` emitted **22,023 problems over ~1.1M lines**. Diagnosis:
- **21,423** of them came from eslint crawling `.claude/worktrees/` (git worktrees = full repo checkouts with their own `tsconfig.json` + `node_modules`) and other non-source trees — the config's `ignores` only covered `node_modules/ build/ dist/`.
- The remaining ~600 were all the **same** fatal parser error: *"No tsconfigRootDir was set, and multiple candidate TSConfigRootDir"* — the worktrees' tsconfigs gave `typescript-eslint`'s parser multiple candidate roots, so it failed to parse EVERY file (including real `src/`).
- `eslint` core was also not a direct devDep, and there was no `lint` script / CI step.

**The project's authored code was already lint-clean** — `eslint src` reported 0 problems; only ~5 unused-var *warnings* existed across tests/scripts.

## Fix
- `eslint.config.js`: comprehensive global `ignores` (`.claude/`, `assets/`, `vendor/`, `coverage/`, `test-results/`, `.design-artifacts/`, `website-doc/`, `shareBin/`, `.sandcastle/`, `**/*.d.ts`, plus build/dist/node_modules) + explicit `parserOptions.tsconfigRootDir = import.meta.dirname` (silences the multiple-candidate fatal). Also widened `no-unused-vars` ignore to `varsIgnorePattern: ^_`.
- Fixed the 5 real unused-var warnings (removed dead imports/vars/a nonsensical `never` type; renamed an unused arg to `_opts`) so `eslint .` is **0 problems**.
- Added `eslint` as a direct devDep (`^10.2.0`, the resolved version) + `lint` / `lint:fix` scripts.
- CI: a blocking **Lint** step in the static-checks job (`bun run lint`).

## Verification (2026-05-30)
- `bun run lint`: ✅ **0 problems, exit 0** (was 22,023). Lints 200+ authored source files; no worktree/vendor noise.
- `bun run typecheck`: ✅ clean. `bun test`: ✅ **2989 pass / 0 fail**. `bun audit`: still clean.

## Notes / follow-ups
- Pinned `eslint ^10.2.0` (the already-resolved version); it lints clean with `typescript-eslint@8`. If a peer-range warning ever surfaces, pin eslint to `^9` instead.
- The ruleset is `tseslint.configs.recommended` (non-type-aware — fast). A future, more thorough pass could enable type-checked rules (needs `projectService`/`project`) and triage the additional findings; deferred to keep this change clean.

## Commit / release
- (recorded below)
