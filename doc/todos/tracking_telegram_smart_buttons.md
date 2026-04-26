# Tracking — Plan 08: Telegram smart buttons

**Plan**: [`plan_telegram_smart_buttons.md`](plan_telegram_smart_buttons.md)
**Status**: done (v1: OK / Continue / Stop)
**Status changed**: 2026-04-26
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
- [ ] Commit — next

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

(empty)

## Commits

(empty)
