# Tracking — Atlas CHRONO (⌘G)

Plan: `doc/plan_atlas_chrono.md`. Six phases, each ending green on
`bun test`, `bun run typecheck`, `bun run lint` and the five audits.

## Status

| Phase | What | State | Commit |
|---|---|---|---|
| 1 | the lease | done | `db0bea17` |
| 2 | lanes and heads | done | `6c3f1afb` |
| 3 | the field | done | `ecf41f3f` |
| 4 | the gutter | done | `9df276f8` |
| 5 | polish | done | `f0b5c971` |
| 6 | docs | done | `d06fd884` |

### Round 2 — user feedback, 2026-08-09

| What | Commit |
|---|---|
| fit, timebase, cursor, context ribbon | `344b021b` (v0.21.0) |
| every action on the axis, plan as a shape | `52b89e55` (v0.22.0) |
| docs for both | `b203d5ab` |

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

## Phase 3 — the field

`chrono/{event-log,field,sources}.ts`, `ChronoStrikeRail` in
`chrono/header.ts`, `tests/chrono-field.test.ts`.

### The event log

The gap the plan identified: phase transitions are *known* but never
timestamped into a ring — `claude-session-store` holds the current phase,
not the moment it changed. `event-log.ts` is that ring: bounded (256),
TTL'd (120 s), in-memory, no timers, deduped on
`kind:surfaceId:text` inside 900 ms because the stores re-push whole
snapshots and four rules a pixel apart is not four approvals.

`sources.ts` is the watcher that fills it, and it distinguishes two
shapes of source on purpose:

- **Derived** (Claude phases, notifications) — a diff against what was
  last seen, stamped with the moment we noticed. `seed()` primes it on
  open, so opening during a long turn does not strike "turn started" at
  *now* for a turn that began four minutes ago.
- **Authored** (`ht atlas mark`) — carries its own `at` and its own id,
  so it is replayed at its real time and deduped by id. Deliberately
  *not* primed by `seed()`: a mark's timestamp is the whole reason an
  agent writes one.

Not every transition earns a rule. `idle → working` and `working → idle`
are turn boundaries and matter; `compacting → working` is bookkeeping,
and `ended` is already said by the lane disappearing.

### Redraw only when the image would differ

`fieldSignature()` folds every input that can change a pixel — geometry,
lane identity and colour, each ring's length and last sample, the strike
set — into one string, and pointedly *not* `now`.

The subtlety the plan did not reach: while there **is** a skyline in the
window, the image genuinely does change every frame, because it scrolls
leftward. So the signature carries a coarse clock — but only then. The
controller therefore ticks at three speeds: 220 ms while a pane is
producing output, 900 ms while the window merely still holds something,
and **not at all** once the window is empty. Ninety seconds after the
last byte, an idle τ-mux is completely still again.

`tests/chrono-field.test.ts` pins that: *an idle field advances its clock
and does not repaint*, a non-zero sample invalidates, a skyline keeps it
moving, and it goes still again once that skyline has drained.

### Deviations from the plan

- **Strike labels live in a fixed rail below the field, not on the
  canvas.** The canvas scrolls with the lanes and can be taller than the
  window; a label that scrolls off is a label that is not there when it
  is wanted. Labels are also thinned — four approvals in eight seconds
  draw four rules, which is the truth and is legible, but four
  overlapping words is a smudge.
- **Bars, not a polyline.** At one sample a second a polyline reads as
  noise; bars read as a skyline, and a bar can carry its own age as
  colour, which *is* the phosphor.
- **Log scale.** A linear one puts a 2 KB/s log tail and total silence in
  the same pixel, which loses exactly the distinction the trace exists to
  draw.

---

## Phase 4 — the gutter

Most of the channel strip landed in phase 2 (it is what a lane *is*, and
a lane without one is not a lane). What this phase added is the rest of
the loop: hover previews and click commits into the shared
`AtlasInspector`, and a footer that gives both the inspector and the
strike legend a home.

### Deviations from the plan

- **Satellites are chips in the strip, not markers attached to the
  lane.** The plan said "satellites, attached to their lane"; at lane
  scale — down to 84 px — a second row of positioned markers would
  collide with the trace. They *are* attached to their lane: in its
  gutter row, where the lane's identity already lives.
