---
title: Testing
description: Unit, e2e, and design-report suites — what each covers and when to run them.
sidebar:
  order: 3
---

τ-mux ships three test suites and a design-report pipeline.

## Unit / integration

```bash
bun test                   # ~9 s, 800+ tests across 50+ files
bun run typecheck
```

Coverage:

- `ps` / `lsof` / sideband parsers (pure-function tests, no subprocesses).
- PTY manager.
- RPC handlers (every domain).
- Pane layout (binary-tree split math).
- Web-client reducer + view modules (DOM via `happy-dom`).
- Native sidebar notification lifecycle.
- Agent panel sub-modules.
- SurfaceManager smoke suite.
- Shared sound helper.
- Telegram db / service / settings / forwarder.

`bunfig.toml` scopes bare `bun test` to `tests/` only — `tests-e2e/` Playwright specs are not picked up.

## Web e2e

```bash
bun run test:e2e           # ~1 min, 43 Playwright specs
```

Each spec spawns an isolated `WebServer` in a Bun subprocess via `tests-e2e/server-boot.ts` so workers don't share state. Coverage:

- **Auth** — open access, query-string token, `Authorization: Bearer`, wrong-token 401.
- **Origin validation** — same-host upgrade 101, cross-origin upgrade 403 even with a valid token.
- **Terminal round-trip** — browser loads the page, xterm renders, keystrokes reach the shell, stdout appears in the DOM.
- **Resilience** — stdin size cap doesn't kill the connection, resize clamping doesn't either, `?resume=<id>&seq=<n>` replays buffered output after a disconnect, unknown resume ids fall back to a fresh `hello`.

Playwright targets Chromium only — add Firefox/WebKit under `projects:` in `playwright.config.ts` for wider coverage.

## Native e2e

```bash
bun run test:native              # full native suite
bun run test:native:bloom-on     # with WebGL bloom enabled
bun run test:native:packaged     # against the packaged .app
bun run test:native:design-review
```

Drives the Electrobun webview directly via Playwright's connection-over-CDP path. Useful for visual regressions and shortcut-handling tests that the web mirror can't catch.

## Design report

A custom pipeline that captures screenshots from a curated set of routes and diffs them against baselines.

```bash
bun run report:design:web                # web mirror only (fast)
bun run test:full-suite                  # web + native + design gate
bun run baseline:design                  # promote current screenshots to baseline
```

Output lives at `test-results/design-report/index.html`. The `--gate` form fails CI if any screenshot exceeds the configured pixel-diff threshold.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs `typecheck + bun test` and `Playwright e2e` on every push and PR. Both jobs run on `macos-latest` — the PTY / `ps` / `lsof` integration tests rely on macOS behavior, and the e2e boot spawns a real `WebServer` driven by a real `SessionManager`.

## When to run what

| Change | Suite |
|---|---|
| Pure function / parser change | `bun test` (the relevant file). |
| RPC handler / new method | `bun test` + `bun run typecheck`. |
| Web mirror server change | `bun test` + `bun run test:e2e`. |
| Webview UI / xterm interaction | `bun run test:native`. |
| Visual change | `bun run report:design:web`, then promote baseline once happy. |
| Before opening a PR | `bun run test:full-suite`. |

## Read more

- [Building](/development/building/)
- [Architecture deep-dive](/development/architecture/)
- [Contributing](/development/contributing/)
