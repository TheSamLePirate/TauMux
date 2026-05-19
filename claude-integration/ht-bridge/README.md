# ht-bridge

Surfaces Claude Code session events into τ-mux's sidebar, replacing the old `afplay` + `cmux-notify` hooks.

Two sidebar pills appear while Claude Code is running:

- **`Claude`** — active task label. On `UserPromptSubmit` the pill flips immediately to **`Starting…`** (muted `#cdd6f4`), then a detached `pi -p` sidecar generates a 3-5 word **conversation title** and switches the pill to pink (`#f5c2e7`) with that title. The previous title is passed back to pi on each turn so the label can refine across the session (`"Investigate flaky CI timeout"` → `"Investigate macOS CI Timeout"` once scope clarifies). Cleared on `Stop`. Flips to a yellow **Waiting for input** or red **Approval needed** state on `Notification` events.
- **`cc`** — persistent session ticker. Updated on every prompt and every stop: `turn N · 2.1 min · $0.034`. Cost + tokens come from parsing the transcript JSONL Claude Code writes incrementally, so nothing extra needs to be wired.

On `Stop`, an `ht notify` fires with the label in the title and the original prompt + duration + cost in the body — same surface the τ-mux sidebar already uses for the `finish.mp3` sound cue, pane glow, and click-to-focus. Nothing else is spawned (no afplay, no native toast).

The arrival sound respects τ-mux's `notificationSoundEnabled` / `notificationSoundVolume` settings — mute and volume live in **Settings → General**, and the webview's command palette has a **Mute / Unmute Notification Sound** entry for quick toggling without touching the bridge config.

## Wire-up

Runs as shell hooks from `~/.claude/settings.json`. Four entry points, dispatched via argv[2]:

| Event kind | Hook matcher                          | Effect                                      |
| ---------- | ------------------------------------- | ------------------------------------------- |
| `prompt`   | `UserPromptSubmit`                    | Set label pill, bump turn counter           |
| `stop`     | `Stop`                                | Clear label, parse transcript, fire notify  |
| `notify-idle` | `Notification` matcher=`idle_prompt`  | Yellow "Waiting for input" pill + notify    |
| `notify-permission` | `Notification` matcher=`permission_prompt` | Red "Approval needed" pill + notify |

Each hook is fire-and-forget. `ht` is spawned with `stdio: ignore`; errors are swallowed unless `HT_CLAUDE_DEBUG=1` is set. If τ-mux isn't running the socket call fails silently and nothing else breaks.

## State

Per-session state (turn count, start time, last model, cumulative tokens + cost) lives at `$TMPDIR/ht-claude-bridge/<session_id>.json`. Files older than 24 h are pruned on every invocation. State writes are atomic (temp-file + rename).

## Config

Edit `config.json` next to `src/index.ts` or set environment variables:

| Env                         | Effect                          |
| --------------------------- | ------------------------------- |
| `HT_CLAUDE_ENABLED=0`       | Disable the bridge entirely     |
| `HT_CLAUDE_HT_BIN=/path/ht` | Override `ht` CLI location      |
| `HT_CLAUDE_LABEL_KEY=foo`   | Rename the active pill key      |
| `HT_CLAUDE_TICKER_KEY=bar`  | Rename the ticker pill key      |
| `HT_CLAUDE_TICKER_ENABLED=0` | Disable the persistent ticker   |
| `HT_CLAUDE_TITLE_ENABLED=0` | Disable the pi title sidecar — fall back to first-clause-of-prompt label |
| `HT_CLAUDE_PI_BIN=/path/pi` | Override `pi` CLI location      |
| `HT_CLAUDE_NOTIFY_ON_IDLE=1` | Re-enable the "waiting" toast on idle (pill only by default) |
| `HT_CLAUDE_DEBUG=1`         | Surface errors on stderr        |

## Title generation

The title sidecar shells out to [pi](https://github.com/mariozechner/pi-coding-agent) (`pi -p --model openai/gpt-5-nano --thinking off --no-tools …`) on every `UserPromptSubmit`. The two-phase pill is the visible artefact:

| Phase | Pill | Trigger |
| ----- | ---- | ------- |
| 1     | `Claude · Starting…` (muted `#cdd6f4`) | Synchronous inside the prompt hook |
| 2     | `Claude · <pi-generated title>` (pink `#f5c2e7`) | When pi returns (~1–3 s typical) |

The sidecar is fully best-effort:

- **5-second timeout** — if pi takes longer the SIGTERM fires and the pill stays at `Starting…` until the next event.
- **Silent on failure** — pi missing, no `OPENAI_API_KEY`, network error → pill stays at `Starting…`. Set `HT_CLAUDE_DEBUG=1` to surface the underlying error on stderr.
- **Race-safe with Stop** — the sidecar always writes its result into the per-session state file (so the *next* turn's pi call has the previous title for refinement), but only touches the visible pill if `promptActive` is still true. A late title arrival after `Stop` won't produce a "ghost" pill.

### Requirements

- `pi` on `$PATH` (or set `HT_CLAUDE_PI_BIN`).
- An API key resolvable by pi for the configured model — by default `OPENAI_API_KEY` (gpt-5-nano). Switch models by editing `titlePiArgs` in `config.json`.

### Disabling

Set `titleEnabled: false` in `config.json` or `HT_CLAUDE_TITLE_ENABLED=0`. The pill falls back to the original first-clause-of-prompt label (truncated to `labelMaxChars`).

## Pricing

Token costs come from `config.json → pricing` (`$ / million tokens`, keyed by model id). Claude 4.x family is seeded; dated suffixes like `claude-opus-4-7-20260118` match by prefix; unknown models fall back to a tier heuristic (`opus` / `sonnet` / `haiku` substring match). When no price is resolvable the ticker shows output tokens instead of dollars.

## Manual test

With τ-mux running and this bridge wired into `settings.json`, trigger each hook manually:

```bash
# label pill
echo '{"session_id":"manual-test","prompt":"Investigate a flaky test in the billing suite"}' \
  | bun ~/.claude/scripts/ht-bridge/src/index.ts prompt

# permission flash
echo '{"session_id":"manual-test","message":"Allow ls?"}' \
  | bun ~/.claude/scripts/ht-bridge/src/index.ts notify-permission

# stop — needs a real transcript path to compute cost
echo '{"session_id":"manual-test","transcript_path":"/Users/you/.claude/projects/.../foo.jsonl"}' \
  | bun ~/.claude/scripts/ht-bridge/src/index.ts stop
```

Check the sidebar of whichever τ-mux workspace `HT_SURFACE` points at; the native `surface_id` resolution plumbing (see `src/bun/rpc-handlers/sidebar.ts`) routes each pill to the caller's workspace automatically.
