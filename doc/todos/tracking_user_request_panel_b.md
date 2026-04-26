# Tracking — Plan 10 (Commit B): Telegram routing for ht ask

**Plan**: [`plan_user_request_panel.md`](plan_user_request_panel.md) (Telegram half)
**Sister tracking**: [`tracking_user_request_panel.md`](tracking_user_request_panel.md) (Commit A)
**Status**: done
**Status changed**: 2026-04-27
**Owner**: Claude (Opus 4.7, 1M context)
**Branch**: `main`

## Scope of this session

Polished Telegram routing for the ask-user flow. When the new
`telegramAskUserEnabled` setting is on, every queued question
fans out to allow-listed Telegram chats with the right
interaction shape per kind, and the original message gets
**edited in place** after resolution so the chat history reads
as a clean record of every decision.

All four kinds covered (the user asked to "make them awesome"):
  yesno            → two inline buttons (Yes / No) + Cancel
  choice           → button per declared choice (rows of 2) + Cancel
  text             → force_reply round-trip — user types the answer
  confirm-command  → two-step "I understand" → "Run" gate + Cancel

Resolution feedback: every resolved request edits the original
Telegram message via `editMessageText` to:
  - strike through the prompt
  - append a resolution footer ("✓ answered: yes" / "✗ cancelled" /
    "⏰ timed out")
  - remove the now-stale buttons
So scrolling back through the chat is a clean audit log of every
question and answer.

Pretty rendering: workspace + pane attribution lines, MarkdownV2
emphasis on the title, body printed verbatim with safe-escape.

Modal panel UI in the webview is still deferred to a future
Commit C — the protocol push channel from Plan #10 commit A
already exists; the panel's a presentation-layer follow-up.

## Step-by-step progress

- [x] AppSettings: `telegramAskUserEnabled` (default false) +
      validation
- [x] `ask_user_links` table on TelegramDatabase — chat_id +
      tg_message_id → request_id + kind + ts. Plus
      `getAskUserLinksForRequest` + `dropAllLinksForRequest`
      helpers for the resolution-feedback edit path
- [x] `text_reply_links` table — chat_id + tg_message_id →
      request_id + ts. Matched by inbound `reply_to_message`.
- [x] 11 link-table tests (round-trip, prune, relink-overwrites,
      `getAskUserLinksForRequest` per request, `dropAllLinks` for
      both tables)
- [x] `TelegramTransport.editMessageText` (new method, posts to
      Telegram /editMessageText)
- [x] `TelegramTransport.sendMessage` accepts `parseMode`
      ("MarkdownV2" / "HTML") for formatted bot text
- [x] `TelegramTransport.sendMessage` accepts the `force_reply`
      markup variant on the new `ReplyMarkup` union (existing
      `InlineKeyboardMarkup` | new `ForceReplyMarkup`)
- [x] Service: `sendRich(chatId, text, replyMarkup, parseMode)` —
      generic send used by `sendMessageWithButtons` (which now
      forwards) and the new ask-user fan-out path
- [x] Service: `editMessage(chatId, tgMessageId, text, replyMarkup?, parseMode?)`
      with warn-on-error rather than crashing the queue
- [x] `parseMessage` extracts `reply_to_message.message_id` so
      inbound force_reply answers carry the link key
- [x] Service `onIncoming` callback widened with `extra: {replyToMessageId?}`
- [x] `src/bun/ask-user-telegram.ts` — pure helpers:
        `formatQuestionForTelegram` (MarkdownV2 escape, attribution,
                                     kind hint footer)
        `buildButtonsForKind`        (yesno / choice / confirm /
                                     text → InlineKeyboardMarkup |
                                     ForceReplyMarkup)
        `parseAskCallbackData`       (decodes ask|<id>|<value>)
        `formatResolutionFooter`     (struck title + answer marker)
- [x] 24 helper tests (escape behaviour, kind-specific button
      shapes, choice 1-vs-2 column layout, confirm-revealed wire
      format, callback parse, resolution markers, attribution
      rendering)
- [x] Bun subscriber on `AskUserQueue.shown` — fans out to every
      allow-listed chat via `sendRich`, persists the right link
      row per kind, caches the title for the resolution edit
- [x] Bun subscriber on `AskUserQueue.resolved` — edits every
      linked message with the resolution footer (no replyMarkup,
      so buttons disappear), then drops link rows so a stale tap
      can't re-resolve a recycled id
- [x] `handleTelegramCallback` routes ask|<id>|<value> first;
      kind-specific value semantics:
        yesno:        "yes" / "no" / "cancel"
        choice:       "<choiceId>" / "cancel"
        confirm-cmd:  "ack" → in-place edit reveals [Run] gate;
                      "run" → answer; "cancel" → cancel
- [x] Inbound force_reply routing — `onIncoming` extra carries
      `replyToMessageId`; the host looks it up in
      `text_reply_links` and dispatches `agent.ask_answer` with
      the message body
- [x] Settings panel: "Route ht ask to Telegram" toggle with a
      copy that explains all four kinds + the audit-trail story
- [x] Startup prune of both link tables (24h horizon, same as
      notification_links)
- [x] `bun run typecheck` clean
- [x] `bun test` — 1144/1144 pass (was 1109; +11 db link, +24
      helper)
