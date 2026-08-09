# Tracking — Atlas CHRONO (⌘G)

Plan: `doc/plan_atlas_chrono.md`. Six phases, each ending green on
`bun test`, `bun run typecheck`, `bun run lint` and the five audits.

## Status

| Phase | What | State | Commit |
|---|---|---|---|
| 1 | the lease | done | (pending) |
| 2 | lanes and heads | not started | |
| 3 | the field | not started | |
| 4 | the gutter | not started | |
| 5 | polish | not started | |
| 6 | docs | not started | |

---

## Phase 1 — the lease

`src/views/terminal/chrono/screen-lease.ts` + `tests/chrono-screen-lease.test.ts`.

Shipped alone and proven before anything is built on it, because this is
the phase that can strand a user's panes.

Covered: move · idempotent re-borrow · re-borrow into a new slot keeps
the original return address · release restores parent, sibling order,
inline style and `layoutSig` · double release · release of an unknown
surface · a surface closed while leased is *dropped*, not resurrected ·
a recorded sibling that vanished mid-lease falls back to append ·
`releaseAll()` survives a pane closed mid-flight.

### Deviations from the plan

- **`chrono/` not `deck/`.** The plan named the file
  `deck/screen-lease.ts`, a leftover from the floating-screens direction
  the plan itself records as rejected. One directory per feature, named
  after the feature.

### Host contract (`surface-manager.ts`)

`applyPositions` now skips containers carrying `data-chrono-lease`. Without
it, a window resize while CHRONO is open would write pane rects onto
borrowed containers and the lane geometry would fight the tiling layout.
The flag name is exported as `LEASE_FLAG` from the lease module so the
coupling is greppable from both ends.

### Incidental

`defaultGlassTheme` moved out of `surface-manager.ts` into
`terminal-options.ts` as `DEFAULT_PANE_THEME` — it is the other half of
"how a pane's terminal is constructed", and it was spending 26 lines of
a module-size ratchet that CHRONO needs a few of. No behaviour change.

---

## Issues met

1. **`applyPositions` clobbering leased containers.** Found by reading
   rather than by failure: the layout pass is the only thing that writes
   pane geometry, and it runs on window resize. Fixed by the `LEASE_FLAG`
   guard, which is also why the flag lives in the lease module.

2. **Module-size ratchet.** `surface-manager.ts` had 13 lines of headroom
   and CHRONO needs ~10 across two changes. Rather than promote the
   baseline (which would defeat a one-way valve), `DEFAULT_PANE_THEME`
   moved to `terminal-options.ts`.
