# ht-notify-summary

A pi extension that surfaces pi agent turns into τ-mux using a
fast model (default: **Claude Haiku**, `reasoningEffort: "off"`).

| Hook                  | Action                                                                       |
|-----------------------|------------------------------------------------------------------------------|
| `before_agent_start`  | `ht set-status Pi "<3–5 word task>"` — sidebar pill while agent is working. |
| `agent_end`           | `ht clear-status Pi` + `ht notify --title "Agent End : <3–5 word summary>"` |
| `session_shutdown`    | `ht clear-status Pi` (safety net — no stale pill).                           |

```
Status  : Pi · Fixing Login Redirect   (while the agent runs)
Notify  : Agent End : Fixed Login Redirect
Body    : <last user prompt, truncated>
```

An immediate `Thinking…` placeholder is shown the instant the user submits, then
replaced asynchronously as soon as the fast model returns. The start-summary
call is fire-and-forget so it never delays the real agent loop.

## Install

pi auto-discovers extensions from `~/.pi/agent/extensions/` (global) or
`.pi/extensions/` (project-local). Symlink this directory into one of them:

```bash
# Global
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/pi-extensions/ht-notify-summary" ~/.pi/agent/extensions/ht-notify-summary

# Or project-local (from the repo root)
mkdir -p .pi/extensions
ln -s "$PWD/pi-extensions/ht-notify-summary" .pi/extensions/ht-notify-summary
```

Then reload inside pi:

```
/reload
```

Quick test without installing:

```bash
pi -e ./pi-extensions/ht-notify-summary/index.ts
```

## Requirements

- τ-mux running (socket `/tmp/hyperterm.sock`)
- `ht` CLI on `PATH` (or set `htBinary` in `config.json`)
- An API key for the configured provider/model (Anthropic Haiku by default)

## Configuration

Edit `config.json` next to the extension, or override with env vars:

| Field             | Env var                     | Default              |
|-------------------|-----------------------------|----------------------|
| `enabled`         | `PI_HT_NOTIFY_ENABLED`      | `true`               |
| `provider`        | `PI_HT_NOTIFY_PROVIDER`     | `anthropic`          |
| `modelId`         | `PI_HT_NOTIFY_MODEL`        | `claude-haiku-4-5`   |
| `minWords`        | `PI_HT_NOTIFY_MIN_WORDS`    | `3`                  |
| `maxWords`        | `PI_HT_NOTIFY_MAX_WORDS`    | `5`                  |
| `htBinary`        | `PI_HT_NOTIFY_HT_BIN`       | `ht`                 |
| `notifySubtitle`  | —                           | `pi agent`           |
| `statusKey`       | `PI_HT_NOTIFY_STATUS_KEY`   | `Pi`                 |
| `statusIcon`      | `PI_HT_NOTIFY_STATUS_ICON`  | `bolt`               |
| `statusColor`     | `PI_HT_NOTIFY_STATUS_COLOR` | `#a6e3a1`            |

Debug: `PI_HT_NOTIFY_DEBUG=1` logs errors from the summarizer / `ht notify` to stderr.

### Swap the model

Any model known to pi's model registry works. Examples:

```json
{ "provider": "anthropic", "modelId": "claude-haiku-4-5" }
{ "provider": "openai",    "modelId": "gpt-5-mini" }
{ "provider": "groq",      "modelId": "llama-3.3-70b-versatile" }
```

The extension always calls the model with `reasoningEffort: "off"` so even
reasoning-capable models skip thinking and return the summary fast.

## How it works

1. `before_agent_start` → `ht set-status Pi "Thinking…"` is fired instantly,
   then replaced with the fast-model label ("Fixing Login Bug") once it
   returns. A turn token prevents late updates from a previous turn from
   overwriting a newer status.
2. `agent_end` → `ht clear-status Pi` + awaits a 3–5 word past-tense summary
   from the fast model, then:
   ```bash
   ht notify --title "Agent End : <summary>" \
             --body  "<truncated user prompt>" \
             --subtitle "pi agent"
   ```
3. `session_shutdown` → `ht clear-status Pi` so the pill never lingers.
4. Never blocks pi: errors fall back to `"Working"` / `"Task complete"` and
   every `ht` invocation is fire-and-forget with a 3-second timeout.

## Uninstall

Remove the symlink (or the directory) from `~/.pi/agent/extensions/` or
`.pi/extensions/` and run `/reload`.