- [x] `bun scripts/audit-emoji.ts` — clean (post-fix; 3 emojis
      slipped into JSDoc / comments and were stripped)
- [x] `bun run bump:patch` — 0.2.13 → 0.2.14
- [x] Commit — `ec5caaf`

## Deviations from the plan

1. **Resolution footer doesn't strike-through the original
   title** when restored from the link cache after a process
   restart. The bun-side `requestTitleCache` is in-memory only —
   if bun restarts between fan-out and resolve, the edit falls
   back to the literal "Question" placeholder. Acceptable for v1;
   persisting the title in `ask_user_links` would close the loop.
2. **`force_reply` answers always resolve via `agent.ask_answer`**
   even if the user types "/cancel" or similar. Plan didn't spec
   a cancel-via-text path; users who want to cancel a force-reply
   prompt tap the matching choice/yesno cancel button or use the
   sibling `ht ask cancel <id>`.
3. **Race on first-tap-wins across multiple allow-listed chats.**
   When two users on the allow-list both tap an answer, the first
   tap resolves the queue; the second tap gets `resolved=false`
   from `agent.ask_answer`. Documented as the expected race.
4. **No per-chat scoping of allow-list for `ask_user`.** Plan
   #08's `telegramNotificationButtonsEnabled` reused
   `telegramAllowedUserIds`; ask-user does the same. A future
   per-feature allow-list field is a polish item.

## Issues encountered

1. **Backtick-in-template-literal trap, again.** The SQL
   `CREATE TABLE IF NOT EXISTS text_reply_links` schema's
   docstring had a `` `kind: text` `` literal — Bun's template
   literal parsed the inner backticks and broke compilation
   (line 114 parse error). ESLint's parser fired the same.
   Stripped to "kind=text"; lesson logged across plans #07/#08/#10.
2. **Test had wrong escape expectations.** Asserted that `?` is
   a MarkdownV2 reserved char; per Telegram's docs the list is
   `_*[]()~\`>#+-=|{}.!`, so `?` passes through. Fixed both
   `formatQuestionForTelegram` and `formatResolutionFooter`
   tests.
3. **3 emojis in JSDoc / comments** — caught by the same emoji
   audit that's bitten plans #03 and #08. Will eventually wire
   `bun scripts/audit-*` as a single pre-commit gate.

## Open questions

- For yesno: does "No" mean cancel or answer="no"? Going with
  answer="no" (action: ok) — the agent gets a deterministic
  yes/no signal. Cancel stays for explicit `/cancel` text-reply
  or deferred force_reply flow.
- Should ask buttons be limited to one chat (the most-recent)? v1
  fans out to *every* allow-listed user. First tap wins; later
  taps from other users see "(no such id — already resolved)".
  Documented as a known race.

## Verification log

| Run                                          | Result                              |
| -------------------------------------------- | ----------------------------------- |
| `bun run typecheck`                          | clean (after backtick + emoji fixes)|
| `bun test tests/telegram-ask-links.test.ts`  | 11/11 pass                          |
| `bun test tests/ask-user-telegram.test.ts`   | 24/24 pass                          |
| `bun scripts/audit-emoji.ts`                 | clean (post-fix)                    |
| `bun test` (full)                            | 1144/1144 pass, 107859 expect() calls |
| `bun run bump:patch`                         | 0.2.13 → 0.2.14                     |

## Commits

- `ec5caaf` — ask-user: route ht ask through Telegram for all four kinds
  - 12 files changed, 1442 insertions(+), 14 deletions(-)

## Retrospective

What worked:
- Pure helpers in `ask-user-telegram.ts` got 24 hermetic test
  cases covering every interaction shape — no transport, no db,
  no service. The host wiring is glue around helpers I trust
  independently.
- The `ReplyMarkup` union (`InlineKeyboardMarkup` |
  `ForceReplyMarkup`) was a clean abstraction. `kind: text`
  returns force_reply; every other kind returns inline buttons;
  the rest of the pipeline doesn't care which.
- Resolution-feedback edits via `editMessageText` make the
  Telegram chat actually useful as an audit log — scroll back,
  every question has its answer stamped on it.
- Two-step confirm-command gate fits naturally into the callback
  dispatch ("ack" edits the message in place to reveal Run; "run"
  resolves the queue). No extra round-trip for the gate.

What I'd do differently:
- The `requestTitleCache` is in-memory only. A bun restart between
  fan-out and resolve loses the title and the resolution edit
  falls back to the literal "Question" placeholder. Persisting
  the title in `ask_user_links` would close the loop.
- Hit the same backtick-in-template-literal trap as Plans #07/#08
  and the same emoji-in-comments trap as #03/#08. A single
  `bun run audits` aggregate script (running every
  `scripts/audit-*.ts`) would be a real time-saver — logged for
  next session.

Carried over to follow-ups:
- Modal panel UI in the webview (Plan #10 A push channel is ready)
- Persist title in `ask_user_links` for restart-safe resolution
  edits
- Per-feature allow-list (currently shares `telegramAllowedUserIds`
  with notifications + smart-buttons)
- Cancel-via-text path for force_reply prompts ("/cancel" body →
  action=cancel)
- `bun run audits` aggregate script bundling every `audit-*.ts`
  as a single pre-commit gate
