# Plan 01 — ht CLI: socket discovery, `ht log`, log path discoverability

## Source quotes (`doc/issues_now.md`)

> - ht log : i dont know what it does
>
> # Ht issue
> echo $HT_SOCKET_PATH but: `ht identify` returns
> `socket_path: "/tmp/hyperterm.sock"` — it is hardcoded in `system.ts`
> `/tmp/hyperterm.sock` is present everywhere but i think it is never
> used anymore (maybe in tests?). For ht to work on any terminal, just
> export the right socket: `~/Library/Application Support/hyperterm-canvas/hyperterm.sock`
> i did it in `.zshrc`.
>
> #where is the log file?? i never remember

## Three coupled bugs

### A. `system.identify` hardcodes the socket path

`src/bun/rpc-handlers/system.ts:54` returns:

```ts
"system.identify": () => ({
  focused_surface: state.focusedSurfaceId,
  active_workspace: state.activeWorkspaceId,
  socket_path: "/tmp/hyperterm.sock",  // ← lie
});
```

The actual socket path the running app bound to lives in
`SocketServer` and depends on `HT_SOCKET_PATH` / app-support fallback.
The CLI uses `process.env["HT_SOCKET_PATH"] || "/tmp/hyperterm.sock"`
(`bin/ht:10`), so users who export the right path can connect — but
`ht identify` lies to them, defeating the diagnostic value of the
command.

### B. `ht --help` leaks debug `console.log`

`bin/ht:17-18`:

```ts
printHelp();
console.log(SOCKET_PATH);
console.log(process.env["HT_SOCKET_PATH"]);
```

Two stray debug prints at the end of the help output. Should be removed
or moved into a dedicated `ht doctor` / `ht env` subcommand.

### C. `ht log` is undocumented at the user level

`ht log` (`bin/ht:426`) maps to `sidebar.log` and pushes a sidebar log
entry. The help text `log [--level L] [--source S] "message"` is
present (`bin/ht:1259`) but the user has forgotten what it does. The
fix is doc + examples + a sample shareBin script that uses it.

### D. Log file path is hard to find

Users routinely ask "where's the log file?". Today:
`~/Library/Logs/tau-mux/app-YYYY-MM-DD.log` (`src/bun/logger.ts:9-13`).
There is no CLI command, menu item, or settings UI that surfaces this.

## Proposal

### A. Real socket path in `system.identify`

Plumb the actual bound socket path from `SocketServer` through
`HandlerDeps`:

1. `socket-server.ts` already knows the path it bound to. Expose a
   `getSocketPath()` getter, or pass the path into `createRpcHandler`.
2. Extend `HandlerDeps` (`src/bun/rpc-handlers/types.ts`) with
   `socketPath: string`.
3. Wire it in `src/bun/index.ts` where the handler aggregator is
   constructed.
4. `system.identify` returns the real path.

Smoke test: spawn the app with `HT_SOCKET_PATH=/tmp/foo.sock`, then
`ht identify` → should print `/tmp/foo.sock`.

### B. Clean up `ht --help`

Delete the two stray `console.log` lines after `printHelp()` in
`bin/ht`. Add an `ht doctor` subcommand that prints:

- Resolved `SOCKET_PATH` (and whether `HT_SOCKET_PATH` was set)
- Whether the socket is reachable (`stat` + `connect`)
- App version (`system.version`)
- Log file path (today's file + dir)
- Bun runtime version

This becomes the canonical "is my CLI talking to the right app?"
command. Plan #14 also adds the git-author audit to `ht doctor`.

### C. `ht log` discoverability

In help text (`bin/ht:1254-1264`), move the `log` example next to
`set-status`, with a usage line:

```
log [--level info|warn|err] [--source NAME] "message"
    Push a line to the sidebar log of the active (or specified) surface.
    Example: ht log --level warn --source build "tsc reported 3 errors"
```

Add a worked example to `doc/system-rpc-socket.md` and a tiny
`shareBin/log_demo` script that emits one entry per level so users
can see what each looks like in the sidebar.

### D. Surface log path

Three small UI affordances:

1. Add `ht logs` CLI command — prints `~/Library/Logs/tau-mux/`
   (and today's file path). Optional `--tail` flag streams the file
   (just `Bun.spawn(["tail", "-F", path])`, inheriting stdio).
2. Add a "Reveal log file in Finder" item in the existing app menu
   (`src/bun/native-menus.ts`). Uses Electrobun's `shell.openPath`.
3. Settings → Advanced section: a read-only field showing the log dir
   with a "Reveal" button.

## Files to touch

- `src/bun/rpc-handlers/types.ts` — add `socketPath` to `HandlerDeps`.
- `src/bun/rpc-handlers/system.ts` — read it instead of hardcoding.
- `src/bun/socket-server.ts` — expose `socketPath` getter.
- `src/bun/index.ts` — pass through.
- `src/bun/logger.ts` — export `getLogDir()` + `getCurrentLogPath()`.
- `bin/ht` — remove debug prints; add `doctor` and `logs` subcommands;
  expand help text for `log`.
- `src/bun/native-menus.ts` — "Reveal log file" menu item.
- `src/views/terminal/settings-panel.ts` — Advanced → log path readout.
- `doc/system-rpc-socket.md` — `ht log` worked example.
- `doc/system-pty-session.md` — note about `HT_SOCKET_PATH` env.

## Tests

- `tests/bin-ht.test.ts` (new) — snapshot help output (no debug prints).
- `tests/socket-identify.test.ts` — assert `system.identify` returns
  the bound socket path, not the literal `/tmp/hyperterm.sock`.
- `tests/logger.test.ts` — `getCurrentLogPath()` matches the existing
  rotation rule.

## Risks / open questions

- `system.identify` is part of the documented protocol — if external
  scripts already depended on the old hardcoded value, the fix is a
  behaviour change. Acceptable: the old value was wrong.
- `ht doctor` might overlap with `ht ping --verbose`. Decision: keep
  ping minimal; doctor is the "diagnostic kitchen sink" and links to
  the log path so users can post it in bug reports.

## Effort

S — half a day. Pure plumbing + small CLI additions.
