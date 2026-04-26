# Plan 07 — Telegram resilience: a crash must not break ht / notifications

## Source quote

> # When telegram crash, notification dont work and ht dont work anymore
> and ht dont work (socket down?)

## Symptom

When the Telegram bot service throws (network blip, bad token, server
500), several adjacent features break:

- macOS / sidebar notifications stop firing.
- `ht <anything>` hangs or fails — strongly suggests the socket
  server has gone away too.

This is a **fault-isolation** issue: Telegram is one bounded
subsystem; its failure should be observable but contained.

## Investigation hypotheses

### H1 — unhandled rejection takes the process down

`src/bun/telegram-service.ts` does long-poll fetches. An unhandled
async error in the polling loop (rejected promise without `catch`,
or a `throw` inside an event listener) can crash the whole Bun
process. With the process dead, the socket server dies too — hence
`ht` stops working.

### H2 — synchronous SQLite write that throws

`telegram-db.ts` uses bun:sqlite. A schema error or a busy lock that
throws on the main thread can take everything down.

### H3 — fd lifecycle

If the long-poll fetch shares an event-loop resource with the socket
server (e.g. an unhandled HTTP/2 connection), a teardown could close
the wrong handle.

## How to verify

1. Tail `~/Library/Logs/tau-mux/app-*.log` while reproducing.
2. Force a failure — set `telegramBotToken` to junk; observe
   `telegram-service.ts` behaviour.
3. Check `ps` of the running app: did the main process exit?
   - If yes — H1 / H2.
   - If no but `ht` hangs — H3.

## Resilience design

### Top-level guards

In `src/bun/telegram-service.ts`:

- Every async function wrapped in try/catch with `logger.error(...)`
  and a circuit-breaker that stops polling after N consecutive
  failures (already exists?). Verify.
- All event listeners (`bot.on('message', ...)`) wrapped so a thrown
  handler doesn't escape.
- `process.on('unhandledRejection')` and `process.on('uncaughtException')`
  hooks at the very top of `src/bun/index.ts` that:
  - Log the error.
  - If the offending stack contains `telegram`, mark the service
    `error` and **continue** (don't exit).
  - For unrelated crashes, exit (current behaviour is correct).

### State machine

`TelegramService` already has a state machine
(`disabled | starting | polling | error`). Make `error` a recoverable
state:

- Surfaces `service.lastError` in `ht telegram status`.
- Exposes `service.restart()` callable from the settings panel and
  via `ht telegram restart` CLI command.
- Auto-retry with exponential backoff (current behaviour?). Cap at
  e.g. 5 minutes between attempts.

### Notifications / ht decoupling

- Notifications: `notification.create` RPC must not depend on the
  Telegram service's state. Verify by reading
  `src/bun/rpc-handlers/notification.ts` — it currently appears to
  forward to telegram if `telegramForwardEnabled` is set. If a forward
  fails, log and continue; don't propagate the error to the original
  notification path.
- `ht`: socket-server lifecycle is independent. If the socket dies
  unexpectedly, log + try to rebind. New `SocketServer.health()`
  returns `bound | unbound`; if unbound, attempt rebind every 5s.

### Healthcheck

New `system.health` RPC returns:

```jsonc
{
  "ok": true,                    // false if any subsystem is broken
  "subsystems": {
    "pty": "ok",
    "metadata": "ok",
    "telegram": "error: BOT_TOKEN_INVALID",
    "socket": "ok",
    "webserver": "ok"
  }
}
```

Sidebar shows a one-pixel red dot on the workspace card when any
subsystem is broken; clicking opens the system panel.

## Files

- `src/bun/index.ts` — install top-level error handlers.
- `src/bun/telegram-service.ts` — wrap handlers, verify breaker.
- `src/bun/telegram-db.ts` — WAL mode + retries on `SQLITE_BUSY`.
- `src/bun/socket-server.ts` — auto-rebind on bind loss.
- new `src/bun/health.ts` — aggregator for system health.
- `src/bun/rpc-handlers/system.ts` — `system.health` RPC.
- `src/bun/rpc-handlers/notification.ts` — wrap telegram forward in
  try/catch.
- `bin/ht` — `health` and `telegram restart` subcommands.
- `src/views/terminal/sidebar.ts` — health pill.

## Tests

- `tests/telegram-resilience.test.ts` — inject a throwing message
  handler; assert process is still alive; assert `ht ping` succeeds.
- `tests/socket-rebind.test.ts` — close socket out from under the
  server; assert it rebinds within 10s.
- `tests/system-health.test.ts` — broken telegram → `ok: false` but
  `pty: "ok"`.

## Effort

M — most of this is plumbing existing failure modes through the new
health aggregator. Bulk of work is the test fixtures for forced
failures. ~2 days.

## Risks

- Auto-rebinding the socket can mask real configuration errors
  (multiple instances of the app fighting for `/tmp/hyperterm.sock`).
  Mitigation: if rebind fails 3× in a row, log loudly and surface
  `socket: "error"` in health.
- Telegram restart from settings panel must avoid double-start (a
  guard in `service.start()` already exists; verify).
