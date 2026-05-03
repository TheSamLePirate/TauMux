---
title: system.*
description: ping, version, identify, capabilities, tree.
sidebar:
  order: 2
---

System-level introspection methods.

## system.ping

```json
{ "method": "system.ping", "params": {} }
→ { "result": "PONG" }
```

## system.version

```json
{ "method": "system.version", "params": {} }
→ { "result": { "version": "0.2.80", "build": "…" } }
```

## system.identify

Returns the focused surface and its metadata.

```json
{ "method": "system.identify", "params": {} }
→ {
  "result": {
    "workspaceId": "ws:0",
    "surfaceId": "surface:1",
    "metadata": { "pid": 11234, "fg": "bun run dev", "cwd": "/Users/me/code/foo", … }
  }
}
```

## system.capabilities

Lists every method the running τ-mux exposes.

```json
{ "method": "system.capabilities", "params": {} }
→ {
  "result": {
    "methods": [
      { "name": "system.ping", "params": [] },
      { "name": "surface.split", "params": [{ "name": "direction", "type": "string", "required": true }, …] },
      …
    ]
  }
}
```

Useful for agent integrations that adapt to whatever version is attached.

## system.tree

Workspaces / panes / surfaces in one tree.

```json
{ "method": "system.tree", "params": {} }
→ {
  "result": {
    "workspaces": [
      {
        "id": "ws:0",
        "label": "build",
        "panes": [
          {
            "kind": "split",
            "direction": "right",
            "children": [
              { "kind": "leaf", "surface": { "id": "surface:1", "type": "terminal", … } },
              { "kind": "leaf", "surface": { "id": "surface:2", "type": "terminal", … } }
            ]
          }
        ]
      }
    ]
  }
}
```

## CLI equivalents

| Method | CLI |
|---|---|
| `system.ping` | `ht ping` |
| `system.version` | `ht version` |
| `system.identify` | `ht identify` |
| `system.capabilities` | `ht capabilities --json` |
| `system.tree` | `ht tree` |

## RPC-only methods (no CLI verb)

A handful of RPC methods are deliberately **not** wired into the `ht` CLI. They remain discoverable via `ht capabilities --json` and usable from any custom RPC client, but the CLI surface intentionally omits them — either because the use case is purely programmatic (audit / cleanup helpers consumed by the webview itself) or because the inputs are awkward to express on a shell command line.

| Method | Why no CLI? | Use it from |
|---|---|---|
| `surface.kill_pid` | The shell-side equivalent is `ht kill PORT`, which resolves the pid from a listening port. Killing an arbitrary observed pid is too easy to misuse from a shell pipeline; the method also rejects pids that aren't tracked by a live surface tree, plus signals outside `{SIGTERM, SIGINT, SIGKILL, SIGHUP, SIGQUIT}`. | Process Manager overlay (⌘⌥P) and any custom RPC script that already has the pid in hand. |
| `surface.rename` | Surfaces don't carry user-visible names today — only the `pane.label` chip does. Method exists so a future labeling UI can wire up cleanly without a schema bump. | Internal webview tooling. |
| `notification.dismiss` | Equivalent CLI surface would be `ht dismiss <id>`, which is rarely useful interactively (the user just clicks the X). The webview calls it on swipe / X-button. | Notification overlay UI; integration tests. |
| `browser.stop_find` | Pairs with `browser.find` (`ht browser find-in-page`); the cancel half is exclusively a UI concern (no human types `ht browser stop-find`). | DevTools-style overlays in the webview. |
