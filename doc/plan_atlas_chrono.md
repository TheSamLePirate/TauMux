# Plan — Atlas CHRONO (⌘G)

Brief: *"make the ⌘G view much more stunning. Terminal panes abstracted and
visible as term screens (effect, resize, free move). Terminal inputs, with
full features, also abstracted. Stunning sci-fi AAA UI, innovative
cinematic hacker style."* — refined mid-flight to: *"I really want that
⌘G view be different of everything we have seen."*

Decisions taken with the user:

| Question | Answer |
|---|---|
| Direction | **CHRONO** — time is the room |
| Motion | **Everything is data** — an idle τ-mux is completely still |
| Resize semantics | Visual only; `pty.resize` is never called by this view |
| Browser / extension panes | Standby card + open action (they are native webviews) |
| Deep detail | Satellites, attached to their lane |
| Input | Type into the real terminal directly |

## Why not the canvas

The first plan was floating draggable screens on a dark canvas, wired
together, with satellites and an inspector. It delivered "free move +
resize" literally. It was also Mission Control with better typography —
the answer I would reach for on any brief containing the word *cinematic*,
and therefore the wrong one for this brief. Recorded here so nobody
re-derives it.

Free move is gone as a consequence, deliberately. In CHRONO an item's
position **means something** — where it sits on the x axis is *when* it
happened — so dragging it would be like dragging a point on a graph.

---

## 1 · What it is

⌘G opens a **time field**. The horizontal axis is the last 90 seconds,
with *now* pinned at the right edge.

Every pane is a **lane**. A lane's live terminal sits at *now*; behind it,
stretching left into the past, runs the pane's own output history as a
decaying phosphor trace. Events — an agent's turn boundary, an approval, a
notification, an `ht atlas mark` — strike **vertically across every lane at
once**, at the moment they happened.

The question it answers, that nothing else in τ-mux can:

> *What has been going on, and what reacted to what?*

The column tells you the state of things now. CHRONO tells you the shape of
the last minute and a half, and lets you type into any of it.

Nothing else does this because nothing else has per-pane byte history to
draw. The meter and the 90-second rings already exist — this view is what
they were worth building for.

---

## 2 · Design plan

### Colour

Unchanged TAU. The ratio is what's new: CHRONO is ~92 % void, and the only
saturated things on screen are traces and live text. Cyan for human lanes,
amber for agent lanes, the state palette for event strikes.

Two new tokens:

```
--tau-chrono-trace-hot    the leading edge of a trace (near-white bloom)
--tau-chrono-strike       the vertical event rule
```

### Type

One register only: mono, 9–11 px, uppercase and tracked (`0.18em`) for lane
labels and time ticks, tabular for numbers.

No sans anywhere. Every glyph here sits beside real terminal output; a
proportional face next to a character grid reads as a mistake. The terminal
text itself is the user's own font at their own size and is never restyled
(§11).

### Layout

```
┌ CHRONO ──────────────────── all agents live alert ②      esc ────────┐
│ ◀──── 90s            60s            30s              now ────────────│
│                       ╷              ╷                ╷              │
│ ▎crazyShell                                                          │
│ ▎ zsh          ·······································  ╭──────────╮ │
│ ▎ :3000 4102                                            │ live      │ │
│ ▎                                                       ╰──────────╯ │
│ ▎ bun test     ▁▂▅███▇▃▁▁▁▁▂▅████▆▂▁▁▁▁▁▁▂▃▅▇███▆▃▁▁▁▁  ╭──────────╮ │
│ ▎ 74%  4190                                             │ live      │ │
│ ▎                                                       ╰──────────╯ │
│ ▎ claude-code  ▁▁▁████▁▁▁▁▁▁▁▁███████▁▁▁▁▁▁▁▁▁▁▅███▁▁▁  ╭══════════╗ │
│ ▎ 78% $1.42                                             ║ live      ║ │
│ ▎ plan ▪▪▫                                              ╚══════════╝ │
│                       ╵              ╵                ╵              │
│                     turn          approval          mark             │
└──────────────────────────────────────────────────────────────────────┘
      gutter              the past                    now
```

- **Left gutter** — the channel strip. Workspace bracket, lane name, and the
  satellites that used to be tree children: ports, pid, CPU, context %,
  cost, plan progress.
- **The field** — one trace per lane, plus vertical event strikes shared by
  all lanes.
- **The heads** — at *now*, each lane's live terminal, clipped to the lane's
  height and anchored to its **last line**. An unfocused lane still shows
  its most recent rows, live.
- **The focused lane expands**; the others compress. One tall screen, the
  rest readable at a glance.

Workspaces are brackets in the gutter, not boxes drawn around lanes — the
field must stay a single continuous time space or the shared x axis stops
meaning anything.

### The core mechanic — a viewport onto a live terminal

This is what makes the whole thing possible, and it is almost free:

The real `.surface-container` is reparented into its lane head. The lane is
`overflow: hidden` and the terminal is positioned **bottom-aligned**, so a
lane 6 rows tall shows the last 6 lines and a lane 24 rows tall shows 24 —
of the *same* terminal, with no resize, no second instance, and no PTY
involvement at all.

Focus therefore costs nothing: expanding a lane just reveals more of a
terminal that was already there and already live.

### Signature

**The trace is the pane's own voice, and the terminal is its head.**

A lane's trace is drawn from the real byte-rate ring with *phosphor
persistence*: the leading edge blooms near-white, and each sample decays
back through the lane's identity colour as it ages leftward. A pane that
has been silent draws a flat hairline. A pane running `bun test` draws a
skyline.

