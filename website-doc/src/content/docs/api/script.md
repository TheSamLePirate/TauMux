---
title: script.*
description: run — execute a package.json / Cargo script in a pane.
---

Runs a manifest script the way the sidebar's script buttons do: a pane is
created (or reused) in the target workspace and the command is typed into it,
so you watch it run in a real terminal.

| Method | Params | Result |
|---|---|---|
| `script.run` | `{ command, cwd?, workspace_id?, script_key? }` | `{ ok: true, scriptKey }` |

- `command` — the shell command to execute.
- `cwd` — directory to run in (defaults to the workspace's selected cwd).
- `workspace_id` — also accepted as `workspace`; defaults to the active workspace.
- `script_key` — stable key used to track "this script is running" state on the
  workspace card. Defaults to the command.

The runner binary for `package.json` scripts is
[`packageRunner`](/configuration/settings/#scripts).
