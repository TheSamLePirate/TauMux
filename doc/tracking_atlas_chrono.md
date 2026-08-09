# Tracking — Atlas CHRONO (⌘G)

Plan: `doc/plan_atlas_chrono.md`. Six phases, each ending green on
`bun test`, `bun run typecheck`, `bun run lint` and the five audits.

## Status

| Phase | What | State | Commit |
|---|---|---|---|
| 1 | the lease | done | `db0bea17` |
| 2 | lanes and heads | done | (pending) |
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

## Phase 2 — lanes and heads

`chrono/{grid,lanes,head,gutter,header,view,chrono}.ts`, the CSS block at
the end of `index.css`, and the ⌘G rewire in `atlas/panel.ts` (the old
`AtlasOverlay` is gone — CHRONO replaces it outright).

### The core mechanic

`grid.ts` is pure: `readTerminalGrid()` turns a `Terminal` into
`{ rows, contentRows, alt }` and `anchorOffset()` turns that plus two
measured heights into a `translateY`. The rule is *last line on the
lane's bottom edge*, in both directions — content shorter than the lane
is pushed down onto that baseline, content taller is scrolled up past the
top. Every lane's last line therefore lands on the same edge, which is
what makes a column of different-height screens read as one instrument.

The alternate buffer anchors on `rows`, not on content: a TUI's frame is
the state, and re-anchoring as its status line cleared would make `vim`
slide by a row on every redraw.

`SurfaceManager.getSurfaceGrid()` is the one new accessor — only the
`Terminal` knows how many rows carry content, and the DOM that would
answer it (`.xterm-rows`) exists under the DOM renderer and not under
WebGL. Cell height *is* read from the DOM, off `.xterm-screen`, which both
renderers size identically.

### Heads, by surface kind

- **terminal** — leased, clipped, bottom-anchored. No `fit()`, no
  `pty.resize`, no second instance.
- **agent / claude / telegram / editor** — leased and sized to the lane
  box. These are DOM panes; letting them reflow is free and correct, and
  the plan's "never resize" rule is about the PTY.
- **browser / extension** — standby card. A native webview overlay and an
  iframe that reloads when reparented. Webviews are hidden while CHRONO
  is open, as the command palette already does.

### Deviations from the plan

- **A lane's height is data too.** The plan said "the focused lane
  expands; the others compress". Built that way first, and the result was
  a screen that was mostly empty frame: a shell showing two lines got the
  same band as a build printing forty. `distributeLanes` now water-fills
  against measured *demand* (`contentRows × cellHeight`), with the focused
  lane pulling `FOCUS_GAIN` harder on the surplus. Below `MIN_LANE_H` the
  field scrolls instead of shrinking further.
- **The gutter/head split owns the keyboard question.** The plan said
  "Esc closes" and "type into the real terminal", which collide the
  moment someone opens `vim` in a lane. Resolved by a rule that can be
  stated in one line — *the gutter is CHRONO's, the head is the pane's* —
  and by saying which one is live in the header instead of leaving the
  user to find out.
- **The shield.** Heads carry a transparent shield until entered. Without
  it, xterm claims the wheel (and in the alternate buffer converts it to
  arrow keys), so scrolling the field past a `vim` lane moved `vim`'s
  cursor.
- **Bloom is hidden, not suspended,** while a pane is leased — one
  `!important` against the inline `display` that `TerminalEffects`
  writes. Suspending it properly needs a second `SurfaceManager`
  accessor to restore the right state on release, and the overlay is
  transient.
- **The header landed complete,** filters included, rather than being
  split across phases 2 and 4. Wiring them was three lines against the
  existing `applyFilter`; deliberately deferring that would have been
  rework, not sequencing.

### Verification

`tests/chrono-lanes.test.ts` (31) covers the pure half. The handover
itself cannot be proved without a real xterm and a real PTY, so
`tests-e2e-native/specs/chrono.spec.ts` (6) drives the actual app: ⌘G
borrows every live pane, Escape and ⌘G both give them back laid out,
the terminal still takes input afterwards, a pane closed *while borrowed*
does not strand the others, a terminal head is a live screen, and a
browser head stands by.

`__test.readChronoState` is the probe behind those — a typed, read-only
readout in the same shape as `readWebviewState`, not an eval hook.

`@design-review` gains `scenario-chrono-field`, because a still of this
view is only worth anything with real output behind it.

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

3. **Anchoring on content vs. on the grid.** First cut anchored every
   buffer on its last non-blank row, which would make `vim`'s frame slide
   by a row whenever its status line cleared. Alt buffers now anchor on
   `rows`.

4. **`claudeBlock()` in `tests/claude-pane-design.test.ts` sliced the
   stylesheet to end of file**, so the first section appended after the
   Claude pane inherited its assertions — CHRONO failed three of them
   without touching a line of that pane. Bounded to the next top-level
   banner.

5. **The scroller's own padding overflowed the field.** Lane heights are
   distributed against `clientHeight`, which *includes* padding, so 24 px
   of it pushed the last lane past the window edge on every open.

6. **Two scrollbars had to go**: xterm 6's VS-Code-derived
   `.xterm-scrollable-element > .scrollbar` inside each head, and the
   field's own, which drew a chrome rail straight down the *now* edge.

7. **The overlay covers the titlebar**, so the header had to leave the
   macOS traffic lights their corner (84 px) — §11 says they stay stock.
