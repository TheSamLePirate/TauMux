---
title: System
description: ping, version, identify, tree, capabilities.
sidebar:
  order: 2
---

System-level introspection commands. Useful in shell scripts to verify τ-mux is reachable and to enumerate what it can do.

## ping

```bash
ht ping
# PONG
```

Verifies the socket is reachable. Exit 0 on success; non-zero if the socket isn't there or τ-mux is unresponsive.

## version

```bash
ht version
# tau-mux 0.8.1 (build: …)
```

The reported version is stamped at build time from `package.json`. Maintainers cut releases via `scripts/bump-version.ts` (which propagates the version to seven files atomically and can also commit + tag + write `CHANGELOG.md` in one shot). See the [release process page](/development/release-process/) for the full workflow.

## identify

```bash
ht identify
# surface:1  workspace:0  cwd=/Users/me/code/foo  fg=bun run dev
```

Reports the focused surface and workspace, plus the same metadata `ht metadata` exposes — handy as a one-line "what am I looking at" probe.

## tree

```bash
ht tree
# Workspace ws:0 "build"
#   Pane (split right)
#     surface:1  ~/code/foo  bun run dev
#     surface:2  ~/code/bar
#   Pane
#     surface:3  ~/code/docs
```

Full workspace / pane / surface tree. Use `--json` for machine-readable output.

## capabilities

```bash
ht capabilities --json
```

Lists every JSON-RPC method the running τ-mux supports, with their parameter shapes. Always `--json`-friendly. Useful for agent-style integrations that want to discover features at runtime.

## Read more

- [JSON-RPC system methods](/api/system/)
- [`ht` overview](/cli/overview/)
