# Tracking — Atlas AAA rebuild

Brief: *"make the Atlas layout much better, best UI, UX, stunning sidebar,
with more data shown in the graph. The best visual crazy interactive graph
view, fully integrated with the agents (Claude Code sessions and
integrations) and the τ-mux functionalities."*

---

## 1 · What was wrong with Atlas v1

Read of `src/views/terminal/variants/atlas.ts` (586 LOC) before the rebuild:

| # | Problem | Consequence |
|---|---------|-------------|
| 1 | `renderGraph()` calls `host.replaceChildren()` and rebuilds every SVG node on every rAF | No element identity → no transitions, hover state lost mid-interaction, GC churn at 1 Hz |
| 2 | Hard-coded `y = selfY + 48 + i * 54` | >8 workspaces render off-canvas with no scroll, no pan, no zoom |
| 3 | Only the active workspace expands its surfaces | You cannot compare workspaces — the graph's entire premise |
| 4 | Nodes carry a CPU ring and a label | git, ports, progress, package, RSS all invisible despite being in `SurfaceMetadata` |
| 5 | **Zero agent integration** | Claude sessions — phase, model, ctx%, cost, tasks, approvals — do not exist in the graph at all |
| 6 | Info card is passive | You can see a node needs approval and can do nothing about it from the graph |
| 7 | No filter, no search, no legend | |
| 8 | The 36 px tab rail duplicates the graph's surface list | 36 px of permanent chrome restating what is already on screen |
| 9 | `<circle>` + click handler, no `tabindex`, no roles | Graph is unreachable by keyboard, invisible to AT |
| 10 | Plan panel is `display:none` under Atlas | Agent plans vanish when you pick Atlas |

## 2 · Design plan

**Subject.** A live topology instrument for a terminal where humans and
Claude Code agents work in parallel. Its single job: *see what is happening
and where you are needed, then get there in one click.*

**Colour.** Fixed by the TAU system (§1) — this axis is the brief, not a free
choice. void ground, cyan = human/system/focus, amber = agent, ok/warn/err for
telemetry, the four-step text ramp for hierarchy. New tokens added to the
token block rather than pasted as literals (`audit:theming` enforces this).

**Type.** Mono (`--tau-font-mono`, tabular-nums) for every label and every
number — the graph repaints at 1 Hz and proportional digits dance. Sans
(`--tau-font-sans`) is rationed to the panel eyebrow and inspector title.
Scale: 9 / 10 / 10.5 / 11.5 / 12 px.

**Layout.** Three bands in the column: header (scope + filters + expand),
graph canvas (flex), inspector (actions). Deterministic tidy-tree layout —
depth → x, siblings → y — *not* force-directed: physics jitters on every
metadata tick and costs CPU the project's first priority forbids.

**Signature — the wires carry the bytes.** Every workspace→surface edge is a
live conduit whose dash animates at a speed derived from that pane's real
stdout throughput (EWMA B/s, log-scaled). A silent pane is a still hairline;
a pane running `bun test` visibly streams. Nothing else in τ-mux surfaces PTY
throughput, and it is rendered in the medium the data is about.
Discipline that keeps it honest *and* keeps idle CPU at ~0: **wires below
~200 B/s do not animate at all.** An idle τ-mux is a completely still graph.

**Restraint.** The tab rail stops being a permanent sibling and becomes the
*collapsed state* of the Atlas column (⌘\). One element, two states, 36 px of
standing chrome reclaimed.

## 3 · Encoding table (the "more data" ask)

| Channel | Encodes |
|---|---|
| Node shape | ▢ workspace · ● surface/process · ⬡ agent session |
| Fill | focused/active filled, idle hollow |
| Stroke | identity — cyan human, amber agent, workspace accent |
| Inner ring arc | CPU % (0–100 → 0–360°) |
| Ring colour | ok / warn >50 % / err >85 % |
| Halo pulse | phase = running / working |
| Outer dashed ring | needs attention (approval, question, notification) |
| Edge dash speed | **live stdout throughput** ← signature |
| Edge colour | identity of the child |
| Badge satellites | `:3000` port · `⎇branch±` · `ctx%` · `$cost` · progress |

## 4 · Progress

- [x] Read Atlas v1 + variant contract + design guideline §9.3
- [x] Audit constraints confirmed: `audit:theming` (no colour literals),
      `audit:emoji`, `audit:animations` (keyframe allowlist), `audit:module-size`
      (CAP 1500, new modules born small)
- [x] Throughput meter (`throughput-meter.ts`) + tap in `SurfaceManager.writeToSurface`
- [x] `claudeSessions` webview push (bun → webview) + `claude-session-store.ts`
- [x] `atlas/` module set: `types` `format` `snapshot` `layout` `filter` `view` `inspector` `header` `panel`
- [x] CSS rewrite + `--tau-atlas-grid` token + `tauAtlasFlow` keyframe allowlisted
- [x] Tests (52 new across 3 files), typecheck, lint, all five audits
- [x] Visual verification against fixtures (column, narrow column, filters, keyboard, reduced motion, overlay)
- [x] Real-app launch check under `layoutVariant: atlas`
- [x] Version bump + `doc/changes_to_document.md` note

