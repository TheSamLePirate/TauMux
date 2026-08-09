---
title: Atlas
description: ht atlas — pin, annotate and mark the Atlas topology graph from an agent or a script.
sidebar:
  order: 12
---

Everything the [Atlas graph](/features/layout-variants/#atlas) draws is *observed*: CPU the poller read, bytes the PTY emitted, phases Claude Code's hooks reported. `ht atlas` is the one channel that goes the other way — where the thing doing the work says something no amount of observation would reveal.

Four verbs, deliberately few:

| Verb | Says |
|---|---|
| `pin` | this node matters right now; keep it visible |
| `note` | one line of context — what it's actually blocked on |
| `meter` | a named 0…1 reading — how far through a job it is |
| `mark` | a timestamped milestone on the activity river |

## Targeting

Every verb except `mark` acts on a **node**, which is a surface or a workspace — the same ids the graph already uses:

```bash
ht atlas pin                      # this pane (HT_SURFACE), or the focused one
ht atlas pin --surface surface:3
ht atlas pin --workspace ws:2
```

Inside a τ-mux pane `HT_SURFACE` is already exported, so an agent annotates its own node with no arguments at all.

## pin / unpin

```bash
ht atlas pin
ht atlas unpin
```

A pinned node gains a `pinned` badge and the graph opens the path down to it — a pin that left the node folded inside a collapsed workspace would have done nothing. Use it when you're about to work somewhere the user isn't looking.

## note

```bash
ht atlas note "waiting on CI"
ht atlas note "rebase conflict in pane-layout.ts" --tone err
```

The note becomes the node's sublabel and the first row of its inspector. It **outranks** the derived sublabel: what the agent says it is doing beats what τ-mux inferred from `argv`.

`--tone info|ok|warn|err` colours the inspector row. Capped at 200 characters — one line, not a log.

## meter

```bash
ht atlas meter build 0.62
ht atlas meter build 62            # 0–100 is read as a percentage
ht atlas meter tests 0.4 --label "142/350 files"
```

A named 0…1 reading, drawn as a badge and as the node's outer arc. The first meter published takes the arc; later ones stay badges. Four per node, oldest dropped.

Values outside 0…1 are clamped rather than refused: a caller reporting `1.4` means "done".

```bash
ht atlas clear --surface surface:3   # drop this node's annotations
```

## mark

```bash
ht atlas mark "migration applied"
ht atlas mark "deploy failed" --tone err
```

A timestamped tick on the [activity river](/features/layout-variants/#the-activity-river). The river already shows *how loud* each workspace has been; a mark says *and this is when the thing you cared about happened*.

Marks expire after 10 minutes and are capped at 50 — they annotate the recent past, not a history.

## clear / state

```bash
ht atlas clear                # this node
ht atlas clear --all          # everything, including marks
ht atlas state                # read back what is annotated
```

## Lifetime

Annotations live in memory and are **not persisted**. They describe live work: a note about what a session was blocked on an hour ago is worse than no note, because it would outlive its truth with no way to tell.

## Read more

- [Layout variants → Atlas](/features/layout-variants/) — what the graph draws and how to read it
- [`atlas.*` JSON-RPC](/api/atlas/)
- [`ht plan`](/cli/plan/) — for step-by-step plans, which the graph also renders
