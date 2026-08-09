---
title: Layout variants
description: Three chrome layouts — Bridge, Cockpit and Atlas — switchable from one setting. Atlas replaces the sidebar with a live topology of everything τ-mux is running.
sidebar:
  order: 15
---

τ-mux ships three **chrome layouts**. They reshape the window shell — what the left column is, whether panes carry a HUD strip, what the bottom bar shows — and nothing else. The pane-tree engine, your workspaces, your running shells and every keybinding stay exactly where they were, so switching is free and reversible.

Pick one in **Settings → Layout**, or set [`layoutVariant`](/configuration/settings/) directly. The choice persists across restarts.

| Variant | Left column | Best for |
|---|---|---|
| **Bridge** (default) | The full sidebar — workspace cards, file explorer, plan panel, notifications | Day-to-day work |
| **Cockpit** | A 52 px icon rail, plus a 22 px HUD strip on every pane | Dense multi-pane sessions where you want per-pane telemetry inline |
| **Atlas** | A live graph of everything running, with an inspector | Running several agents at once and needing to see where you're needed |

## Bridge

The default, and a refinement of the classic layout. Resizable sidebar, workspace cards with cwd / branch / stats / panes / manifests, the [file explorer](/features/file-explorer-and-editor/), the [plan panel](/features/plan-panel/) and the notification list. Panes get 6 px of inner padding.

## Cockpit

The sidebar collapses to a 52 px icon rail: one τ mark, then a button per workspace, glowing in that workspace's accent, with a pulsing amber dot on any workspace running an agent.

In exchange, every pane grows a 22 px HUD strip between its header and its body:

```
AGENT · sonnet-4.5 · ● running          142 tok/s   $0.81   Δ +34 −18
```

Left is the pane's identity in its identity colour (`AGENT` amber, `HUMAN` cyan), then the model, then a colour-coded state dot. The right block carries the metrics: `tok/s` never appears for a human pane, `$` is always two decimals, `Δ` is green additions and red deletions.

