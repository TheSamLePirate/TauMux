# Tracking — H11: unify the forked sidebar leaf formatters

Source: `doc/full_app_review_2026-05.md` §3.2 (H11, high).

## Scope decision

H11 in full is the unification of the entire workspace-card DOM builder set
(native `buildCardHeader/MetaRow/StatRow/CwdRow/PanesList/StatusGrid/
ProgressBar` ≈ 580 lines vs web `buildHeader/Meta/Stats/Cwds/Panes/Status/
Progress` ≈ 250 lines) — a large, two-DOM-idiom refactor. The review explicitly
advises: *"Start by unifying the leaf helpers (`shortCwd`/`shortenCwd`,
`humanRss`/`formatMem`) since the divergence there is clearly a bug."*

This pass does exactly that slice — the leaf formatters — and **defers the full
card-DOM builder hoist** (tracked below as the H11 remainder). The leaf fix is
where the divergence is a genuine, user-visible bug; the DOM hoist is mechanical
de-duplication better done as its own focused change with a design-report pass.

## The bug

Two implementations produced **different strings for the same input**:

| input | native (shortCwd / humanRss) | web (shortenCwd / formatMem) |
|---|---|---|
| `/Users/me/dev/app/src` | `…/app/src` | `~/dev/app/src` |
| 512 KB RSS | `512K` | **`0M`** (Math.round(0.5)) |
| 2048 KB RSS | `2.0M` | `2M` |

The web mirror is advertised as a parity surface, so this drifts on every card
change. Web's `0M` for any sub-MB process is an outright bug.

## Fix

- **New `src/shared/sidebar-format.ts`** — pure `shortenCwd(cwd)` + `formatRss(kb)`
  adopting the **native** behavior as canonical (native is the primary surface
  and its strings are stronger: real K display, decimals). 
- **Native `src/views/terminal/sidebar.ts`** — deleted the local `shortCwd` /
  `humanRss`, import the shared fns. Output is **byte-identical** to before, so
  no native rendering / design-baseline change. (`humanFileSize`, a bytes-based
  helper unrelated to the divergence, stays local.)
- **Web `src/web-client/sidebar/workspace-card.ts`** — deleted the local
  `shortenCwd` / `formatMem`, import the shared fns. Web now matches native:
  compact `…/last2` cwds and correct sub-MB RSS (`512K`, not `0M`).

## Verification

- `bun run typecheck` — clean. `bun run lint` — 0.
- `bun test tests/sidebar-format.test.ts` — 10 pass (cwd whole/collapse/trailing
  cases; RSS sub-MB K, MB/GB decimal-vs-round, the 1 MiB boundary, and the
  ex-`0M` bug pinned to `512K`).
- `bun test` — 3035 pass / 0 fail (+10).
- `bun start` — web-client bundle rebuilds with the shared import resolved;
  app boots clean.

## Deferred — the H11 remainder

The card-DOM builders themselves are still forked. Next step (own change):
hoist `buildCardHeader/MetaRow/StatRow/CwdRow/PanesList/StatusGrid/ProgressBar`
into `src/shared/sidebar-card-render.ts` as pure builders taking `WorkspaceInfo`
+ a deps bag (`createIcon`, callback hooks) — the pattern `notification-overlay.ts`
and `sidebar-manifest-card.ts` already follow — and run `bun run
report:design:web` to confirm pixel parity. Larger and design-sensitive, so kept
separate from this clearly-a-bug leaf fix.

## Commit

- bump: `bun run bump:patch`
- commit: (filled at commit time)
