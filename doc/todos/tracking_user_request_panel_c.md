# Tracking — Plan 10 (Commit C): webview modal for ht ask

**Plan**: [`plan_user_request_panel.md`](plan_user_request_panel.md)
**Sister tracking**: [`tracking_user_request_panel.md`](tracking_user_request_panel.md) (Commit A — backend) · [`tracking_user_request_panel_b.md`](tracking_user_request_panel_b.md) (Commit B — Telegram)
**Status**: done
**Status changed**: 2026-04-28
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this session — Commit C

Webview modal that consumes the `askUserEvent` push channel (already
emitted by bun since Commit A) and lets the user answer `ht ask`
questions directly from τ-mux. Four kinds: yesno · choice · text ·
confirm-command. Per-surface FIFO state, sidebar pending badge,
keyboard intercept, snapshot-on-bootstrap so a webview reload doesn't
strand pending requests.

Web-mirror UI deferred (Plan #13 territory) — for this commit the
web-client dispatcher only registers no-op stubs so the broadcasts
stop landing on the floor.

## Step-by-step progress

- [x] `src/views/terminal/ask-user-state.ts` — pure per-surface FIFO
      store (push / resolve / seed snapshot / subscribe)
- [x] `tests/ask-user-state.test.ts` — 13 hermetic state tests
- [x] `src/views/terminal/ask-user-modal.ts` — DOM + focus controller
      (singleton overlay, four kind variants, two-step confirm gate,
      attribution line, unsafe banner, test hooks)
- [x] `tests/ask-user-modal-dom.test.ts` — 11 DOM tests via test hooks
- [x] `src/views/terminal/index.css` — `.ask-user-overlay`,
      `.ask-user-sheet`, `.ask-user-attribution`, `.ask-user-body`,
      `.ask-user-codebox`, `.ask-user-unsafe-banner`,
      `.ask-user-choices`, `.ask-user-actions`, `.ask-user-btn-danger`,
      `.workspace-ask-badge`
- [x] `src/views/terminal/index.ts` — bootstrap snapshot
      (`askUserRequestSnapshot` rpc + `askUserEvent` listener) +
      `installAskUserModal` after surfaceManager + keyboard guard
      below settings-panel
- [x] `src/views/terminal/sidebar.ts` — `setAskUserPending(map)`
      setter + per-workspace badge render in `buildCardHeader`
- [x] `src/web-client/protocol-dispatcher.ts` — `askUserShown` /
      `askUserResolved` cases (no-op; web mirror UI deferred)
- [x] `src/shared/types.ts` — `bun.messages.askUserAnswer`,
      `askUserCancel`, `askUserRequestSnapshot`
- [x] `src/bun/index.ts` — three matching message handlers route to
      the existing `AskUserQueue`
- [x] `bun run typecheck` clean
- [x] `bun test` — new tests green; flaky pre-existing web-mirror
      timing tests (≤7) unrelated to this change
- [x] `bun scripts/audit-emoji.ts` clean (Commit B retro item)
- [x] `bun scripts/audit-animations.ts` clean
- [x] `bun scripts/audit-test-hooks.ts` clean
- [ ] `bun start` smoke (deferred — environment is headless;
      user-side verification needed for end-to-end click-through)
- [ ] `bun run bump:patch`
- [ ] Commit

## Deviations from the plan

1. **Webview→bun bridge is messages, not requests.** The plan called
   for the modal to use `agent.ask_answer` / `agent.ask_cancel` /
   `agent.ask_pending` (the existing socket-RPC handlers). Those
   aren't reachable from the Electrobun webview channel — `bun.requests`
   was `Record<string, never>` and adding a request endpoint forks
   the codebase pattern. Instead, added three new `bun.messages`:
   `askUserAnswer`, `askUserCancel`, `askUserRequestSnapshot`. The
   bun handlers thin-wrap the existing `AskUserQueue` instance (same
   one the socket handlers drive), so there's still one source of
   truth. The snapshot path uses the existing `askUserEvent` push
   channel with `kind: "snapshot"` — type was already defined in
   commit A but never emitted; now it is.
2. **Active-surface signal is `ht-surface-focused` window event, not
   a new `onActiveSurfaceChange` listener.** The plan suggested
   patching `SurfaceManager` to add a focus-listener API; in fact
   `surface-manager.ts:672` already dispatches a `ht-surface-focused`
   `CustomEvent` on `window` for every focus transition. The modal
   subscribes to that — zero surface-manager change.
3. **`renderConfirmCommand` adds a third "Back" button** that the
   plan didn't enumerate (plan listed Cancel + I-understand on
   step 1, then Cancel + Run on step 2). Without a "Back", a user
   who taps "I understand" by accident has no path to step 1
   except cancelling and waiting for the agent to re-ask. Back
   keeps the gate friendly without defeating the two-step intent.
4. **No "Open question waiting" sidebar attribution per surface row** —
   plan suggested per-surface badge inside the workspace card's
   pane list. The pane list shows titles only (no surface ids), so
   the per-surface mapping would require expanding `WorkspaceInfo`
   and risking sidebar test churn. Shipped a per-workspace pill
   instead (header next to pane-count badge), which surfaces the
   same signal with less invasive plumbing. Per-surface row
   attribution is a follow-up if needed.
