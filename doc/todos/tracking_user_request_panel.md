# Tracking — Plan 10 (Commit A): user-request queue + ht ask CLI

**Plan**: [`plan_user_request_panel.md`](plan_user_request_panel.md)
**Status**: Commit A done; panel UI + Telegram routing deferred
**Status changed**: 2026-04-27
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this session — Commit A

Backend protocol + queue + CLI that gives agents an end-to-end
"ask the user a structured question" flow without any UI panel.
Without the modal panel, the answering side runs through a sibling
CLI call (`ht ask answer <id> <value>`) — deterministic, scriptable,
testable. The webview modal + Telegram routing are pure polish on
top of this contract.

## Step-by-step progress

- [x] Types: `AskUserKind`, `AskUserChoice`, `AskUserRequest`,
      `AskUserResponse` in `src/shared/types.ts` + webview push
      contract `askUserEvent` (shown / resolved / snapshot tagged
      union)
- [x] `src/bun/ask-user-queue.ts`: id auto-generation, optional
      timer-injected timeout, pending list (global + per-surface
      filter), answer / cancel idempotent, throw-isolated subscribers
- [x] `tests/ask-user-queue.test.ts` — 16 cases (id increment,
      shown event, answer round-trip, cancel with reason, timeout
      via manual timer, answer-cancels-timer, unknown-id no-op,
      ordering, surface filter, resolved-leaves-list,
      throw-isolation, unsubscribe, full event sequence,
      idFactory, custom clock, idempotent answer)
- [x] `src/bun/rpc-handlers/ask-user.ts`: `agent.ask_user` (long-
      pending; awaits the response Promise the queue returns),
      `agent.ask_pending`, `agent.ask_answer`, `agent.ask_cancel`.
      Strict param validation; `kind=choice` requires non-empty
      `choices`.
- [x] `tests/rpc-handler-ask-user.test.ts` — 9 RPC integration
      cases (long-pending resolves on answer, cancel, pending list
      + filter, kind validation, choice validation, choice
      persistence, unknown-id resolved=false, missing required
      params throw)
- [x] `bin/ht ask` — `ask <kind>`, `ask pending`, `ask answer`,
      `ask cancel`. The kind subcommand uses `runRpc` with
      timeout=0 (the new optional 3rd param) to disable the watchdog
      so the long-pending RPC sits until answered. Exit codes:
      0 ok, 2 timeout, 3 cancel.
- [x] `runRpc` extended with optional `timeoutMs` parameter
      (default 5000; pass 0 to disable). Backwards-compatible with
      every existing callsite.
- [x] Wired `AskUserQueue` through `RpcHandlerOptions.askUser`;
      handler aggregator only registers `agent.ask_*` when wired
- [x] Bun → webview broadcast: subscribed once at bun bootstrap,
      forwards `shown` / `resolved` events as `askUserEvent` and
      mirrors them to web mirror (`askUserShown` /
      `askUserResolved` types). Debounce skipped — transitions are
      single-shot per request, not repeated.
- [x] `bun run typecheck` clean (after fixing the template-literal
      backtick collision in --help text)
- [x] `bun test` — 1080/1080 (was 1055; +16 queue, +9 RPC
      integration)
- [x] `bun run bump:patch` — 0.2.11 → 0.2.12
- [x] Commit — `3dd4744`

## Deferred

- Webview modal panel (UI work — the channel ships now)
- Telegram routing for ask_user (re-uses Plan #08 buttons, but
  needs a `confirm-command` two-step UX think)
- Sidebar badge for pending requests
- Settings: per-surface auto-cancel idle timeout default

## Deviations from the plan

1. **CLI-driven answering** instead of the modal panel for v1.
   Plan called for a webview modal anchored over the surface;
   without UI verification I shipped a sibling-CLI flow
   (`ht ask answer <id> <value>`) that's deterministic and
   scriptable. The agent's `ht ask` blocks; a human answers from
   any other shell. Telegram routing + the modal panel can land
   on top of the same `agent.ask_*` contract without churn.
2. **`runRpc` timeout made optional**. Plan didn't specify; the
   existing 5s watchdog was hard-coded. Adding a 3rd param with
   `timeoutMs=5000` default keeps every existing callsite working
   and lets `ht ask <kind>` pass 0 for the long-pending case.
