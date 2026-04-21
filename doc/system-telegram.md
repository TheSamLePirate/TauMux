# Telegram Bridge

This document describes the in-app Telegram integration in τ-mux — a first-class pane backed by a long-poll bot service, with bidirectional message flow, optional notification forwarding, and CLI access via `ht telegram`.

## Goals

- Treat a Telegram chat as a first-class surface alongside terminal, browser, and agent panes
- Let scripts drive the chat from outside the GUI (`ht telegram send "build done"`)
- Mirror Telegram messages into the UI so the user can read/reply without alt-tabbing
- Optionally forward sidebar notifications to Telegram for off-machine awareness
- Keep the integration safe even when misconfigured: bad token, offline network, runaway script

The pane is overlay-style and never touches PTY state. The bot service runs in the background and tolerates network errors with backoff.

## Architecture

### Bun side

- **`src/bun/telegram-db.ts`** — `TelegramDatabase` wraps `bun:sqlite` at `~/Library/Application Support/hyperterm-canvas/telegram.db`. Owns three tables:
  - `messages(id, chat_id, direction, text, ts, tg_message_id, from_user_id, from_name)` with a partial UNIQUE index on `(chat_id, tg_message_id) WHERE tg_message_id IS NOT NULL` for inbound dedup. Outbound rows have null `tg_message_id` and skip the index — letting two failed sends with identical text both persist.
  - `chats(id, name, last_seen)` for the picker. `upsertChat` overwrites the friendly name; `touchChat` only bumps `last_seen` (used by outbound sends so the chat name from the first inbound message survives).
  - `kv(k, v)` — small string store for `poll_offset` (offset across restarts) and `bot_username` (cached `@MyBot`).
- **`src/bun/telegram-service.ts`** — `TelegramService` owns the long-poll loop and sendMessage. Single-bot. Pluggable `TelegramTransport` interface so tests inject a stub. Exposes `start()`, `stop()`, `sendMessage(chatId, text)`, `getStatus()`. Surface state via `onStatus`, new messages via `onIncoming`, non-fatal log lines via `onLog`.
  - `getMe` runs once at start to populate `botUsername` and surface a bad token before the first message.
  - Per-chat token bucket (3-burst, 1 msg/sec refill) protects against Telegram's 30 msg/sec global ban hammer.
  - Polling offset persists in `kv` after every batch so a restart doesn't replay unconfirmed messages — combined with the partial UNIQUE index, duplicates are impossible.
  - `formatNotificationForTelegram` and `planNotificationForwarding` are pure helpers exported for testing — the dispatch chokepoint in `src/bun/index.ts` calls `planNotificationForwarding` to decide who gets DM'd, then funnels through `sendTelegramAndBroadcast`.
- **`src/bun/rpc-handlers/telegram.ts`** — read + write API over the unified RPC dispatcher. Methods: `telegram.send`, `telegram.history`, `telegram.chats`, `telegram.status`. Resolves the live service via a `getTelegramService()` thunk so settings changes (token / enabled) replace the instance without re-registering handlers.
- **`src/bun/index.ts`** — service lifecycle, surface creation/restore, broadcast helpers:
  - `applyTelegramSettings()` starts/stops the service on enabled+token settings changes.
  - `sendTelegramAndBroadcast(chatId, text)` is the single send funnel — used by the Electrobun handler, the web-mirror callback, the polling onIncoming, and the notification forwarder.
  - `broadcastTelegramMessage(wire)` and `broadcastTelegramState()` push to both webview RPC and every connected web client.
  - Layout restore handles `surfType === "telegram"` by minting a fresh surface id and emitting `telegramSurfaceCreated` (no PTY allocated).
  - Graceful shutdown stops the service and closes the DB.

### Webview side

- **`src/views/terminal/telegram-pane.ts`** — `TelegramPaneView` builds the DOM: surface bar (split / close), toolbar (chat picker + status pill), scrollable message list, composer (Enter = send, Shift+Enter = newline). Subscribes to `telegramHistory` / `telegramMessage` / `telegramState` pushes. Renders a "failed" badge + Retry button on outbound rows whose `tgMessageId === null`.
- **`src/views/terminal/surface-manager.ts`** — `SurfaceView.surfaceType` includes `"telegram"`; `addTelegramSurface` / `addTelegramSurfaceAsSplit` / `removeTelegramSurface` mount/unmount. `handleTelegramMessage` fans out to every visible pane and pulses glow + plays the chime for unfocused panes (only on inbound).
- **Settings panel** has a dedicated `Telegram` section: enable toggle, masked bot token (show/hide), allowed user IDs, notification-forward toggle. The note text is intentionally short — long copy used to overflow the row before `.settings-field-label-wrap` got `max-width: 60%`.
- **Command palette** entries: `New Telegram Pane`, `Split Telegram Right`, `Split Telegram Down`.

