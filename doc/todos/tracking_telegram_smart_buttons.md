# Tracking — Plan 08: Telegram smart buttons

**Plan**: [`plan_telegram_smart_buttons.md`](plan_telegram_smart_buttons.md)
**Status**: done (v1.1: OK / No / Continue / Cancel — see follow-up below)
**Status changed**: 2026-04-27
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this session

v1: wire protocol + callback dispatch + a fixed three-button set
(OK / Continue / Stop) attached to forwarded notifications when a
new `telegramNotificationButtonsEnabled` setting is on. Defer:
custom prompt flow, per-call button override, project-specific
"Commit" button (needs `auto-commit` shareBin + UX think). Those
are pure additions on top of what this commit lands.

## Step-by-step progress

- [x] Extended `TelegramTransport`: `sendMessage` accepts optional
      `replyMarkup`; new `answerCallbackQuery` method on the wire
      (live transport posts to api.telegram.org)
- [x] Extended `TelegramUpdate` type with `callbackQuery` shape +
      new `TelegramCallbackInfo` event payload type
- [x] `parseRawUpdate` exported, decodes Telegram's `callback_query`
      payload (and remains forward-compatible — message + callback
      can co-exist on a single update)
- [x] `runLoop` `allowed_updates` includes `callback_query`
- [x] `TelegramService.sendMessageWithButtons` — same persistence
      and rate-limiting story as `sendMessage`, just with markup
