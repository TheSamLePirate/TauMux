---
title: Building
description: "bun start, bun dev, bun run build:stable, build:cli — what each one does."
sidebar:
  order: 1
---

τ-mux is built on Bun + Electrobun. Every build path goes through `bun` — there's no Node, no npm, no pnpm in the workflow.

## Day-to-day

```bash
bun install                # dependencies
bun start                  # build + launch once
bun dev                    # build + launch with --watch (rebuilds on src change)
```

`bun start` is the right default — single-shot rebuild, fast launch. `bun dev` keeps an Electrobun watcher alive so source edits hot-reload.

### Dev runtime is isolated from a stable install

`bun start`, `bun run dev`, and `bun run build:dev` set `HT_CONFIG_DIR=$HOME/Library/Application Support/hyperterm-canvas-dev` automatically. The dev runtime gets its own settings.json, telegram.db, browser-history, cookies, and Unix socket — so an installed stable τ-mux running on the same machine doesn't lose state when you launch dev, and `ht` invocations from inside a dev pane talk to the dev socket, not the installed app's. Stable / canary / package builds keep the default `~/Library/Application Support/hyperterm-canvas`.

## Tests

```bash
bun test                   # unit + integration suite (~9 s)
bun run test:e2e           # Playwright web-mirror specs (~1 min)
bun run test:native        # Playwright native-app specs
bun run test:all           # bun test + Playwright web e2e
bun run test:full-suite    # typecheck + bun test + web e2e + native + design report gate
bun run typecheck          # TypeScript only
```

`bunfig.toml` scopes bare `bun test` to `tests/` so the Playwright `tests-e2e/` specs are not picked up.

## Linting / type checking

```bash
bun run typecheck          # tsc --noEmit
```

There is no separate lint step — TypeScript strict mode catches most issues. The project's design guidelines live in `design_guidelines/`.

## Production builds

```bash
bun run build:dev          # dev .app (no CLI injection — requires stable/canary for `Install in PATH`)
bun run build:canary       # canary .app + DMG
bun run build:stable       # stable .app + DMG with bundled `ht` CLI
bun run package:mac        # stable build + post-package step (DMG, signing, etc.)
```

A `postBuild` Electrobun hook (`scripts/post-build.ts`) compiles `bin/ht` targeting the build's arch and injects it into the inner bundle before tarring. So `Install 'ht' Command in PATH` works out of the box on stable and canary builds.

## Standalone CLI binary

```bash
bun run build:cli          # → ./build/ht-cli
```

A static, self-contained `ht` binary with no Bun runtime requirement. Ship it to any Mac that has τ-mux running.

## Web client bundle

The web mirror's client lives at `src/web-client/` and bundles to `assets/web-client/client.js`:

```bash
bun run build:web-client                     # readable bundle
bun run build:web-client -- --minify         # production-minified
```

Both `bun start` and `bun run build:*` pre-run the web-client bundle before invoking Electrobun.

## Versioning

Per the project's CLAUDE.md, run `bun run bump:patch` (or `:minor` / `:major`) before committing. The bump script edits `package.json`, the Electrobun config, and any pinned version refs in one shot.

## Logs

Logs land in `~/Library/Logs/tau-mux/app-YYYY-MM-DD.log` — one file per day, rotating by date.

```bash
tail -f ~/Library/Logs/tau-mux/app-$(date +%Y-%m-%d).log
```

Tests redirect to `$HT_CONFIG_DIR/logs` to keep the real directory clean.

## Read more

- [Architecture](/concepts/architecture/)
- [Testing](/development/testing/)
- [Contributing](/development/contributing/)