## 5 · Deviations from the guideline

| Guideline | Deviation | Why |
|---|---|---|
| §9.3 "Graph column 220 px" | 320 px, matches `sidebarWidth` | 220 px cannot hold a label + badge row; the column is the instrument now |
| §9.3 "Tab rail between graph and panes" | Rail becomes the collapsed state of the column | It duplicated the graph's surface list |


## 6 · What landed

Commit `4d7b7bb4` — *feat(atlas): rebuild the graph as a topology instrument (v0.17.0)*.
41 files, +5345 / −747.

### New modules

| Module | Role |
|---|---|
| `src/views/terminal/throughput-meter.ts` | Per-pane stdout byte rate. No timers — decay is computed lazily at read time, so a silent τ-mux runs no code here. |
| `src/views/terminal/claude-session-store.ts` | Webview mirror of the bun session registry. |
| `src/bun/claude-session-mirror.ts` | Debounced registry → `claudeSessions` push. |
| `src/views/terminal/metadata-diff.ts` | The repaint gate, extracted from `SurfaceManager` as a pure predicate. |
| `src/views/terminal/variants/layout-shortcuts.ts` | ⌘\ / ⌘G bodies, out of `index.ts`. |
| `src/views/terminal/atlas/{types,format,snapshot,layout,filter,view,inspector,header,panel}.ts` | The panel. Three pure stages (build → layout → draw) plus one impure gatherer. |

### Pipeline

```
host state ──build──▶ AtlasSnapshot ──layout──▶ AtlasScene ──draw──▶ SVG + rows
            (impure)                (pure)                 (keyed diff)
```

Only `snapshot.ts` knows about `SurfaceManager`, `SurfaceMetadata` or
`ClaudeSessionState`. That is what makes layout and filtering unit-testable
without a webview, and what let the whole panel be iterated against
fixtures in a browser before it ever ran in Electrobun.

### Data now on screen that was not before

Claude phase · model · context % · cost · rate limits (5 h / 7 d) · turn
count · elapsed turn · lines added/removed · mirrored task list · live
subagents · PR number and review state · pending approval text · git branch
with ahead/behind/dirty marks · listening ports · package / crate name ·
per-pane process tree with CPU and RSS · OSC 9;4 build progress · **stdout
byte rate**.

### Idle cost

Three wake sources, all change-gated:

- structural events (`ht-workspaces-changed`, `ht-surface-focused`, `ht-notify-state-changed`);
- `ht-surface-metadata`, emitted by `SurfaceManager` only when a number actually moved;
- a self-terminating follow-up tick that exists **only while some wire is flowing**.

A τ-mux with nothing happening does no work per second and animates
nothing — which is the only reason the byte-flow animation was allowed to
exist at all.

## 7 · Verification

| Gate | Result |
|---|---|
| `bun test` | 3975 pass / 0 fail (52 new: layout, filter, snapshot, throughput) |
| `bun run typecheck` | clean |
| `bun run lint` | 0 errors (2 pre-existing warnings in `examples/extensions/nebula`) |
| `audit:animations` | clean — `tauAtlasFlow` / `tauAtlasHalo` / `tauAtlasNotifyPulse` allowlisted with §9.3 citations |
| `audit:theming` | clean — also fixed a **pre-existing** literal in `.file-link-tooltip` (new `--ht-tooltip-shadow`) |
| `audit:emoji` | clean |
| `audit:module-size` | clean — net **−38 lines** across the baselined god modules |
| `audit:guideline` | 11/11 |
| Real app | Launched under `layoutVariant: atlas` in an isolated config dir: booted, mounted, split twice, three shells alive, **zero errors in the log** |

**Not verified:** a screenshot of the real Atlas window. The isolated test
instance stayed behind the user's own τ-mux window and this machine has not
granted System Events accessibility permission, so window focus could not
be scripted. All visual iteration was done against the real modules and the
real `index.css` in a fixture harness instead.

## 8 · Design decisions worth re-reading before changing anything

1. **Deterministic spine, not force-directed physics.** Physics jitters on
   every 1 Hz telemetry tick and burns CPU continuously. The tree layout is
   O(n), byte-identical between ticks, and is the idiom (`git log --graph`,
   `pstree`) its readers already know.
2. **Sibling wires chain instead of radiating.** Each child's wire starts
   where the previous sibling's ended. Otherwise N segments overlap on the
   same vertical run, each animating at a different byte rate — noise, not
   flow. (`tests/atlas-layout.test.ts` pins this.)
3. **Rows are HTML, wires are SVG, rows paint *under* the SVG.** SVG cannot
   ellipsize text and gives no keyboard affordance; an opaque selected row
   above the SVG swallows its own marker. Both were live bugs, caught by
   looking at the render.
4. **A bound Claude session is not its own node.** One thing, one marker.
5. **A workspace notification marks the workspace, not every pane in it.**
   v1 ringed all of them and the graph shouted.
