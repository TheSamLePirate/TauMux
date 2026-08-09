---
title: atlas.*
description: pin, note, meter, mark — agent-authored annotations on the Atlas topology graph.
---

The write side of the [Atlas graph](/features/layout-variants/#atlas). Everything else the graph
draws is observed; these methods carry what the thing doing the work says
about it. CLI surface: [`ht atlas`](/cli/atlas/).

| Method | Params | Result |
|---|---|---|
| `atlas.pin` | `{ surface?, workspace?, off? }` | `"OK"` |
| `atlas.unpin` | `{ surface?, workspace? }` | `"OK"` |
| `atlas.note` | `{ surface?, workspace?, text, tone? }` | `"OK"` |
| `atlas.meter` | `{ surface?, workspace?, key, value, label? }` | `"OK"` |
| `atlas.clear_meter` | `{ surface?, workspace?, key }` | `"OK"` |
| `atlas.mark` | `{ text, surface?, workspace?, tone? }` | `{ ok, id, at }` |
| `atlas.clear` | `{ surface?, workspace?, all? }` | `"OK"` |
| `atlas.state` | `{}` | `{ annotations, marks }` |

## Target resolution

Explicit `workspace` beats explicit `surface`, which beats the caller's own
pane (`HT_SURFACE`, exported into every pane's shell), which beats the
focused surface. An agent running inside a pane therefore annotates its own
node with no parameters.

Targets are ordinary surface / workspace ids — the same ones
[`workspace.list`](/api/workspace/) and [`surface.list`](/api/surface/)
return, and the same ones the graph uses as node ids.

## Values

`atlas.meter` clamps to 0…1 and accepts 0–100 as a percentage, so `62` and
`0.62` mean the same thing. `tone` is `info | ok | warn | err`; anything
else is ignored rather than rejected.

Notes are capped at 200 characters, meters at 4 per node (oldest dropped),
marks at 50 with a 10-minute expiry.

## Lifetime

In memory only, never persisted. These describe live work — a note about
what a session was blocked on an hour ago would outlive its truth.

## Push channel

Every mutation debounce-broadcasts an `atlasAnnotations` envelope to the
webview, so the graph repaints without polling.
