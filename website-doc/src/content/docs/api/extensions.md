---
title: extension.*
description: list, templates, open, split, new, install, remove, reload, stop — the host side of the extension-app platform.
sidebar:
  order: 11
---

The host side of the [extension-app platform](/features/extensions/). These methods back the [`ht extension`](/cli/extensions/) CLI and the command-palette entries. They are the *management* surface — an extension's own backend/frontend drives the rest of τ-mux through the [`@tau-mux/sdk`](/features/extensions/#the-tau-muxsdk), which calls the regular [`surface.*`](/api/surface/), [`notification.*`](/api/notification/), [`sidebar.*`](/api/sidebar/), [`workspace.*`](/api/workspace/), and [`browser.*`](/api/browser/) methods.

## Registry

| Method | Params | Result |
|---|---|---|
| `extension.list` | `{}` | `[{ id, name, version, icon, description, enabled, hasBuild, running, path }]` |
| `extension.templates` | `{}` | `string[]` — bundled scaffold-template names |
| `extension.reload` | `{}` | `"OK"` — re-scan the extensions dir + rebuild the registry |

## Surfaces

| Method | Params | Result |
|---|---|---|
| `extension.open` | `{ id: string, split?: boolean, direction?: "right"\|"down" }` | `"OK"` |
| `extension.split` | `{ id: string, direction?: "right"\|"down" }` | `"OK"` |
| `extension.stop` | `{ surface_id: string }` | `"OK"` — stop one running extension backend |

`extension.open` / `extension.split` mint a fresh `ext:`-prefixed surface id, start the extension's backend (and Vite dev server, in dev mode), and mount its iframe.

## Authoring

| Method | Params | Result |
|---|---|---|
| `extension.new` | `{ id: string, template: string, name?: string }` | `{ id, path }` |
| `extension.install` | `{ path: string }` | `{ id, path }` |
| `extension.remove` | `{ id: string }` | `"OK"` |

`extension.new` clones a bundled template (see `extension.templates`) into `<config>/extensions/<id>/` and rewrites its manifest id. `extension.install` copies an external directory containing a valid `manifest.json`. `extension.remove` stops any running surfaces, then deletes the folder.

## Notes

- All methods require an `ExtensionManager` to be wired in; in processes without it (some test fixtures) they throw `extensions are not available`.
- Extensions are **fully trusted** — manifest `permissions` are advisory. The RPC socket token (if enabled) still gates the socket, so only legitimately-connected clients can call these. See the [trust model](/features/extensions/#trust-model).
