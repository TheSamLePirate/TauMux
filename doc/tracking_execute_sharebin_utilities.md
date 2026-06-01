# Tracking — execute_sharebin_utilities

## Plan

Implement ten new `shareBin` commands:

1. `show_logs`
2. `show_ports`
3. `show_http`
4. `show_sqlite`
5. `show_mermaid`
6. `show_csv_profile`
7. `show_proc`
8. `show_env`
9. `show_image_diff`
10. `show_openapi`

## Progress

- 2026-06-01 — Plan accepted in τ-mux sidebar.
- 2026-06-01 — Baseline inspected: existing `shareBin` scripts use Bun shebangs, `fullScreenHtml`, `fullScreenPage`, and helper modules under `shareBin/lib/`.
- 2026-06-01 — Added shared helper modules for subprocess execution, log parsing, CSV profiling, HTTP parsing, port parsing, process parsing, env diagnostics, and OpenAPI extraction.
- 2026-06-01 — Implemented Wave 1 commands: `show_logs`, `show_csv_profile`, `show_http`, `show_mermaid`, and `show_env`.
- 2026-06-01 — Implemented Wave 2 commands: `show_sqlite`, `show_ports`, and `show_proc`.
- 2026-06-01 — Implemented Wave 3 commands: `show_image_diff` and `show_openapi`.
- 2026-06-01 — Marked all new scripts executable and added helper coverage in `tests/sharebin-helpers.test.ts`.
- 2026-06-01 — Updated local `doc/system-sharebin.md` bundled-script table and queued website-doc follow-up in `doc/changes_to_document.md`.

## Deviations

- `show_mermaid` uses the Mermaid CDN initially rather than vendoring Mermaid.
- `show_sqlite` is read-only and static after render; arbitrary query execution is available only through `--query` at launch, not through an in-panel live query runner.

## Issues / risks

- Scope is large; first implementations will be focused and self-contained rather than exhaustive.
- `show_mermaid` uses a CDN Mermaid bundle initially unless vendoring is requested later.
- `show_ports` and `show_proc` rely on platform-specific command output and parse gracefully with tested fixtures.

## Validation log

- 2026-06-01 — Targeted smoke checks passed for all new commands (panel commands under a no-τ-mux env; JSON-capable commands with `--json`).
- 2026-06-01 — Render smoke checks passed with fake sideband fds for static panel commands and timed live checks for `show_ports` / `show_proc`.
- 2026-06-01 — `bun test` passed: 3083 pass / 0 fail.
- 2026-06-01 — `bun run typecheck` passed.
- 2026-06-01 — `bun start` launched in τ-mux split `surface:14`; metadata shows `electrobun dev` as foreground command with one listening port.
- 2026-06-01 — Ran required `bun run bump:patch`: 0.3.185 → 0.3.186.
- 2026-06-01 — Post-bump validation passed: `bun run typecheck` and `bun test` (3083 pass / 0 fail).

## Commit

- Initial implementation commit created: `8ac8733a` (`feat(shareBin): add developer inspector utilities`).
- Note: the commit was amended immediately after this line was added so the final branch tip hash may differ; use `git log -1` for the exact amended tip.