### Web mirror

- **`src/web-client/store.ts`** — `AppState.telegram = { status, chats, messagesByChat, activeChatId }`. Reducer cases: `telegram/state`, `telegram/history`, `telegram/message`, `telegram/select-chat`, `telegram/glow-incoming`. `mergeTelegramMessages` is imported from `src/shared/telegram-view.ts` so the merge/dedup behavior matches the webview pane exactly.
- **`src/web-client/protocol-dispatcher.ts`** — translates `telegramSurfaceCreated` / `telegramMessage` / `telegramHistory` / `telegramState` envelopes into store actions; inbound messages also fire `playNotificationSound()` and dispatch `telegram/glow-incoming`.
- **`src/web-client/main.ts`** — `createPane` branches on `surfaceId.startsWith("tg:")` and builds a chat DOM keyed by `idKey` (no diffing — full re-render when the message-id list changes). Send box wires to the existing `transport.send` via `sendMsg("telegramSend", ...)`.
- **`src/bun/web/server.ts`** — `onTelegramSend` / `onTelegramRequestHistory` / `onTelegramRequestState` callbacks are wired in `setupWebServerCallbacks` to the same `sendTelegramAndBroadcast` path the native side uses.

### Shared

- **`src/shared/telegram-view.ts`** — pure helpers (`formatTelegramTimestamp`, `mergeTelegramMessages`, `telegramAuthorLabel`, `telegramSendFailed`, `TELEGRAM_RENDER_WINDOW`) used by both UI implementations and the reducer. No DOM imports — runs under Bun tests.
- **`src/shared/types.ts`** — `TelegramWireMessage`, `TelegramChatWire`, `TelegramStatusWire`, plus the bun↔webview RPC entries (`createTelegramSurface`, `splitTelegramSurface`, `telegramSend`, `telegramRequestHistory`, `telegramRequestState`, `telegramSurfaceCreated`, `telegramMessage`, `telegramHistory`, `telegramState`).
- **`src/shared/settings.ts`** — `telegramEnabled`, `telegramBotToken`, `telegramAllowedUserIds`, `telegramNotificationsEnabled`. `parseAllowedTelegramIds` and the internal `normalizeAllowedIds` share the same numeric-only / dedupe / trim semantics so storage and runtime agree on every input.

## Data flow

### Inbound (Telegram → user)

1. Long-poll loop wakes on `getUpdates` returning a non-empty batch.
2. Each update goes through `handleUpdate`: allow-list filter → `db.insertMessage` (returns `{message, inserted}`).
3. If `inserted === false` (duplicate from a replayed batch), skip the broadcast.
4. `onIncoming(message)` fires → `broadcastTelegramMessage` → `rpc.send("telegramMessage")` to webview + `webServer.broadcast` to every web client.
5. Webview `surface-manager` appends to every Telegram pane and pulses glow + chime if no Telegram pane has focus.
6. Web mirror reducer merges into `state.telegram.messagesByChat`; the `telegram/glow-incoming` action pulses every `tg:*` surface that isn't focused, and the dispatcher fires `playNotificationSound`.
7. After the batch, `kv.poll_offset` persists so a restart resumes from the next update id.

### Outbound (user → Telegram)

1. User types in a pane composer (or runs `ht telegram send`).
2. Composer fires `telegramSend` RPC (webview) or sends a `telegramSend` envelope (web mirror).
3. Bun's handler calls `sendTelegramAndBroadcast(chatId, text)`.
4. Service applies the per-chat rate limit, calls `transport.sendMessage`, persists the row (with `tgMessageId === null` on failure), bumps `chats.last_seen` via `touchChat` without overwriting the friendly name.
5. The persisted row broadcasts back so every UI sees its own send (including failed ones, which render with a Retry button).

### Notification forwarding (Phase 2)