5. **No bun-side test for the new `askUser*` message handlers.**
   The handlers thin-wrap `AskUserQueue` methods that already have
   16 unit tests (Commit A) + 9 RPC integration tests + `bin/ht
   ask` snapshot tests. Adding a bun-side unit test for the wire-
   adapter layer would cover ~6 LOC of glue with the same coverage
   the queue tests already provide.

## Issues encountered

1. **TypeScript `dataset.foo` vs `dataset["foo"]`.** TS strict mode
   rejects dot-access on the `DOMStringMap` index signature. Caught
   by `bun run typecheck`; bulk-fixed with sed across the modal
   file. Lesson: use bracket notation for `data-*` reads/writes
   from the start.
2. **Forward-reference order for closures in `defineRPC`.** The
   `askUserEvent` message handler captures `askUserState` by
   reference at module load. Since the RPC handlers fire only
   after bootstrap, the reference resolves correctly at call time,
   but the `const askUserState = new AskUserState();` declaration
   has to land before the `defineRPC` call to satisfy TS's
   block-scoped rule. Mirrors the existing `let surfaceManager`
   forward-declaration pattern.

## Open questions

- Should `Esc` on a confirm-command modal cancel-with-rollback the
  ack state, or just cancel the request? Today it cancels the
  request — same as the other kinds. Could revisit if user feedback
  suggests two-step Esc would be friendlier.

## Verification log

| Run                                                     | Result                              |
| ------------------------------------------------------- | ----------------------------------- |
| `bun run typecheck`                                     | clean (after dataset bracket fix)   |
| `bun test tests/ask-user-state.test.ts`                 | 13/13 pass                          |
| `bun test tests/ask-user-modal-dom.test.ts`             | 11/11 pass                          |
| `bun test` (full)                                       | 1447/1454 — 7 unrelated flaky web-mirror timing failures pre-existed on stashed main |
| `bun test tests/ask-user-*.ts tests/rpc-handler-ask-user.test.ts tests/telegram-ask-links.test.ts` | 84/84 pass |
| `bun test tests/sidebar*.test.ts tests/surface-manager.test.ts` | 68/68 pass             |
| `bun scripts/build-web-client.ts`                       | bundle written                      |
| `bun scripts/audit-emoji.ts`                            | clean (0 emoji code points)         |
| `bun scripts/audit-animations.ts`                       | clean (0 violations)                |
| `bun scripts/audit-test-hooks.ts`                       | clean                               |
| Bun process boot smoke                                  | initializes without my code crashing — full GUI verification needs a desktop session and is left to the user |

## Commits

- `1bf0052` — ask-user: webview modal for ht ask (Plan #10 commit C)
  - 14 files, +1669 / -3
  - 5 new files (ask-user-state, ask-user-modal, 2 tests, tracking)
  - 9 modified files (types, bun index, webview index, css, sidebar,
    web-client dispatcher, plus the version-bump trio)

## Retrospective

What worked:
- Splitting the work the same way Commit A split itself: pure-state
  module + thin DOM adapter. State has 13 hermetic tests; DOM has
  11 happy-dom tests via the prompt-dialog-style test hooks
  (`readActiveAskUserModal`, `submitActiveAskUserModal`,
  `cancelActiveAskUserModal`, `ackActiveAskUserModal`). End-to-end
  modal coverage without spinning up Electrobun.
- Reusing the `prompt-*` CSS classes for the inputs + buttons. The
  modal inherits any future theming that lands on prompt-dialog.
- `installAskUserModal({...})` signature with callbacks (onAnswer /
  onCancel / getActiveSurfaceId / getAttribution) instead of importing
  `surfaceManager` / `rpc` globals. Tests inject lightweight stubs;
  the real wire-up happens once in index.ts.
- The `ht-surface-focused` window event already existed — saved
  patching `SurfaceManager` to add a focus-listener API.
- All four kind variants share the same `prompt-*` chrome so the
  modal feels native to the rest of the app. The two-step confirm-
  command gate landed as 30 LOC inside the kind-specific helper.

What I'd do differently:
- The modal mounts a fresh DOM tree on every state transition for
  the active surface — fine for one-at-a-time UX but wasteful if
  the queue churns rapidly. A future refinement: keep a sheet
  scaffold mounted and swap only the body / actions on re-render.
  Out of scope for v1.
- The dataset-bracket-vs-dot trap caught me on the first typecheck
  run. Could have been avoided by setting `data-*` via
  `setAttribute("data-foo", ...)` from the start; instead I used
  the cleaner `el.dataset.foo = ...` ergonomic and ate the typecheck
  fail.
- I considered an end-to-end Playwright test (`tests-e2e/`) that
  would launch the real Electrobun app and exercise the modal via
  a sibling `ht ask` shell. Decided against for v1: the unit tests
  cover the DOM logic; the manual-verification path is short.

Carried over to follow-ups:
- Web mirror modal UI (Plan #13).
- Persist `title` in `ask_user_links` for restart-safe Telegram
  resolution edits (Commit B retro).
- Per-surface row badge inside the workspace card pane list (today
  ships per-workspace header pill).
- Cancel-via-text path for force_reply prompts.
- Typing-deferred-mount pill for mid-typing modal arrival.
- Visual sheet anchored over the originating pane bounds (today
  ships full-screen with attribution line — chosen via plan-mode
  question).
- `bun run audits` aggregate script that bundles every
  `scripts/audit-*.ts` (every commit since Plan #07 has hit at
  least one of these traps).
