# Web Mirror Parity — Progress Tracker

Plan: `~/.claude/plans/make-the-http-web-logical-lynx.md`
Goal: bring `src/web-client/` to UI/UX parity with `src/views/terminal/` (sidebar full, bottom bar, same style, better layout parity — nothing more).

## Milestones

| Milestone | Status | Commit | Date | Notes |
| --- | --- | --- | --- | --- |
| M11 — theme + settings broadcast | done | `7d8e097` | 2026-05-05 | 0.2.85; theme/font/density now reach browser; sensitive fields dropped by `pickWebSettings`; 1670 tests pass |
| M12 — bottom status bar | done | `4db592c` | 2026-05-05 | 0.2.86; status-keys + status-render + Meter extracted to `src/shared/`; native-only `model`/`kind` keys via `registerStatusKey()`; web mirror gains three-zone bottom bar; 1676 tests pass |
| M13 — sidebar workspace cards (sparkline, cwd, panes) | not started | — | — | — |
| M14 — manifest cards (npm + cargo) | not started | — | — | — |
| M15 — notification overlay (per-surface) | not started | — | — | — |
| M16 — pane chrome + paneGap + focus tokens | not started | — | — | — |
| M17 — plan panel placement + logs polish | not started | — | — | — |

Status legend: `not started` · `in progress` · `blocked` · `done`.

## Pre-flight architectural moves

These extractions un-block multiple milestones. Track separately so they can land before the milestone that needs them.

| Move | Status | Commit | Notes |
| --- | --- | --- | --- |
| Icons → `src/shared/icons.ts` | not started | — | needed by M14/M15; web client has its own minimal icon set today |
| `buildSidebarWorkspaces` → `src/shared/sidebar-state.ts` | not started | — | needed by M13 |
| Status renderers → `src/shared/status-render.ts` | done | `4db592c` | M12 — re-export shim left in `views/terminal/status-renderers.ts` |
| Status key registry → `src/shared/status-keys.ts` | done | `4db592c` | M12 — `model`+`kind` re-registered in `views/terminal/native-status-keys.ts` |
| Meter primitive → `src/shared/tau-meter.ts` | done | `4db592c` | M12 — `tau-primitives.ts` re-exports |
| Manifest card → `src/shared/sidebar-manifest-card.ts` | not started | — | needed by M14 |
| Notification overlay → `src/shared/notification-overlay.ts` | not started | — | needed by M15 |
| Pane chips → `src/shared/pane-chips.ts` | not started | — | needed by M16 |

## Per-milestone gates

Each milestone must clear before bumping:
- [ ] `bun test` green
- [ ] `bun run typecheck` green
- [ ] `bun start` smoke (manual exercise listed in plan)
- [ ] `bun run bum:patch`
- [ ] one-liner appended to `doc/changes_to_document.md`
- [ ] this tracker updated with commit id + date
- [ ] (M14, M16 only) `bun run report:design:web` + baseline refresh if needed

After M17:
- [ ] `tests-e2e/web-mirror-parity.spec.ts` (Playwright) added and green
- [ ] `bun run bum:minor` to mark parity feature complete

## Deviations & issues

(Append entries dated `YYYY-MM-DD` with milestone tag and commit id when the actual work diverges from the plan.)

## Deferred to v1.1+

- `runScript` from manifest action buttons in web mirror (currently logs + toasts only) — entry pending in `doc/deferred_items.md`.
- `onSelectWorkspaceCwd` server-side round-trip (web v1 mutates only its local manifest projection).
- `model` / `kind` status-bar keys in shared registry (depend on agent panel state; out of scope).
