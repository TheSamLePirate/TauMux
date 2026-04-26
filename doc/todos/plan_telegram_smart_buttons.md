# Plan 08 — Telegram smart buttons on turn-end notifications

## Source quote

> # Telegram smarter:
> On turn end notification, add buttons to the telegram message:
> OK, continue / Commit (that will be sent to the surface + Enter)

## Goal

When a Claude / pi / generic agent finishes a turn and τ-mux forwards
that as a Telegram notification, the message should include inline
keyboard buttons. Tapping a button posts an instruction back into the
originating surface.

Initial set:

| Button     | Effect                                                              |
| ---------- | ------------------------------------------------------------------- |
| `OK`       | Acknowledge — clear the notification, no terminal action.           |
| `Continue` | Send `\n` (Enter) into the surface.                                 |
| `Commit`   | Send `git add -A && git commit -m "$(./scripts/auto-msg.sh)"\n`     |
|            | (or just `commit` text if a project-specific shareBin is provided). |
| `Stop`     | Send Ctrl-C into the surface.                                       |
| `Custom…`  | Prompts user for free text → sends it.                              |

## Telegram primitives

Telegram's Bot API supports `reply_markup.inline_keyboard` which
attaches buttons to a message. We already use `node-telegram-bot-api`
or equivalent in `src/bun/telegram-service.ts`. The flow:

1. When sending the notification, attach
   ```jsonc
   {
     "inline_keyboard": [
       [{"text":"OK","callback_data":"ok|<surfaceId>"}],
       [{"text":"Continue","callback_data":"continue|<surfaceId>"}],
       [{"text":"Commit","callback_data":"commit|<surfaceId>"}],
       [{"text":"Stop","callback_data":"stop|<surfaceId>"}]
     ]
   }
   ```
2. Listen for `callback_query` events on the bot. The payload's
   `data` is our `<action>|<surfaceId>` string.
3. Map to RPC:
   - `ok` → `bot.answerCallbackQuery({text:"acknowledged"})` and
     `notification.dismiss(notificationId)`.
   - `continue` → `surface.send_text {surface_id, text: "\n"}`.
   - `commit` → run a project-local script if present
     (`shareBin/auto-commit`), else fall back to a basic
     `git add -A && git commit -m 'wip'\n`. Configurable.
   - `stop` → `surface.send_key {surface_id, key: "ctrl+c"}`.
   - `custom` → reply with a `force_reply` prompt, then on next
     incoming text, route as `surface.send_text`.

## Discovery: which surface a notification belongs to

Notifications already include `surface_id` (Plan #03 §A leverages this
too). We have to **persist** the mapping `notification_id → surface_id`
because Telegram callback queries arrive minutes later.

- Telegram db already exists. Add a `notification_links` table:
  ```sql
  CREATE TABLE notification_links (
    notif_id TEXT PRIMARY KEY,
    surface_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  ```
- Cleanup: drop rows older than 24 h on startup.

## Customising the button set

Per-agent button sets:

- Claude turns vs pi turns vs generic `ht notify` may want different
  buttons. The hooks (`claude-integration/`, `pi-extensions/`) attach
  a `buttonSet: "claude" | "pi" | "default"` flag (or pass the buttons
  inline in the notification payload).
- Settings: `AppSettings.telegramButtons.<scope>` defaults shipped;
  user-editable via Settings → Telegram.

## Security considerations

The buttons execute keystrokes in the user's surface. Mitigations:

1. The Telegram bot only accepts callbacks from chat IDs in the
   `telegramAllowedChats` setting (already partial — verify). If
   not, add it.
2. The `Custom…` free-text path is the highest risk — easy to phish
   the user into pasting commands. Add a confirmation step:
   - Bot replies "About to send: `<text>` — confirm?" with `Yes/No`
     buttons.
3. All button-driven actions write to the `sidebar.log` so the user
   sees what was sent and from whom.

## Files

- `src/bun/telegram-service.ts` — outgoing reply_markup; incoming
  `callback_query` handler.
- `src/bun/telegram-db.ts` — `notification_links` table + helpers.
- `src/bun/rpc-handlers/notification.ts` — accept `buttons?: ButtonSet`
  in `notification.create`; persist link.
- `claude-integration/ht-bridge/` (Stop hook) — request the
  `buttonSet: "claude"` set when it pings `ht notify`.
- `pi-extensions/ht-notify-summary/` — same for pi.
- `src/shared/settings.ts` — `telegramButtons`, `telegramAllowedChats`
  if not present.
- `src/views/terminal/settings-panel.ts` — new section.
- `bin/ht notify` — accept `--buttons claude|pi|default` flag.
- `doc/system-telegram.md` — document the button protocol + safety.

## Tests

- `tests/telegram-callback-routing.test.ts` — fake `callback_query`
  with `data: "continue|surface:1"` → asserts `surface.send_text`
  RPC was called with `{text: "\n"}`.
- `tests/telegram-allowed-chats.test.ts` — callback from non-allowed
  chat → ignored + sidebar log entry "rejected".
- `tests/notification-link-cleanup.test.ts` — old links pruned on
  startup.

## Effort

M — telegram side is ~half day, hooks integration ~half day, settings
+ tests ~half day. Total ~1.5 days.

## Risks

- Button replies can race with the user typing in the same surface.
  `surface.send_text` is line-buffered into the PTY, but a Custom
  prompt arriving mid-typing can interleave. Not a τ-mux bug per se,
  but worth a UX warning in docs.
- `auto-commit` script's existence/quality is project-specific. Ship
  a simple example, but make it user-overridable.