`⌘\` collapses the rail entirely.

## Atlas

Atlas answers one question: **what is happening right now, and where do I need to intervene?**

It replaces the sidebar with a live topology of everything τ-mux is running — workspaces, panes, the Claude Code sessions inside them, their processes, listening ports, git state and cost — and gives that graph the actions to clear whatever it surfaces. You spot a session waiting on you, read why, and approve it without leaving the column.

### Bands

```
┌─ ATLAS ─────── all agents live alert ② ? ⤢ ─┐  header: scope + filters
│ SPEND $1.73  5H 63% ▬▬  7D 21% ▬            │  meters: spend + limits
│ ╭───────────────────────────────────────╮   │  river: last 90 s of output
│ ╰───────────────────────────────────────╯   │
│  ▢ τ-mux    3 workspaces · 7 panes · 2 agent│
│  └─▣ crazyShell  4 panes · 1 agent          │
│      main↑2*  102%  885 MB                  │   the graph
│      ├─● zsh       dev/crazyShell           │
│      ├─⬡ claude-code  needs approval        │
│      │   78% ctx  $1.42  4.2 KB/s           │
│      └─● bun test                           │
│          ▰ 62%  329 KB/s                    │
├─────────────────────────────────────────────┤
│ ⬡ claude-code            NEEDS APPROVAL     │
│ Rebuild the Atlas topology                  │   inspector: readout + actions
│ waiting on   Bash(git push origin main)     │
│ context      ▓▓▓▓▓▓▓░░░  78%                │
│ [Approve]  [Interrupt]                      │
└─────────────────────────────────────────────┘
```

### Reading the graph

The graph is drawn as a **spine**: depth is a small indent, siblings stack vertically, and edges are elbows that drop down the trunk and turn right into their node — the same idiom as `git log --graph` and `pstree`. Positions are deterministic, so a node stays where you last saw it.

| What you see | What it means |
|---|---|
| ▢ square | A workspace (or τ-mux itself, at the head) |
| ● circle | A pane |
| ⬡ hexagon | An agent — a Claude Code session |
| Filled marker | Active workspace / focused pane |
| Arc around a marker | CPU — green, amber over 50 %, red over 85 % |
| Second, outer arc | Context used for a session; build progress for a pane |
| Pulsing halo | Work in flight |
| Dashed ring | **This one needs you** — approval, a question, an error, an unread notification |
| Badge chips | `:3000` port · `main↑2*` branch · `78% ctx` · `$1.42` · `▰ 62%` progress · output rate · `ht set-status` pills |
| Corner brackets | The focused node — a targeting reticle, only ever on one |
| Marker glow | Scales with CPU, so a hot pane visibly burns |
| Chip flash | That number just changed (rate-limited, so it cues rather than strobes) |

Aggregate CPU on a workspace or on τ-mux itself is scaled against four cores, not one, so a single busy process doesn't peg the ring.

### The meters strip

Under the filters, once a Claude session reports: total agent spend, and the 5-hour and 7-day rate-limit walls as mini-bars that go amber past 60 % and red past 85 %. Rate limits are account-wide, so the reading is the highest any live session has seen — including sessions with no pane.

Nothing reports, nothing renders: the strip disappears rather than sitting empty.

### The activity river

A 34 px band showing the **last 90 seconds** of output, one lane per workspace, coloured by that workspace's accent. The graph tells you what is true now; the river tells you how it got there — a pane that pinned a core three seconds ago and went quiet looks identical to one that slept all morning until you see its trace.

- Every workspace keeps a resting lane, so a silent one is visibly silent rather than missing.
- A collection gap (the app was asleep) is drawn as a gap, never bridged.
- The window scales to the history it actually has, so a fresh launch fills from the left instead of showing three-quarters of dead strip. "Now" is always the right edge.
- Click a lane to jump to that workspace.

### The wires carry the bytes

Each edge animates at the pane's **real stdout throughput**. A pane running `bun test` visibly streams; a shell sitting at its prompt is a still hairline. Nothing else in τ-mux surfaces PTY throughput, and it lets you see which pane is talking without reading a label.

Below roughly 200 B/s nothing animates at all — an idle τ-mux is a completely still graph, which is also why the effect costs nothing when you're not using it.

### Agents in the graph

A Claude Code session **is drawn as its pane**, not as a second node beside it: the marker becomes a hexagon, turns amber, and picks up the session's badges. What the graph and inspector know about a session:

- phase — working, waiting for you, needs approval, asking you, compacting, error;
- model, context used, cost, and the 5-hour / 7-day rate-limit meters;
- turn count, elapsed turn, lines added and removed;
- PR number and review state;
- the text of whatever is waiting for approval;
- **live subagents**, each as its own node under the pane, with how long it has been running;
- **the mirrored task list as a plan** (see below).

A session with no live pane — Claude Code running in a shell τ-mux doesn't own, or a pane that closed under it — hangs off the root badged `detached`. It still spends money and can still be waiting on you, so it stays visible.

### `ht` in the graph

Atlas hides the sidebar, which used to mean the plan panel and status pills vanished when you picked it. They are now part of the topology instead:

- **[`ht plan`](/cli/plan/)** — a plan's steps become child nodes: filled box for done, pulsing for active, hollow for waiting, red for failed. The parent gains a `2/4` badge and a progress arc. A plan naming an agent hangs off the pane running it; otherwise off the workspace. Panes carrying a plan open themselves, since folding it away would lose what the sidebar used to show for free.
- **[`ht set-status`](/cli/sidebar-and-status/)** — pills become badges on the workspace node in the colour the publishing script chose, and rows in the inspector.
- **[`ht set-progress`](/cli/sidebar-and-status/)** — drives the workspace marker's arc and a `▰ 41%` badge. A plan takes precedence when both are present.
- **[`ht ask`](/cli/ask-user/)** — a question waiting on you flags its pane, outranking whatever phase the session reports, and the inspector shows the prompt and its choices.

Because Claude Code's task list is mirrored *into* a plan, a session that has both shows the plan only — the same work drawn twice would be noise.

### Sparklines

Selecting a workspace or a pane draws its last 90 seconds of CPU in the inspector, labelled with the peak. That peak is usually the question you actually had when you clicked: not "is it busy" but "did it get busy".

### Filters

Four chips in the header: **all**, **agents**, **live**, **alert**. The `alert` chip carries a count of everything currently waiting on you. A node survives a filter when it matches *or* when one of its descendants does, so filtering never orphans a match from its workspace.

### Inspector actions

The inspector shows whatever you hover or select, and offers the actions that belong to it:

- **Approve** — only for a permission prompt Claude Code is showing in a terminal pane, where pressing Enter is genuinely the answer. It is deliberately **not** offered for a prompt routed to a τ-mux modal or Telegram, nor for an `AskUserQuestion` / `ExitPlanMode` choice addressed to you, because "approve" would silently pick a default.
- **Interrupt** — stop a turn in flight.
- **Open :port** — open a pane's listening port in your browser.
- **Details** — the full [pane info](/features/live-process-metadata/) view.
- **Close pane**.

### Expanded topology — `⌘G`

`⌘G` opens the whole topology full-window: every workspace expanded, plus each pane's child processes (with CPU and RSS), its listening ports, and every mirrored agent task. Same graph, same renderer, more depth. `Esc` closes it.

The overlay floats above your live panes and blurs them, so the work you opened it to reason about stays visible as context.

### Collapsed rail — `⌘\`

`⌘\` folds the column down to a 44 px rail of workspace glyphs, with an amber dot on any workspace holding an unread notification. Clicking one switches to it. The rail *is* the collapsed state of the graph, not a second piece of chrome sitting beside it.

### Keyboard

The graph is a real tree widget, not a picture:

| Key | Action |
|---|---|
| `↑` / `↓` | Move between visible rows |
| `→` | Open a folded node, then descend |
| `←` | Close an open node, then ascend |
| `Enter` / `Space` | Go to that workspace or pane |
| `Home` / `End` | First / last row |

The `?` button in the header toggles a legend for the encoding.

### The look

Atlas is the deliberately radical variant, and the one place the design system's restraint is relaxed on purpose. It reads as a phosphor instrument: a scanline veil over the graph ground, a horizon glow behind the spine's head, hairline corner brackets framing each band, and marker glow that tracks load rather than being decoration applied evenly.

The one non-tree line is the **callout** — an arc from τ-mux itself to whatever is blocking on you. It is drawn only for things a keystroke of yours resolves (approval, a question, an error), never for merely-informational states, and capped at two.

### Motion

Every animation in Atlas carries state — none is decorative. Under `prefers-reduced-motion: reduce` the byte-flow, the halos, the attention pulse, the callout and the chip flash all stop; the arcs, colours and dashed rings say the same things without moving.

## Source files

- `src/views/terminal/variants/controller.ts` — owns the active variant; `enter()` / `exit()` transitions.
- `src/views/terminal/variants/{bridge,cockpit,atlas}.ts` — one handle per variant.
- `src/views/terminal/atlas/` — the Atlas panel: `snapshot` gathers, `layout` places, `view` draws, `inspector` explains, `filter` scopes.
- `src/views/terminal/throughput-meter.ts` — the per-pane byte rate behind the wires.
- `src/views/terminal/metrics-history.ts` — the 90-second rings behind the sparklines and the river.
- `src/views/terminal/atlas/river.ts` — the activity river.

## Read more

- [Settings](/configuration/settings/) — `layoutVariant`, `sidebarWidth`, `paneGap`
- [Keyboard shortcuts](/configuration/keyboard-shortcuts/)
- [Live process metadata](/features/live-process-metadata/) — where the CPU, ports and git state come from
- [Claude Code integration](/integrations/claude-code/) — where the session state comes from
