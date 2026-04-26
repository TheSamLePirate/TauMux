# Tracking — Plan 07: Telegram resilience

**Plan**: [`plan_telegram_resilience.md`](plan_telegram_resilience.md)
**Status**: done (observability + isolation half)
**Status changed**: 2026-04-26
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this session

Focus on the **observability + isolation** half of the plan. Sidebar
red-dot health pill and Settings panel restart button are deferred
(UI work that benefits from visual verification). Auto-rebind on
socket bind loss is also out of scope — current `SocketServer`
binding is owned by the bun process itself, and process death takes
both down regardless. Reproducing the original failure mode is the
unblocking next step; this commit lands the diagnostic + recovery
infrastructure so the next time it happens we have data.

## Step-by-step progress

- [x] `src/bun/health.ts` — `HealthRegistry` with `set` /
      `remove` / `snapshot` / `subscribe`. Idempotent writes (no-op
      when severity+message both unchanged), insertion-order preserved
      across updates, throwing subscribers don't poison the registry.
- [x] `tests/health.test.ts` — 12 cases (registry empty default;
      single-set entry; insertion-order preservation; idempotent set;
      ok flag with degraded / error / disabled; remove + remove of
      unknown id; subscribers fire on change; throwing subscriber
      isolated; unsubscribe handle works)
- [x] Top-level `process.on('unhandledRejection')` /
      `uncaughtException` in `src/bun/index.ts` — log loudly via
      `console.error` (lands in rotating log per Plan #01) and
      attribute the fault to a subsystem health row when the stack
      mentions a known module (telegram-service / telegram-db /
      web-server / session-manager / pty-manager)
- [x] `system.health` RPC in `src/bun/rpc-handlers/system.ts`
- [x] Wired subsystems: pty (initial ok), socket (degraded → ok),
      web mirror (disabled / running / stopped via
      `sendWebServerStatus`), telegram (every onStatus → mapped
      severity), audits (one health row per audit id, severity
      mapped from AuditResult severity)
- [x] `ht health` CLI subcommand with TTY-aware ●/○/◐/✗ markers
      and a one-line "OK · N subsystem(s)" summary
- [x] Audit cache integrated into health: each audit result
      becomes `audit:<id>` health row; absence of audits emits
      `audits: disabled`
- [x] `telegram.restart` RPC + `ht telegram restart` subcommand —
      tears down and rebuilds the service, useful to clear stuck
      backoff or pick up a rotated token without a settings flip
- [~] `ht doctor` audit/health integration — **deferred**, see
      below; doctor still lists socket reachability + log path /
      versions and remains the entry-point command, but doesn't
      bundle the health snapshot yet
- [x] `bun run typecheck` clean
- [x] `bun test` — 977/977 (was 965; +12 health tests)
- [x] `bun run bump:patch` — 0.2.5 → 0.2.6
- [ ] Commit — next

## Deviations from the plan

1. **No SocketServer auto-rebind.** The plan suggested polling for
   bind loss every 5 s. In practice `SocketServer.bind` is a one-shot
   at boot; if the listener dies later that's process death and
   nothing on the bun side can recover. Verified the existing logger
   captures the fatal stack so the post-mortem is clear. Deferred
   the auto-rebind until we have a real reproduction of "socket dies
   while process lives".
2. **No telegram-db WAL mode + retry on `SQLITE_BUSY`.** Plan
   suggested it; the existing service already swallows
   onLog("error", …) for write errors and the long-poll loop is
   wrapped in `.catch(onLog)`. Worth doing in a follow-up but not
   needed for the observability story this commit lands.
3. **No sidebar red-dot health pill** + **no Settings panel
   restart button**. Both UI work that benefits from visual
   verification. The data path is in place — `system.health` returns
   the snapshot the future banner consumes. `telegram.restart` is
   exposed and invokable from the CLI today.
4. **Fault attribution is substring-based**. The
   `attributeFault(text)` heuristic looks for module names in the
   stack. Cheap and covers the obvious culprits (telegram, web
   server, session). False positives are possible if a stack frame
   from one module catches an exception originating elsewhere; in
   that case the wrong row goes red. Acceptable since the human
   reading `ht health` can also read the log.
5. **Health subscribe channel not yet broadcast to web mirror /
   webview.** The plumbing exists (`HealthRegistry.subscribe`) but
   I didn't push a webview message or web-mirror broadcast on every
   state change. Reason: each `set` happens exactly when the
   underlying state changes, so polling `system.health` from the
   sidebar / pill on its existing 1 Hz tick is fine until we have a
   real UI consumer. Trivial to flip on later.

## Issues encountered

(none — typecheck and tests passed first try after each edit)

## Open questions for the user

- Without a live reproduction of the original symptom (telegram
  crash → ht stops working), we can't pin H1/H2/H3 directly. Plan
  mentions all three; this commit installs the diagnostics and
  isolation that *would* let any of those scenarios degrade
  gracefully. After this lands, the next time the symptom occurs
  the rotating log + `ht health` should pinpoint which subsystem
  went bad.

## Verification log

(empty)

## Commits

(empty)