6. **Aggregate CPU scales against a 400 % ceiling.** `ps %cpu` is per-core;
   a /100 scale painted the root ring red on an idle machine.
7. **The callout arcs were cut.** They were a second bold element competing
   with the byte-flow signature, and the attention ring plus the header
   count already say the same thing. One signature, not two.


---

# Round 2 — v0.18.0 · temporal axis + `ht` in the graph

Commit `508fd99c`. 36 files, +2308 / −138.

Brief: *"Make the atlas layout even more crazy and good, with a lot of data
expressed in the Graph, and more UI element, animations and effects. all
integrated with claude code and ht"* — plus, mid-flight: *"Make it look
even more sci-fi"*.

## What was still missing after v0.17.0

| Gap | Consequence |
|---|---|
| The graph is a snapshot | A pane that pinned a core three seconds ago and went quiet is drawn identically to one that slept all morning |
| Atlas hides the sidebar | `ht plan`, `ht set-status`, `ht set-progress` and pending `ht ask` questions all became invisible the moment you picked Atlas |
| Subagents lived in a comma-joined inspector row | A live branch of the work wasn't a branch of the graph |
| Rate limits were per-session inspector rows | No glanceable answer to "how close am I to a wall" |
| Effects were binary | `is-active` glow on/off; nothing scaled with the data |

## New modules

| Module | Role |
|---|---|
| `metrics-history.ts` | 90-sample ring per key, no timers, gap-honest. Behind the sparklines and the river. |
| `plan-store.ts` | Webview mirror of `restorePlans`, so non-sidebar views can read plans. |
| `atlas/river.ts` | The activity river (canvas), plus `withAlpha`. |
| `surface-geometry.ts` | Pane/workspace capture rects, extracted from `SurfaceManager`. |
| `after-transition.ts` | Extracted from `index.ts`; now shared with the layout shortcuts. |
| `variants/atlas-host-wiring.ts` | Introduces the graph to the ask-user queue without `atlas/` importing it. |

## Encoding added

| Channel | Encodes |
|---|---|
| River lane | Per-workspace output over the last 90 s |
| Sparkline + peak | The selected node's recent CPU, and how high it actually got |
| Meters strip | Agent spend · 5 h / 7 d rate-limit walls |
| Plan-step node | `ht plan` state — filled done / pulsing active / hollow waiting / red failed |
| Parent `2/4` badge + arc | Plan progress |
| `ht set-status` badge | The publishing script's own colour, preserved |
| `▰ 41%` badge + arc | `ht set-progress` |
| Subagent node | A live Claude Code subagent, with elapsed time |
| Corner brackets | Navigable focus (reticle) |
| Marker glow | Scales with CPU |
| Chip flash | This number just changed |
| Callout arc | Root → whatever a keystroke of yours resolves |

## Bugs the build surfaced (all caught by looking, or by a test)

1. **Reticle on every "done" plan step.** `active` means "done" on a plan
   step and "focused" everywhere else; the reticle keyed on the flag, not
   the meaning. Scoped to navigable kinds.
2. **The tick flash strobed.** A throughput chip changes every second, so
   "what moved" became a metronome. Rate-limited to one flash per 4 s per
   chip.
3. **Rate limits ignored detached sessions.** The rollup ran only inside
   the bound-surface loop — under-reporting exactly when the warning
   matters. Caught by `atlas-snapshot.test.ts`.
4. **Plan steps and Claude tasks drawn twice.** `claude-plan-mirror` builds
   the plan *from* the task list, so deep mode rendered both. The plan
   supersedes; the tasks are dropped.
5. **The river read as broken on launch.** Pinning to the 90-sample
   capacity left three quarters of dead strip. Window is adaptive now, and
   every workspace keeps a resting lane.

## Sci-fi pass

Scanline veil + horizon glow on the graph ground, hairline corner brackets
framing the header and inspector, load-proportional marker glow, targeting
reticle on focus, and the revived callout arc. All of it still keyed to
state — the glow tracks CPU, the brackets frame real bands, the reticle
marks real focus — which is what keeps it an instrument rather than a
skin, and what lets it pass `audit:animations` on the documented terms.

## Verification (v0.18.0)

| Gate | Result |
|---|---|
| `bun test` | 4007 pass / 0 fail (+32: metrics-history, river, ht/plan/subagent/question integration) |
| `bun run typecheck` / `lint` | clean |
| `audit:animations` | clean — `tauAtlasTick` allowlisted with its rationale |
| `audit:theming` / `emoji` / `guideline` | clean |
| `audit:module-size` | clean — `SurfaceManager` and `index.ts` both shrank again |
| Docs | EN + FR page updated, changelog entries, 164 pages, 0 broken links |
| Visual | Column, overlay, filters, narrow column, keyboard, reduced motion (0 running animations) |

**Not verified:** a screenshot of the real Atlas window — same reason as
round 1 (no System Events accessibility permission on this machine, so the
isolated test instance can't be raised above the user's own). All visual
work was done against the real modules and real `index.css` in the fixture
harness.