- **No per-satellite selection.** Ports, processes, plan steps and
  subagents are a glance in the gutter and a detail in the inspector,
  which already lists all of them for the selected lane. Making each chip
  separately clickable would mean nesting controls inside the lane's own
  `role="option"` button for information the card already carries.
- **The footer is a row, not a floating card.** First cut docked the
  inspector over the bottom-left of the field; it covered the bottom
  lane's channel strip. Hiding one lane's identity in order to explain
  another is the wrong trade in a view whose subject is *all* the lanes
  at once.
- **The inspector's sparkline is hidden here.** The whole view is a time
  series. A second, tinier one in the corner is exactly the "two channels
  for one fact" the brief rules out — and the 26 px it costs is what the
  actions need to stay on screen.
- **The strike legend stacks instead of thinning.** Phase 3 shipped one
  label per cluster; that left the footer's right-hand two thirds empty
  and threw away information. Labels now drop to the next row when they
  would collide, up to four rows, and carry the event's text as well as
  its kind.

---

## Phase 5 — polish

- **Keyboard.** ↑/↓ walk the lanes and clamp at the ends (a field you can
  fall off the bottom of is a field you lose your place in); Enter goes
  to the selected pane *and closes*, because going to the pane is the
  point; Escape closes unless the user has stepped into a head, where it
  belongs to the terminal; ⌘G always closes. Home/End jump the ends.
- **Reduced motion.** Everything that moves here is data — the traces
  advance because bytes arrived, the lanes resize because a pane has
  more to show — so none of it is removed: taking it away would take the
  readings with it. What goes is the one piece of pure chrome, the open
  fade.
- **No new keyframes.** The entrance is a class-flipped transition, so
  the animation audit needs no new entry and CHRONO adds nothing to the
  §10 budget.
- **A11y.** The field is a `role="listbox"` of `role="option"` lanes on a
  roving tabindex; the lane rows between them are `role="presentation"`
  so the relationship the roles claim is the one that exists. The canvas
  is `aria-hidden` — it carries nothing the gutter does not say in
  words. Heads sit *outside* the option buttons: a terminal nested in a
  control would put the whole pane in the tab order and swallow its keys,
  which is also why CHRONO does not use `ModalHost` — its focus trap
  would eat Tab-completion in a live shell.
- **Stale references removed.** The Atlas column's expand button, the
  inspector's overflow hint, the ⌘G binding description and the CSS
  banner all still described the topology overlay that no longer exists.

---

## Phase 6 — docs

- `website-doc` EN + FR: the ⌘G section of `features/layout-variants` is
  rewritten from "expanded topology" to CHRONO, with the ASCII sketch,
  the head/lease explanation, the keyboard rule and the motion contract.
  `configuration/keyboard-shortcuts` and both page descriptions follow.
- Changelog entry, EN + FR.
- `doc/system-webview-ui.md` gains § 7b — the lease invariants, the
  viewport mechanic, the head-kind table, who owns the keyboard, the
  three refresh cadences, and where events come from.
- `doc/changes_to_document.md` — CHRONO's entry cleared.

---

## Round 2 — "make it better"

The brief: context % on the chart, an interactive chart, a zoomable
smart timeline, every action on it, a stunning plan view — and a real
defect, terminals losing their last characters.

The design lens for this round was **test equipment**, not "sci-fi HUD".
CHRONO is a time-domain instrument, so the vernacular that fits it is a
scope's: a graticule, a detented timebase, a phosphor trace, a cursor
you park on the waveform and read a value off. Every decision below
falls out of that, and it is a specific world rather than a generic one.

### The fit (the reported defect)

A leased terminal keeps the columns it was fitted to at home, so a wide
pane in a narrower lane lost its right-hand end — usually the half of a
log line that says what went wrong. `fitScale` scales it uniformly to the
lane's width; `anchorOffset` takes the scale so the bottom anchor still
lands. Measured with `offsetWidth/Height` rather than a bounding rect,
because a rect is *post*-transform and would feed last frame's scale into
this frame's. Never scales up, so the common case stays pixel-exact, and
stops at 0.6 rather than turning "some characters missing" into "all
characters unreadable".

### The timebase