1. Anything that reaches `dispatch("notification", ...)` in `src/bun/index.ts` (sidebar `notification.create`, `ht notify`, agent completions) calls `planNotificationForwarding` with the current settings + workspace context.
2. The pure planner returns zero or more `{chatId, text}` deliveries — empty when the toggle is off, the allow-list is empty, or the title+body is empty.
3. Each delivery flows through the same `sendTelegramAndBroadcast` funnel — meaning notification-forwarded messages land in the user's own chat history, are rate-limited, and obey allow-list semantics.

## Settings

```ts
telegramEnabled: boolean;            // master switch
telegramBotToken: string;            // unencrypted in settings.json
telegramAllowedUserIds: string;      // comma-list of numeric ids
telegramNotificationsEnabled: boolean; // forward sidebar notifications
```

Allow-list normalization: split on `,`, trim each entry, drop anything that isn't `^\d+$`, dedupe preserving order. An empty string means "allow from anyone" — not recommended.

## Security model

- **Token**: stored in plaintext in `settings.json` next to `webMirrorAuthToken`. Same trust model as the rest of the file — anyone with read access to `~/Library/Application Support/hyperterm-canvas/` can take over the bot. Use a dedicated bot, not a personal account.
- **Allow-list**: the `telegramAllowedUserIds` field defaults to the developer's own user id so a fresh setup with a published bot doesn't accept DMs from random Telegram users. Empty allow-list = open bar.
- **Outbound rate limit**: 1 msg/sec per chat with 3-message burst. Telegram bans bots that send >30 msg/sec — a script that loops `ht notify` won't take you down.

## CLI

`bin/ht` exposes a `telegram` subcommand:

```bash
ht telegram status                   # disabled / starting / polling / error: <reason>
ht telegram chats                    # id, name, last-seen
ht telegram read [--chat ID] [--limit N]  # default chat = most recent
ht telegram send [--chat ID] [TEXT…] # stdin if no positional; default chat = most recent
```

`HT_TELEGRAM_CHAT` env var sets the default chat id. The CLI prints "defaulting to chat X (name)" to stderr when it falls back, so scripts piping output stay deterministic.

## Tests

- `tests/telegram-db.test.ts` — insert/dedup, history pagination, trim cap, kv round-trip, outbound rows skipping the unique index.
- `tests/telegram-service.test.ts` — allow-list filter, send persistence on failure, abort cleanup, getMe, formatter + planner.
- `tests/telegram-settings.test.ts` — allow-list normalization + parser parity.
- `tests/rpc-handler-telegram.test.ts` — every RPC method incl. error paths, with mock service.
- `tests/web-client-store.test.ts` — telegram reducer cases (state/history/message/select/glow).

No test makes a real Telegram API call — the `TelegramTransport` interface is always stubbed.

## Troubleshooting: HTTP 409 (bot already in use)

Telegram enforces a single active consumer per bot token: one long-polling `getUpdates` call OR one configured webhook — never both, and never two of either. A second consumer ejects the first with HTTP 409 and the loser gets stuck there until the competing client steps aside.

**How τ-mux handles it:** when the poll loop sees a 409, the service enters a dedicated `conflict` state (distinct from generic `error`), logs a single warning line (no spam on retry), and backs off on a fixed 60 s cycle. The sidebar Telegram pill turns amber + pulses slowly, and the Telegram-pane status pill reads `conflict: another client is polling this bot — stop it or use a separate bot token per consumer`. As soon as the other consumer stops and our next poll succeeds, the service logs `telegram poll conflict cleared — resuming` and returns to `polling`.

**How to resolve it:**

1. **Stop the competing consumer.** Check for a second τ-mux instance, a running n8n / botkit / zapier flow, or a webhook configured via `setWebhook`. If a webhook is the culprit, clear it with `curl https://api.telegram.org/bot<TOKEN>/deleteWebhook`.
2. **Use one bot per consumer** (structural fix). Telegram supports as many bots per account as you want — `@MyTauMuxBot` and `@MyN8NBot` are fully independent streams. Create a second bot in BotFather and paste its token into the other service.

Webhook mode is not a workaround: a webhook URL is itself a single-consumer resource, and it requires a publicly-reachable HTTPS endpoint which isn't practical for a laptop-local app.

## Known limitations

- One bot per app instance — see Troubleshooting above for the full conflict story and UI treatment.
- DM-only — no channel/group support. The update parser bails on non-message updates (`edited_message`, `channel_post`, `inline_query`).
- No file/image/sticker payloads — text only.
- No reply-to-specific-message threading.
- Token in plaintext — see Security model.

These are deliberate Phase 1 trade-offs.
