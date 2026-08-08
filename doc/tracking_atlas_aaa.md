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