`timebase.ts`: a detented ladder (10 s … 5 m), because a
continuously-variable window makes every reading incomparable. Division
counts are chosen per span so every graticule line lands on a round
number of seconds. `metrics-history` grew from 90 to 300 samples to back
the widest rung — a rung that shows an empty field is a rung that lies —
and the river is now pinned to 90 s explicitly rather than inheriting the
ring's capacity.

### The cursor and the readout

The signature interaction, and the one thing the traces could not do:
shape without a readable value is a picture. The readout *replaces* the
ruler rather than sitting beside it — both answer "where on the time axis
am I", and two answers to one question is how an instrument becomes a HUD.

### Every action

`activity.ts` reuses `digestClaudeEvent`, the decoder the Claude pane's
transcript already runs. A second decoder would drift the day the SDK
renames a field.

The judgement that matters is what earns a rule: deltas do not (a strike
per token is a fill pattern), a tool *succeeding* does not (the start was
the action), a tool *failing* does. Tool calls draw at a third weight
because they outnumber everything else by an order of magnitude. The
rail's labels rank by weight before recency — a turn is a prompt followed
by a dozen tools, and ordering by time alone labels the tools and not the
prompt that caused them.

### Deviations from the brief

- ~~**The plan is not on the time axis.**~~ *Resolved in round 3 — see
  below. The original reason held: `PlanStep` carried no timestamp, so
  the fix was upstream rather than a workaround in the view.*
- **The window zooms in, not out past five minutes.** Bounded by what the
  rings hold rather than by taste.
- **No pan.** The window always ends at *now*. CHRONO is a live
  instrument; a window that can drift off the present needs a "return to
  now" affordance to undo a gesture nobody asked for.

---

## Round 3 — plan steps on the axis

The user's answer to "the honest fix is upstream": yes, timestamp them.

### The data

`PlanStep` gains `startedAt?` / `endedAt?`. `PlanStore.stampStep` owns the
rules, and each one exists because getting it wrong is silently wrong:

- **`waiting` clears both.** A step reset to waiting has no history left
  to claim, and a `startedAt` on it would draw a bar for work nobody did.
- **`active` keeps or assigns the start and clears the end.** Re-opening
  a finished step means it is running again.
- **`done` / `err` keep or assign both.** A step that jumped straight
  from waiting to done still happened at a moment; equal start and end
  draws a tick, not a lie about duration.
- **Existing stamps always win.** This is the one that matters: agents
  call `ht plan set` with the whole list on every change, so re-deriving
  would reset a plan's entire history each time one box was ticked.
- **A publisher's own stamps beat ours.** `claude-plan-mirror` passes
  Claude's `createdAt` / `completedAt` straight through — the agent's
  clock is truer than the moment τ-mux next looked.

### The drawing

`AtlasNode.span` is the general carrier ("this node occupies a stretch of
time and knows it"), filled for plan steps and — free — for subagents.
`field.ts` draws a plan track riding the top of a lane's band, and the
trace yields it that room rather than drawing through it.

A running step's bar has no right edge and grows toward *now*, which also
means the field keeps repainting for as long as one is running. That is
motion caused by data, so it is allowed; a plan with nothing running goes
still like everything else.

Labels ellipsize rather than clip: a name cut mid-glyph by a clip
rectangle reads as a rendering fault.

### Deviations

- **A workspace-level plan rides its bracket's first lane.** `ht plan set`
  without an agent id anchors to the workspace, which is a bracket here
  and not a row, so it has no band of its own. The first lane of the
  bracket is the row the cap already marks.
- **Plan-step strikes were removed, except failures.** The bars say
  everything a "step done" rule said and say the duration too; drawing
  both was the same fact twice. A failure still strikes — it is the thing
  you stop for.

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

9. **The arrow-key spec assumed the wrong end.** CHRONO opens on the
   focused pane, which after a split is the *last* lane — so ArrowDown
   correctly clamped and the test read that as a broken key. The clamp
   is now asserted deliberately rather than tripped over.

8. **`seed()` swallowed the marks.** Priming every source on open is
   right for derived state and wrong for authored state: a mark carries
   its own timestamp, so priming it threw away the one thing that made
   it drawable. Caught by looking at the render — the strikes simply
   were not there.
