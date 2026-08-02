---
title: Extensions
description: ht extension list, templates, open, split, new, install, remove, enable, disable, reload, stop.
sidebar:
  order: 13
---

Manage [extension apps](/features/extensions/) from the CLI. Every subcommand maps to an `extension.*` [JSON-RPC method](/api/extensions/).

## list

```bash
ht extension list
```

Lists installed extensions — id, name, version, icon, whether a built bundle exists, and whether one is currently running.

## templates

```bash
ht extension templates
```

Names of the bundled scaffold templates (e.g. `hello`, `three-demo`, `http-client`) usable with `extension new`.

## open

```bash
ht extension open <id>                  # new pane in the active workspace
ht extension open <id> --split          # split the focused pane
ht extension open <id> --direction down # right (default) | down
```

Launches an extension in a new pane. The backend starts, and the iframe loads the Vite dev URL (dev mode) or the built bundle (installed mode).

## split

```bash
ht extension split <id> --direction down
```

Convenience for `open <id> --split` with an explicit direction.

## new

```bash
ht extension new com.you.my-app --template hello
ht extension new com.you.my-app --template three-demo --name "My App"
```

Scaffolds a new extension from a bundled template into `<config>/extensions/<id>/`, rewriting the manifest id (and name, if `--name` is given). Use [`ht extension templates`](#templates) to list the choices.

## install

```bash
ht extension install /path/to/an-extension-dir
```

Copies an external extension directory (one containing a valid `manifest.json`) into the extensions store and registers it.

**Trust note:** installing runs `bun install` (including arbitrary postinstall scripts) and opening runs the extension's backend with a token granting the whole `ht` control surface. Install only what you would pipe to a shell — see the [trust model](/features/extensions/#trust-model). Since v0.4.12 the dev-server `bun x` network fallback is gone (a missing dev binary fails with "run `bun install`" instead of fetching from the network), and dev ports are allocated per instance — a manifest's `devPort` is a preference, and τ-mux walks to the next free port instead of loading another server's UI into the pane.

## remove

```bash
ht extension remove <id>
```

Stops any running surfaces for the extension and deletes its folder.

## enable / disable

```bash
ht extension enable <id>
ht extension disable <id>
```

*(v0.4.12)* Disabling an extension **stops any surface currently running
it** and makes `extension.open` / `extension.split` refuse until it's
re-enabled. Before v0.4.12 the flag existed but was never enforced — a
"disabled" extension silently launched anyway.

## reload

```bash
ht extension reload
```

Re-scans the extensions directory and rebuilds the registry — pick up an extension added or edited on disk without restarting τ-mux.

## stop

```bash
ht extension stop <ext:N>
```

Stops the backend (and dev server) for a specific running extension surface, by surface id (the `ext:` ids shown in `ht list-surfaces`).