- [x] `onCallback` event hook on `TelegramServiceOptions`
- [x] `handleCallbackQuery` validates allow-list (rejects with a
      "Not authorised" toast on the user's client), acks the query
      so Telegram stops the loading spinner, then surfaces the
      info to the host
- [x] `telegram-db.ts`: `notification_links` table +
      `linkNotification` (idempotent on key) /
      `getNotificationLink` / `pruneOldNotificationLinks`
- [x] Bun `applyTelegramSettings`: wires `onCallback` →
      `handleTelegramCallback`. Dispatch routes:
      `ok` → `notification.dismiss`,
      `continue` → `surface.send_text {text:"\n"}`,
      `stop` → `surface.send_key {key:"ctrl+c"}`.
      Logs the dispatch for audit; unknown actions / missing links
      drop silently with a warn
- [x] Notification forward path: when
      `telegramNotificationButtonsEnabled` is on, route through
      `sendTelegramNotificationWithButtons` which attaches the
      fixed three-button set and persists a `notification_links`
      row keyed by the bot's tg-message-id
- [x] `AppSettings.telegramNotificationButtonsEnabled` default false
      (validated as boolean; defaults to false on legacy configs)
- [x] Settings panel: toggle under Telegram section with a security
      note explaining the keystroke implication
- [x] Startup prune: `pruneOldNotificationLinks(now - 24h)` on bun
      boot so a stale tap on a day-old DM doesn't fire
- [x] Tests: 15 new cases in `tests/telegram-callback.test.ts` —
      `parseRawUpdate` callback_query (5 cases, including
      well-formed / missing-message / missing-data / no update_id /
      message+callback co-existence), service dispatch (allowed +
      reject paths), `sendMessageWithButtons` (markup on wire +
      persisted shape), db links (link/get/relink/prune/no-match/
      null-surface). Existing fixture in `telegram-service.test.ts`
      gained an `answerCallbackQuery` stub for type safety.
- [x] `bun run typecheck` clean
- [x] `bun test` — 992/992 (was 977; +15 callback tests)
- [x] `bun run bump:patch` — 0.2.6 → 0.2.7
- [x] Commit — `f0fa116`

## Deferred (follow-ups)

- "Commit" button + `shareBin/auto-commit` script
- Custom free-text path with two-step confirmation
- `ht notify --buttons claude|pi|default` flag override
- Project-scoped button sets per-agent (claude / pi)

## Deviations from the plan

1. **Reuse `telegramAllowedUserIds` for callbacks** instead of the
   plan's separate `telegramAllowedChats` allowlist. The two would
   have been the same list in 99% of installs — keeping a single
   source of truth means a user who whitelists themselves for
   messages also gets buttons. Documented in the open-questions
   section as a deliberate choice.
2. **No emoji on button labels.** First test run failed
   `tests/audit-emoji.test.ts` (design rule §0: no emoji ever, even
   in chrome). Replaced "✅ OK / ↵ Continue / ✋ Stop" with plain
   text "OK / Continue / Stop". Telegram clients render the buttons
   with adequate visual distinction without prefixes.
3. **No "Commit" button + no `shareBin/auto-commit` script.** Plan
   listed it as one of five buttons; deferred for a follow-up since
   a generic auto-commit script is project-specific and warrants its
   own UX think. v1 ships the three deterministic actions.
4. **No "Custom…" free-text path** with two-step confirmation. Same
   reason — non-trivial UX decision (force_reply round-trip), not
   blocking the v1 story.
5. **No `ht notify --buttons claude|pi|default` flag.** v1 attaches
   the same fixed button set to *every* forwarded notification when
   the setting is on. Per-call override / scope-specific button sets
   are a follow-up.
6. **Allow-listed user gets a transient "ack" toast** (empty text)
   on accepted callbacks; the rejected path gets "Not authorised".
   Plan didn't spec the rejection UX; this beats a hung spinner on
   the user's phone.

## Issues encountered

1. **Emoji audit failure** on the initial commit attempt — caught
   before pushing. Fix took 30 seconds (delete the prefixes); the
   audit suite did its job.
2. **TypeScript didn't catch the missing `answerCallbackQuery` on
   the existing test stub** in `telegram-service.test.ts`. Updated
   the stub defensively even though typecheck passed — fixture
   parity is cheaper than chasing a runtime undefined-call later.

## Open questions

- Plan mentions `telegramAllowedChats` as a separate allowlist for
  callbacks. The existing service uses `telegramAllowedUserIds`
  (parsed user ids). Reusing the same list for callbacks keeps the
  story consistent — a user who can send messages to the bot is
  also trusted to push its buttons. Documented as a deviation.

## Verification log

| Run                                       | Result                              |
| ----------------------------------------- | ----------------------------------- |
| `bun run typecheck`                       | clean (after every edit)            |
| `bun test tests/telegram-callback.test.ts` | 15/15 pass                         |
| `bun test` (full)                         | 992/992 pass, 107562 expect() calls |
| `bun scripts/audit-emoji.ts` (post-fix)   | clean (initially flagged emoji button labels — replaced with text) |
| `bun run bump:patch`                      | 0.2.6 → 0.2.7                       |

## Commits

- `f0fa116` — telegram: inline-keyboard buttons on forwarded notifications (OK/Continue/Stop)
  - 11 files changed, 1035 insertions(+), 28 deletions(-)

## Retrospective

What worked:
- The existing `TelegramTransport` injection point made the entire
  callback wire testable without touching real Telegram. 15
  hermetic tests cover the round-trip, allow-list, and persistence
  paths.
- Reusing the existing rate limiter + `insertMessage` for
  `sendMessageWithButtons` meant the buttons-aware send inherits
  the same robustness as the plain send (per-chat token bucket,
  duplicate detection via tg_message_id partial unique index).
- Persisting `notification_links` rows by `(chat_id, tg_message_id)`
  primary key makes the lookup O(log n) at callback time and the
  prune O(n on cutoff) — both cheap. The 24-hour cutoff matches
  Telegram's natural conversation horizon.

What I'd do differently:
- I should have run `bun scripts/audit-emoji.ts` before `bun test`
  on the first attempt — would have caught the button-label
  emojis in 200ms instead of 9s. Adding it to my pre-commit
  routine for any work that touches user-facing strings.
- The acked-on-reject UX (transient "Not authorised" toast) is
  not unit-tested directly; I assert that `answerCallbackQuery`
  was called, but don't assert the `text:` payload. Worth a
  one-line tightening if anyone changes the fixture later.

Carried over to follow-ups:
- "Commit" button + `shareBin/auto-commit` script
- Custom free-text path with two-step confirmation
- `ht notify --buttons claude|pi|default` per-call override
- Project-scoped button sets (Claude vs pi vs default), routed
  via the existing claude-integration / pi-extensions hooks

## Follow-up — v1.1 button-action fixes (2026-04-27)

User report: pressing "Stop" did nothing on the actual surface,
"Continue" was sending Ctrl+J (LF) instead of the real Enter key,
and the button set was missing a "No" affordance.

### Root cause

`KEY_MAP` in `src/bun/rpc-handlers/shared.ts` only contained
nine entries (enter / tab / escape / backspace / delete / arrows).
The Stop dispatch in `src/bun/index.ts` called
`surface.send_key {key:"ctrl+c"}`, but `KEY_MAP["ctrl+c"]` was
`undefined`, so the handler's `if (id && seq)` guard silently
no-op'd. The bug was structural — visible only by reading both
files together.

The `\n` Continue dispatch was an honest miscoding: in TTYs,
`\n` is Ctrl+J, not Enter. Enter is `\r` (CR).

### Fix

1. **`src/bun/rpc-handlers/shared.ts`** — extended `KEY_MAP` with
   every Ctrl-letter mapping (`ctrl+a`..`ctrl+z`, `ctrl+\`, `ctrl+]`)
   plus `home / end / pageup / pagedown / space / esc / return`.
   `ctrl+c` → `\x03` is the load-bearing one.
2. **`src/bun/telegram-button-dispatch.ts`** (new) — extracted the
   per-action dispatch as a pure function so it's unit-testable
   without the heavy `src/bun/index.ts` module (which reads
   `Resources/version.json` at import time).
3. **`src/bun/index.ts`** — `sendTelegramNotificationWithButtons`
   now ships a 4-up grid (OK / No on row 1, Continue / Cancel on
   row 2). `handleTelegramCallback` delegates to the pure
   dispatcher. New action semantics:
   - `ok` → `surface.send_key {key:"enter"}` (CR — not LF), then
     `notification.dismiss`. Surface-less links still dismiss.
   - `no` (new) → `surface.send_key {key:"down"}`, schedule
     `surface.send_key {key:"enter"}` 200 ms later, then
     `notification.dismiss`. Pattern: a Y/N picker where the
     cursor defaults to "Yes".
   - `continue` → `surface.send_text {text:"Continue"}` then
     `surface.send_key {key:"enter"}` (was: send_text "\n" — fixed).
   - `cancel` (renamed from `stop`) → `surface.send_key
     {key:"ctrl+c"}` — now actually fires because `KEY_MAP` has
     the entry. Legacy `stop` payloads remain aliased so existing
     `notification_links` rows keep working.
4. **`tests/telegram-callback.test.ts`** — 10 new cases covering
   each action's dispatched call sequence + KEY_MAP coverage:
   `ctrl+c` is `\x03`, `enter` is `\r`, `return` is `\r`. Existing
   15 transport-level cases unchanged.

### Verification

| Run                                       | Result                              |
| ----------------------------------------- | ----------------------------------- |
| `bun run typecheck`                       | clean                               |
| `bun test tests/telegram-callback.test.ts` | 25/25 pass (was 15)                |
| `bun test` (full suite)                   | 1430/1430 pass, 108356 expect() calls |
| `bun run bump:patch`                      | 0.2.19 → 0.2.20                     |

### Deviations from the original spec

- The plan's `stop` is renamed to `cancel` in the outgoing
  callback_data so the wire payload reflects the user-visible
  label. The dispatcher accepts both, so day-old DMs that
  predate the rename still work until they age out of the
  24-hour `notification_links` cutoff.
- Plan listed an `ok` button as a no-keystroke acknowledgement.
  The user wants OK to mean "yes, proceed" in a Y/N TUI prompt,
  so OK now sends Enter. The "ack-only" semantics are gone.
- The 200 ms delay on `no` is hard-coded — tunable later if a
  TUI redraw turns out to need more time. Rationale: this is
  the timing the user requested verbatim.

Plan #08 is now closed at v1.1.