The vertical strikes are the second half of the idea: because every lane
shares one x axis, an approval landing at t−40 s is a single rule crossing
all three traces, and you can *see* which panes went quiet and which woke up
when it happened. Causality becomes visible geometry.

### The critique pass

Three things cut to keep this from drifting into the generic:

- **No wires.** The tree is expressed by gutter brackets; the byte-flow
  signature now lives in the traces themselves. Two channels for one fact
  would be decoration.
- **No perspective floor, no ambient drift, no neon borders.** Motion is
  data (see below), and a glow that is the same on every lane says nothing.
- **The trace is not a sparkline widget.** A sparkline sits *beside* a
  label; here the trace *is* the lane, the terminal is its head, and the
  axis is shared across every pane. That relationship is the design.

### Motion — the discipline

"Everything is data" has a sharp consequence for a time axis: time always
advances, so a naïve implementation repaints forever.

The resolution: **the field is redrawn only when the image would differ.**
A silent system's trace is a flat line whose shift is indistinguishable from
itself, so nothing repaints. A non-zero sample entering, an event striking,
or a lane changing height are the only things that invalidate.

An idle τ-mux therefore shows an honest time axis and does **zero** work per
second — the same rule the column already keeps.

---

## 3 · Architecture

### The lease

There is one `Terminal` per surface, so a live head is the real container,
moved. `deck/screen-lease.ts` owns `{ el, parent, nextSibling }` per surface
with an idempotent `release()`.

Invariants, because getting these wrong strands the user's panes:

1. The view never holds a container it cannot give back.
2. `destroy()` releases every lease, including on the error path.
3. Esc, ⌘G, workspace switch, surface close and app teardown all route
   through one close path.
4. A surface closed while leased releases first, then closes.

### What is never touched

- `pty.resize` — lane height changes the *viewport*, not the terminal.
- The terminal's font, theme, renderer, or scrollback.
- The pane tree. CHRONO reads `buildAtlasSnapshot({ deep: true })` exactly
  as the current overlay does; only presentation changes.

### Native webviews

Browser and extension panes cannot be reparented or clipped. They are hidden
on open (`hideBrowserWebviews()`, as the command palette already does) and
restored on close. Their lane still draws a trace — throughput is measured
for every surface — and the head renders as a **standby screen** with title,
URL and a "go to pane" action.

τ-mux has no in-webview page capture: `ht screenshot --surface` grabs the OS
window and crops, which needs the pane visible, and CHRONO covers it. A real
still is only obtainable *before* open. Deferred to a later phase as an
opportunistic nicety, never on the critical path.

### Data

Nothing new is needed.

| Need | Source |
|---|---|
| Traces | `metrics-history` (90-sample rings, already sampled) |
| Trace decay + head bloom | `throughput-meter` |
| Event strikes | `claude-session-store` (turns, approvals, errors), notifications, `atlas-annotation-store` marks |
| Gutter satellites | `AtlasSnapshot` nodes — `process`, `port`, `plan-step`, `subagent` |
| Inspector on selection | `AtlasInspector`, unchanged |

**Gap to close:** events currently have no timeline. Session phase
transitions are known but not *timestamped into a ring*. Phase 3 adds a
small `event-log.ts` — a bounded, in-memory, TTL'd list of
`{ at, kind, surfaceId, text }` fed from the stores that already emit. Same
shape and discipline as `metrics-history`.

---

## 4 · Phases

Each ends green: `bun test`, `typecheck`, `lint`, five audits.

**Phase 1 — the lease.** `screen-lease.ts` alone, no visuals. Tested for
move, release, double-release, release-on-destroy, release-on-surface-close.
This is the phase that can break the app, so it ships proven and by itself.

**Phase 2 — lanes and heads.** The field with real terminals bottom-anchored
in clipped lanes, focus expands, typing works. No traces, no strikes.
Verified by hand in the real app: type, run `vim`, `ctrl-c`, select, paste,
close, confirm every pane came back and re-fitted.

**Phase 3 — the field.** Traces with phosphor decay, the time axis, the
event log and its vertical strikes. The redraw-only-when-different rule and
its test.

**Phase 4 — the gutter.** Workspace brackets, satellites, selection,
inspector dock, filters carried over from the column header.

**Phase 5 — polish.** Keyboard (↑/↓ lanes, Enter focuses the pane, Esc
closes), reduced-motion path, animation-audit entries, browser stills.

**Phase 6 — docs.** EN + FR, changelog, `layout-variants.md` rewrite of the
⌘G section.

---

## 5 · Risks

| Risk | Mitigation |
|---|---|
| **A stranded pane** | The lease, phase 1, alone and tested on every exit path |
| Bottom-anchored clipping misbehaves across renderers | Verified in phase 2 before anything is built on it; DOM and WebGL both checked |
| A 90 s window is the wrong scale | The window is one constant; widen it once there is something real to look at |
| Event log grows unbounded | Bounded + TTL'd by construction, like `metrics-history` |
| Traces cost CPU | Canvas, one pass, redrawn only on a real change |
| Scope | Six phases, each shippable, each leaving ⌘G working |

---

## 6 · Open questions

Not blocking; worth revisiting after phase 3.

- Should the window be scrubbable (drag the field to look further back)?
  Powerful, but it turns a readout into a tool and wants its own design pass.
- Is 90 s right? It is what the rings hold today.
- `CHRONO` as the on-screen name?
