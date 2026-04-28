---
title: Environment variables
description: Env vars τ-mux reads — both inside spawned shells and at app launch.
sidebar:
  order: 2
---

τ-mux reads environment variables at two distinct times:

1. **At app launch** — these affect the main process (web mirror port, log dir).
2. **Inside spawned shells** — these are auto-set by τ-mux for scripts and the `ht` CLI to consume.

## Read at app launch

| Variable | Default | Effect |
|---|---|---|
| `HYPERTERM_WEB_PORT` | (unset) | Overrides `webMirrorPort` and forces auto-start, regardless of settings. |
| `HT_SOCKET_PATH` | `/tmp/hyperterm.sock` | Override the Unix socket path. Must match between τ-mux and `ht` CLI. |
| `HYPERTERM_INCLUDE_TEST_HOOKS` | `1` (dev), `0` (stable) | Whether test-only RPC methods are exposed. Set to `0` for production builds. |
| `HT_CONFIG_DIR` | `~/Library/Application Support/hyperterm-canvas` | Where settings.json, telegram.db, sharebin/, logs/ live. Tests override this. |

## Auto-set inside spawned shells

These are populated automatically when τ-mux spawns a new terminal surface. Scripts inside the shell can read them.

| Variable | Value | Purpose |
|---|---|---|
| `HT_SURFACE` | e.g. `surface:3` | This surface's id. The CLI reads it as the default `--surface`; bun handlers resolve the owning workspace from it for `ht plan`, `ht set-status`, `ht log`, `ht notify`. |
| `HYPERTERM_PROTOCOL_VERSION` | `1` | Set on every spawned shell. Sideband clients use it as a "are we inside τ-mux?" check. |
| `HYPERTERM_CHANNELS` | `{"meta":3,"data":4,"events":5}` | JSON channel map for the sideband protocol. |
| `TERM` | `xterm-256color` | Standard terminfo entry. |
| `COLORTERM` | `truecolor` | Indicates 24-bit color support to TUIs. |

## Read by the CLI / clients

| Variable | Effect |
|---|---|
| `HT_SOCKET_PATH` | Override `/tmp/hyperterm.sock`. |
| `HT_SURFACE` | Default `--surface` for `ht` commands. |
| `HYPERTERM_DEBUG` | Enables debug logs in the Python / TS sideband clients. |

## Common patterns

### Force web mirror in a launchd plist

```xml
<key>EnvironmentVariables</key>
<dict>
  <key>HYPERTERM_WEB_PORT</key>
  <string>3000</string>
</dict>
```

### Custom socket per project

```bash
export HT_SOCKET_PATH=/tmp/foo.sock
bun start                          # τ-mux uses this
HT_SOCKET_PATH=/tmp/foo.sock ht ping
```

### Disable test hooks for a build

```bash
HYPERTERM_INCLUDE_TEST_HOOKS=0 bun run build:stable
```

## Read more

- [Settings](/configuration/settings/)
- [`ht` overview](/cli/overview/)
