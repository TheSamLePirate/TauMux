---
title: Observability
description: Logging, CI gates, audit scripts — how to see what τ-mux is doing.
sidebar:
  order: 5
---

τ-mux is launched from Finder / Dock as often as from a terminal, so `console.log` output that vanishes into `launchd`'s `/dev/null` would leave large gaps in any post-mortem. The observability pipeline catches output everywhere it might go, persists it durably, and adds CI gates so regressions can't silently land on `main`.

## Persistent log files (`src/bun/logger.ts`)

`setupLogging(configDir)` wraps `process.stdout.write` + `process.stderr.write` and every `console.{log,error,warn,info,debug}` method so a copy of everything lands in a file on disk. The original TTY output is unaffected — running τ-mux from a terminal still shows live bun output; the file just captures the same bytes for later.

### Where files land

- **Production** (no `HT_CONFIG_DIR`): `~/Library/Logs/tau-mux/app-YYYY-MM-DD.log` — the standard macOS user-log location, visible in Console.app under "Log Reports".
- **End-to-end / dev** (`HT_CONFIG_DIR` set): `$HT_CONFIG_DIR/logs/app-YYYY-MM-DD.log` — keeps `~/Library/Logs` clean across hundreds of test runs.

### Rotation by date

One file per UTC calendar day, named `app-YYYY-MM-DD.log`. On the first write after midnight UTC the logger reopens with the new filename — no background timer. Files older than 14 days are pruned at boot, matching the `app-*.log` glob (so any user-placed file in the directory is left alone).

### Rotation by size (since 0.3.145)

A single multi-day session with a chatty subsystem (PTY noise, agent streams, sideband demos) could swell `app-DATE.log` to multi-GiB. To bound that, the logger also rotates by size:

- When the active file exceeds `HT_LOG_MAX_BYTES` (default **50 MiB**) it's renamed to `app-DATE.<n>.log` (next available index 1, 2, 3, …) and a fresh `app-DATE.log` is opened.
- `tail -f app-DATE.log` always follows the newest chunk; numbered chunks form the archive.
- On open, `fstatSync` seeds the byte counter from the existing file size — so a same-day restart picks up where the previous run left off rather than re-counting from zero.
- `HT_LOG_MAX_BYTES=0` (or any non-positive value) disables size rotation. Date rotation still applies.
- The 14-day prune pattern matches the numbered variants too — `app-DATE.<n>.log` files are deleted alongside the active chunk once they age out.

### Failure policy

Anything FS-related is wrapped in `try/catch`. A read-only home, a full disk, or a permission issue must **not** prevent the app from launching, so the logger silently falls back to "no file tee" and lets the TTY path continue as before.

### File mode

The log can carry bot tokens and auth handshake URLs, so files are `chmod 0o600` after open. The chmod runs even if the file pre-existed (a previous version might have shipped with looser permissions).

## CI coverage gate (`.github/workflows/ci.yml`)

The repository's CI runs two parallel jobs:

| Job | What it does |
|---|---|
| **typecheck-and-unit** | `bun run typecheck` then `bun test` on macOS-14. |
| **coverage-gate** | `bun run test:coverage` then `bun run report:coverage:check` on macOS-14. |

The coverage gate compares the freshly-generated `coverage/lcov.info` against `tests/baselines/coverage-baseline.lcov` per-file. If any file's lines-hit ratio dropped beyond a 0.5pp slack tolerance (to absorb floating-point rounding noise), the job exits non-zero and the PR is blocked.

To **lower the floor** intentionally — e.g. after deleting heavily-covered code — run `bun run baseline:coverage` locally and commit the new baseline. Promotion is the only way to drop the floor, and promotion goes through code review.

The per-file (rather than overall) comparison was a deliberate choice: an overall threshold can hide regressions inside a "covered enough" average, where the long tail of small modules quietly slips below the bar.

## CSS audit (`audit:theming`)

```bash
bun run audit:theming
```

Scans `src/views/terminal/index.css` and `src/web-client/client.css` for hard-coded colour literals outside the `:root` token block. Phase 7 brought the count from ~1013 to **zero** — every literal is now a `var(--ht-*)` reference. The script keeps the cluster clean by failing on any new hex / rgba / rgb literal a future PR would re-introduce.

See the [theme tokens reference](/configuration/themes/) for the full `--ht-*` vocabulary.

## Focus-glow audit (`tau-focus-audit`)

Design guideline §4: **"the focused pane is the only element in the UI with a glow."** A `tau-focus-audit.ts` module walks every chrome element and reports any `box-shadow` whose blur ≥ 4 px, alpha > 0.02, and colour is not the default near-black elevation shadow — anything that survives those filters is a chromatic glow leak.

Since 0.3.144 the audit is wired into `bun test` via a happy-dom fixture (`tests/tau-focus-audit.test.ts`, 10 tests). A glow leak in chrome CSS now fails the build instead of waiting for someone to open DevTools and run `window.tauAuditFocus()` manually.

The `window.tauAuditFocus()` hook is preserved for DevTools / REPL use — it pretty-prints the audit result in a coloured collapsible group.

## Health registry

The bun process registers a runtime "health" registry that aggregates audits (locale, bun-on-path, shell-exists, telegram bridge, web mirror, …). Each audit reports `ok` / `warn` / `error` and an optional remediation `fix()`. The registry's findings are shown in the Settings → Advanced panel and reachable via the `system.health` RPC.

## Project `CHANGELOG.md`

Generated at the repo root by `bump-version --changelog`. Conventional-commit grouped (feat / fix / perf / refactor / docs / test / chore / other). The website's [Changelog](/changelog/) page is the curated narrative; the repo file is the literal commit-grouped record.

## Read more

- [Release process](/development/release-process/) — version bumping, packaging, rollback.
- [Testing](/development/testing/) — test suite layout, coverage targets.
- [Theme tokens reference](/configuration/themes/) — the `--ht-*` vocabulary that `audit:theming` guards.
