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

## Deviations / notes

- **`website-doc` was not built.** `website-doc/node_modules` is absent and a
  full Astro install was out of proportion to a prose change. The content is
  verified by `tests/docs-coverage.test.ts` and by matching the existing
  `:::note` directive usage already present in the same files. If a build is
  wanted: `cd website-doc && bun install && bun run build`.
- **Version bump is `patch`.** Docs-only; no behaviour changed.
- Two counts in the code disagree with the 0.10.2 audit note that produced
  them: RPC methods are 139 (the note says 138) and the audit's "100 files"
  test figure is long superseded. The gate passes either way — it asserts
  coverage, not the count — so the note is stale rather than the code wrong.