3. **`confirm-command` does NOT enforce the two-step
   acknowledge / run UX** at the queue / RPC level. The `unsafe`
   flag is preserved on the wire so the panel can render the
   warning + two-button flow, but the queue treats it as a normal
   `ok` resolution. Splitting the action would have meant a
   different `AskUserResponse.action` shape just for one kind;
   keeping the wire uniform.
4. **Choice options accept `id:label` pairs in the CLI** via the
   `--choices` flag. Plan was vague on the parsing; this lets
   `ht ask choice --choices main:Main,dev:Develop` work without
   JSON. Bare comma list (`main,dev`) still works — id and label
   match.
5. **No request-id collision protection across queue restarts.**
   The queue is process-local; ids reset to `req:1` on bun
   restart. Documented as a caveat — agents that hold ids across
   bun process boundaries are inherently broken anyway.
6. **No `agent.ask_pending` snapshot push at startup.** The
   webview-side panel will land in a follow-up that calls
   `agent.ask_pending` once on mount + listens to `askUserEvent`
   for deltas. Snapshot-on-demand keeps the bun → webview wire
   simpler (no third event kind on every connection).

## Issues encountered

1. **Template-literal backtick collision in `--help` text.** I
   wrote ``sibling `ht ask answer`. Kinds:`` inside the
   `printHelp()` template literal — the embedded backticks closed
   the literal early. Caught by the `bin/ht --help` snapshot test
   (4 failures). Fixed by replacing with single quotes in the
   help copy. Lesson: when editing the help banner, double-check
   for unescaped backticks before running tests.

## Open questions

- Plan listed `kind: "confirm-command"` with a two-step
  acknowledge / run UX. The CLI ships all four kinds with the
  same answering flow; the two-step UX is purely visual and lands
  with the panel. The `unsafe` flag is preserved on the wire for
  future treatment.

## Verification log

| Run                                              | Result                              |
| ------------------------------------------------ | ----------------------------------- |
| `bun run typecheck`                              | clean (after backtick fix)          |
| `bun test tests/ask-user-queue.test.ts`          | 16/16 pass                          |
| `bun test tests/rpc-handler-ask-user.test.ts`    | 9/9 pass                            |
| `bun test` (full)                                | 1080/1080 pass, 107747 expect() calls |
| `bun bin/ht --help` (post-fix)                   | exits 0, includes "ask" section    |
| `bun run bump:patch`                             | 0.2.11 → 0.2.12                     |

## Commits

- `3dd4744` — ask-user: agent → user question protocol with ht ask CLI
  - 5 new files (ask-user-queue, rpc-handlers/ask-user, 2 tests, tracking)

## Retrospective

What worked:
- Splitting the queue into a pure-state module + a thin RPC
  adapter let me cover every behaviour with hermetic tests
  (manual timer factory + injected clock + custom idFactory).
  9 integration tests on top wire the actual `createRpcHandler`
  and assert the long-pending Promise resolves end-to-end.
- The CLI-driven answering flow is a great fallback shape — even
  without a panel, `ht ask` is end-to-end usable today (one shell
  asks, another answers). Future panel landing on top of the same
  RPC contract is purely additive.
- Extending `runRpc` with an optional timeout instead of forking a
  separate "long-pending" client kept the CLI codebase tight; the
  one site that needs it (`runAskQuestion`) passes 0 explicitly.

What I'd do differently:
- The `--help` template literal trap caught me on the first
  full-suite run. The `bin/ht --help` snapshot test from Plan #01
  did its job catching it, but ideally I'd wire a static-analysis
  check that spots embedded backticks inside the help banner. Low
  priority — caught in 30s by the suite.
- I considered persisting pending requests to disk so a bun
  restart wouldn't strand an awaiting agent. Decided against:
  agents that run a CLI synchronously die when the bun process
  does anyway, so persistence wouldn't help. Documented as a
  caveat in the deviation log.

Carried over to Commit B / follow-ups:
- Modal panel UI in the webview (channel + state already shipped)
- Telegram routing — re-uses Plan #08 callback infra; needs a
  new button-set for yesno/choice/text and a force_reply flow
  for the text/confirm-command kinds
- Sidebar pending badge (count of open requests by surface)
- `confirm-command` two-step UX (queue contract is in place via
  the `unsafe` flag; the panel implements the gate)
- Settings: per-surface auto-cancel default for stranded requests
