---
title: editor.*
description: open, split, list, save, reload, close — CodeMirror editor panes.
---

Editor panes are a non-PTY surface kind (`editor:` ids). See
[file explorer & editor](/features/file-explorer-and-editor/) and the
[`ht edit` / `ht editor` CLI](/cli/surfaces-and-io/).

| Method | Params | Result |
|---|---|---|
| `editor.open` | `{ path?, cwd?, create?, split?, direction? }` | `"OK"` |
| `editor.split` | `{ path?, cwd?, create?, direction? }` | `"OK"` |
| `editor.list` | `{}` | `{ editors: string[] }` — editor surface ids in the active workspace |
| `editor.save` | `{ surface_id? }` | `"OK"` |
| `editor.reload` | `{ surface_id? }` | `"OK"` |
| `editor.close` | `{ surface_id? }` | `"OK"` |

**Params**

- `path` — file to open. Omitted opens a blank buffer.
- `cwd` — base directory used to resolve a relative `path`.
- `create` — create the file when it does not exist (accepts `true` or `"true"`).
- `split` (`editor.open` only) — open beside the focused pane instead of in a new workspace.
- `direction` — `"right"` / `"horizontal"` (default) or `"down"` / `"vertical"`.
- `surface_id` — target editor pane. Also accepted as `surfaceId` or `id`.
  Defaults to the focused surface; the call throws unless the resolved id is
  an editor surface.

Saving is also bound to `⌘S` inside the pane; `editor.save` is the
scriptable equivalent.
