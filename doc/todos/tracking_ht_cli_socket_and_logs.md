# Tracking — Plan 01: ht CLI socket + logs

**Plan**: [`plan_ht_cli_socket_and_logs.md`](plan_ht_cli_socket_and_logs.md)
**Status**: done
**Status changed**: 2026-04-26
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main` (commits land here per CLAUDE.md workflow)

## Step-by-step progress

### A. Real socket path in `system.identify`
- [x] Add `socketPath` field to `HandlerDeps` (`src/bun/rpc-handlers/types.ts`) — also added `logPath`
- [x] Plumb it through `createRpcHandler` (`src/bun/rpc-handler.ts`) via new `RpcHandlerOptions.socketPath` + `logPath`, with `/tmp/hyperterm.sock` + `null` defaults
- [x] `src/bun/index.ts` — moved `socketPath` computation up so it's available to both `createRpcHandler` and `SocketServer`; passed `loggerHandle.currentPath` as `logPath`
- [x] `system.identify` reads from deps instead of hardcoding; now also returns `log_path`
- [~] `socket-server.ts` getter — **deviation, see below**
- [x] Test: extended `tests/rpc-handler.test.ts` with two assertions (default fallback + custom path)

### B. Clean up `ht --help` + add `ht doctor`
- [x] Delete debug `console.log` lines (`bin/ht:17-18`)
- [x] Implement `ht doctor` — prints socket path, env-var status, bun version, reachability, bound socket path (with drift warning), log path, focused surface, active workspace, app version
- [x] Help text addition

### C. `ht log` discoverability
- [x] Expand help text (`bin/ht`) with usage example
- [~] `shareBin/log_demo` sample — **deviation, see below**
- [x] Worked example in `doc/system-rpc-socket.md` (build-script wrapper, level table, source convention)

### D. Surface log path
- [~] `getLogDir()` / `getCurrentLogPath()` exports — **deviation, see below**
- [x] `bin/ht logs` subcommand (prints path; `--tail` streams via `tail -F` with SIGINT cleanup)
- [x] "Reveal Log File in Finder" menu item (`src/bun/native-menus.ts` + `revealLogFile()` in `index.ts`, uses `open -R`)
- [x] Settings panel — Advanced section diagnostics block (log path / socket / config dir read-only + Reveal button) wired through new `restoreDiagnostics` push and `revealLogFile` webview→bun message

### E. Tests + verification
- [x] `tests/bin-ht-help.test.ts` — snapshot guard for help banner + offline `doctor` smoke (4 tests)
- [x] `system.identify` + custom-options coverage in `tests/rpc-handler.test.ts`
- [~] `tests/logger-paths.test.ts` — **deviation: existing `tests/logger.test.ts` already covers `currentPath`, no separate helper to test**
- [x] `bun run typecheck` clean
- [x] `bun test` — 865/865 green (up from 860 baseline; +4 in bin-ht-help, +1 in rpc-handler)
- [ ] `bun start` smoke — **see Open Questions; not run in this session**
- [x] `bun run bump:patch` — 0.2.0 → 0.2.1
- [ ] Commit (next)

## Deviations from the plan

1. **No `socketPath` getter on `SocketServer`** (2026-04-26).
   The plan suggested exposing one for symmetry. In practice the path
   is computed once in `src/bun/index.ts` *before* either the RPC
   handler or the SocketServer needs it, so threading the same
   constant into both via `RpcHandlerOptions.socketPath` is strictly
   simpler — and the SocketServer ctor already takes the path
   privately. Adding a getter would be dead surface area.
2. **No `getLogDir()` / `getCurrentLogPath()` module-level exports**
   from `src/bun/logger.ts`. The plan asked for them, but the
   existing `LoggerHandle.currentPath` interface already exposes
   exactly what callers need. The `index.ts` boot code holds the
   handle and passes `currentPath` into both `RpcHandlerOptions.logPath`
   and the `restoreDiagnostics` push. No new module-level state would
   improve that.
3. **No `shareBin/log_demo` sample script.** The worked example in
   `doc/system-rpc-socket.md` is a bash build-script wrapper that
   covers progress / success / error / warning levels in one
   meaningful flow. A separate dummy script would have been less
   instructive than reading the doc; deferring until someone hits a
   gap.
4. **Added `log_path` alongside `socket_path` in `system.identify`**
   (not strictly part of the plan). The CLI's new `ht logs` and
   `ht doctor` commands need the log path; instead of adding a
   second RPC method, I extended `identify` so a single round-trip
   covers both. Keeps the protocol smaller; matches the way users
   already think about "identify" as the diagnostic check.
5. **Diagnostics push channel** (`restoreDiagnostics` bun→webview,
   `revealLogFile` webview→bun) added for the Settings → Advanced
   readout. The plan didn't spec the wire shape; this matches the
   existing `restoreSettings` / `enableTestMode` push pattern.

## Issues encountered

(none — no rework, no failed runs)

## Open questions for the user

- **Manual `bun start` smoke not run in this session.** Typecheck
  + 865 unit tests are clean; the Settings → Advanced UI is a small
  pure-DOM change so I'm fairly confident it renders, but I haven't
  visually verified the path readout / Reveal button or the new
  "Reveal Log File in Finder" menu item against the running app.
  Suggested before merge: open Settings → Advanced, confirm the
  three rows render with real paths, click Reveal, confirm Finder
  opens with the log file selected.

## Verification log

| Run                                | Result                                  |
| ---------------------------------- | --------------------------------------- |
| `bun run typecheck`                | clean (after every edit)                |
| `bun test tests/rpc-handler.test.ts` | 38/38 pass                            |
| `bun test tests/bin-ht-help.test.ts` | 4/4 pass                              |
| `bun test` (full suite, post-edit) | 865/865 pass, 107314 expect() calls     |
| `bun bin/ht --help` (manual)       | clean output, no debug prints           |
| `HT_SOCKET_PATH=/x bun bin/ht doctor` | reports unreachable socket cleanly   |
| `bun run bump:patch`               | 0.2.0 → 0.2.1                           |

## Commits

(populated after commit lands)
