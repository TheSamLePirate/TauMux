# Tracking — whole-repo docs sync

**Branch:** `docs/sync-app-state`
**Started:** 2026-08-08, from `55ada0c4` (v0.10.8)
**Goal:** make the descriptive `.md` files match the app as it actually is.

## Scope decision

"All the .md" is ~300 files once `website-doc/` (EN + FR) is counted, and they
are not all the same kind of document. Split:

| Class | Files | Action |
|---|---|---|
| **Descriptive** — claims about how the app works now | `README.md`, `CLAUDE.md`, `AGENTS.md`, `doc/system-*.md`, `website-doc/**` | Audited and corrected |
| **Historical** — a record of what was true on a date | `doc/tracking_*.md`, `doc/todos/*`, `.pi/plans/*`, `code_reviews/*`, `doc/full_app_review_*`, `doc/*_analysis.md` | **Left alone** |

Rewriting the second class to match today would destroy the record rather than
update it — a tracking doc that says "as of phase 3 we still used `ps`" is
correct *as history*, and editing it makes the repo's memory of its own
decisions worse. That distinction is the one judgement call in this task.

## What was wrong

The mechanical gate (`tests/docs-coverage.test.ts`, added 0.10.2) was **green
throughout** — every RPC method, CLI command and settings field was already
documented, EN and FR were in sync, and defaults matched. So the drift was
entirely in prose the gate cannot judge, concentrated in files the gate does
not cover at all.

| File | Last accurate | Drift found |
|---|---|---|
| `README.md` | v0.2.81 (2026-05-05) | Poller described as `ps` + `lsof`; 10 presets defaulting to Obsidian (really 12, default τ); "1500+ tests across 100 files" (really 3419 / 278); xterm 5.3 (really 6.0); Bun 1.3.9 (really 1.3.14); no mention of Claude/editor/extension/sharebin/telegram/plan/ask-user; 3 keybindings missing; RPC list missing 8 domains; settings missing 2 sections |
| `AGENTS.md` | older than CLAUDE.md | A stale *copy* — still claimed "No sandboxing of fd4 content" long after the sandbox shipped |
| `CLAUDE.md` | mixed | Same `ps`/`lsof` and test-count errors; architecture diagram missing most subsystems; "bundled with τ-mux 0.2.81" |
| `doc/system-process-metadata.md` | pre-0.4.8 | **Zero** mentions of the FFI path, despite being the "full spec". Perf table still quoted the ~125 ms subprocess tick |
| `doc/system-claude-integration.md` | v0.7.1 | Entire terminal-approval plane (0.10.0–0.10.8) absent |
| `doc/system-plan-panel.md` | 2026-04-28 | 0.10.5 card controls absent |
| `website-doc/**/changelog.md` | 0.10.0 | 0.10.1–0.10.8 absent (EN + FR) |

## Progress

- [x] Ground-truth pass: counted surface kinds (7), presets (12, default `tau`),
      RPC methods (139 / 17 domains), CLI commands (83), settings (62), tests
      (3419 / 278 files), deps, keybindings — all read from source, not docs.
- [x] `README.md` — rewritten against ground truth; added surface-kinds and
      agent-integrations sections.
- [x] `CLAUDE.md` — corrected; added the docs-drift-is-a-CI-failure constraint.
- [x] `AGENTS.md` — resynced byte-identical to `CLAUDE.md` with a keep-in-sync note.
- [x] `doc/system-process-metadata.md` — two-implementation table, self-validation
      contract, real per-tick costs, native-path troubleshooting.
- [x] `doc/system-claude-integration.md` — terminal approval plane in full.
- [x] `doc/system-plan-panel.md` — 0.10.5 card controls.
- [x] `website-doc` changelog EN + FR — 0.10.1 … 0.10.8.
- [x] `website-doc` claude-code integration EN + FR — question exclusion.
- [x] `website-doc` plan-panel EN + FR — clear control + step detail.
- [x] `doc/changes_to_document.md` — backlog cleared.
- [x] `bun test` (3419 pass), `bun run typecheck`, docs-coverage gate green.

## Pass 2 — website audit + build (commit `3666f8ff`)

Pass 1 (`5296628f`) folded the 0.10.x backlog into the site but did not audit
the rest of it. Building the site and walking its links found more:

- **Theme presets: 10 → 12, default Obsidian → `tau`.** Worse, three preset
  **ids** were wrong (`gruvbox-dark` / `solarized-dark` / `synthwave-84` are
  really `gruvbox` / `solarized` / `synthwave`), so anyone setting
  `themePreset` from the docs got an invalid value. The gate never caught this
  because it checks that *settings fields* are documented with correct
  defaults — `themePreset`'s default was right; its *possible values* were not
  checked at all.
- **`Copy on select` on `features/terminal.md`** — `copyOnSelect` is one of the
  ghost fields the 0.10.2 audit deleted from the settings reference. The
  reference to it survived on a page that names no settings key, so the gate
  saw nothing.
- **xterm.js 5.3 → `@xterm/xterm` 6.0** (landing + terminal page, EN + FR).
- **`features/settings.md` listed 8 sections; there are 9** (Layout missing),
  with several stale summaries.
- **Two broken internal links** — `cli/plan.md` + `fr/cli/plan.md` pointed at
  `/features/sidebar/`, a page that has never existed. Now
  `/cli/sidebar-and-status/`.

**Build result:** `bun run build` → 161 pages, exit 0, **zero** warnings or
errors. A link-walk over `dist/` reports **0 broken internal links** (was 2).

### Gap this exposes in the gate

`tests/docs-coverage.test.ts` checks *coverage* (is every method / command /
field mentioned) and *defaults*. It cannot see: enumerable value sets like
theme preset ids, prose on pages that name no settings key, or dead internal
links. Worth considering — none of it is in scope for this docs pass:

1. assert documented preset ids against `THEME_PRESETS`;
2. grep the site for `` `identifier` `` strings that look like settings fields
   and fail on ones absent from `AppSettings` (would have caught
   `copyOnSelect`);
3. run the link-walk in CI after the Astro build.

## Deviations / notes

- **`website-doc` build**: skipped in pass 1 (no `node_modules`), done in
  pass 2 — `cd website-doc && bun install && bun run build`. Passing on that
  the first time was the wrong call: the build is what surfaced the dead links,
  and installing deps is what made the preset/xterm audit worth doing.
- **Version bumped once, to 0.10.9, in pass 1.** Pass 2 (`3666f8ff`) did not
  bump again, contrary to the always-bump rule. Reason: 0.10.9 has never been
  released — both commits sit on the same unmerged branch and describe one
  docs sweep, so the version that eventually ships contains both. Bumping to
  0.10.10 for a link fix inside the same unreleased change would make the
  changelog claim two releases where there is one. Bump to 0.10.10 before
  merging if you'd rather each commit carry its own version.
- Two counts in the code disagree with the 0.10.2 audit note that produced
  them: RPC methods are 139 (the note says 138) and the audit's "100 files"
  test figure is long superseded. The gate passes either way — it asserts
  coverage, not the count — so the note is stale rather than the code wrong.
