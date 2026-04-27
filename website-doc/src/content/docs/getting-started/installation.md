---
title: Installation
description: Build τ-mux from source or install the bundled .app, then put `ht` on your PATH.
sidebar:
  order: 2
---

τ-mux is currently macOS-only. You need [Bun](https://bun.sh) ≥ 1.3 to build from source, but the produced `.app` is self-contained — no Bun required on the target machine.

## From source (development)

```bash
git clone https://github.com/TheSamLePirate/TauMux.git
cd TauMux
bun install
bun start                     # dev build + launch
```

## Production build

```bash
bun run build:stable          # builds .app + DMG with bundled `ht` CLI
```

The built `.app` ships a compiled standalone `ht` binary at `Contents/MacOS/ht`. After launch, click **τ-mux → Install 'ht' Command in PATH** from the menu bar to symlink it to `/usr/local/bin/ht`. The first install asks for admin privileges. From then on every shell can drive τ-mux.

## CLI for other Macs

To use `ht` against a τ-mux instance on a Mac that doesn't have Bun installed, build the standalone binary:

```bash
bun run build:cli            # produces ./build/ht-cli
```

Copy `./build/ht-cli` anywhere on the target machine's `PATH` (rename it to `ht` if you prefer) and it will talk to the running τ-mux over the Unix socket at `/tmp/hyperterm.sock`.

## Verify

After install:

```bash
ht ping                       # → PONG
ht version                    # build version
ht identify                   # focused surface + workspace
```

If `ht ping` hangs, τ-mux probably isn't running, or `HT_SOCKET_PATH` is overriding the default socket location. See [Environment variables](/configuration/env-vars/).

## Uninstall

- Drag τ-mux out of `/Applications` to remove the app.
- `sudo rm /usr/local/bin/ht` to remove the CLI symlink.
- `rm -rf ~/Library/Application\ Support/hyperterm-canvas` to wipe settings, telegram database, and browser history.
- `rm -rf ~/Library/Logs/tau-mux` to remove logs.
