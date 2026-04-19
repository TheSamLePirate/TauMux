---
name: hyperterm-canvas
description: Operate τ-mux through the `ht` CLI. Manage workspaces, terminal panes, browser panes, agent panes, sideband canvas panels, sidebar status, notifications, live process metadata, full browser automation, and the Telegram bridge. Use when running long-lived processes in panes, automating browser interactions, orchestrating multi-pane workflows, inspecting live process state, surfacing status to the user through the τ-mux UI, or sending/reading Telegram messages from a script.
---

# τ-mux — Complete `ht` CLI Skill

This skill covers every capability of the `ht` command line interface — terminal panes, browser panes, agent panes, sideband canvas panels, workspace management, sidebar state, notifications, live process metadata, script-runner surfaces, full browser automation, and the Telegram bridge.

## Prerequisites

- τ-mux must be running
- `ht` must be in PATH (install via menu: **τ-mux → Install 'ht' Command in PATH**)
- Default socket: `/tmp/hyperterm.sock` (override with `HT_SOCKET_PATH`)

Quick check:

```bash
ht ping        # → PONG
ht version     # → tau-mux 0.0.1
```

---

## Part 1 — System & Workspaces

### Verify connectivity

```bash
ht ping                              # PONG if running
ht identify                          # focused surface + workspace
ht capabilities --json               # all available RPC methods
ht tree                              # workspace → surface → pid tree
```

### Shutdown

```bash
ht shutdown                          # graceful exit: flush settings,
                                      # layout.json, cookies, history
```

The `shutdown` RPC runs the same teardown as ⌘Q — flushes the pending layout sync, persists settings/history/cookies, tears down sessions, then exits. Useful for scripted cleanup at the end of a test run or automation flow.

### Workspaces

```bash
ht list-workspaces                   # * marks active
ht new-workspace --cwd ~/project     # new workspace at directory
ht select-workspace --workspace ws:2
ht rename-workspace "backend"
ht close-workspace --workspace ws:2
ht next-workspace
ht previous-workspace
```

New workspaces with colliding auto-names (e.g. multiple zsh shells) automatically get a `" 2"`, `" 3"`, … suffix so the sidebar stays readable.

---

## Part 2 — Terminal Panes

### Create and navigate

```bash
ht new-split right                   # split focused pane right
ht new-split down                    # split focused pane down
ht list-surfaces                     # all surfaces with pid/title/cwd
ht list-panes                        # pane geometry in active workspace
ht focus-surface --surface surface:3
ht close-surface --surface surface:3
```

### Send input

```bash
ht send "echo hello\n"                          # \n = Enter
ht send --surface surface:2 "npm run dev\n"
ht send-key enter                                # enter|tab|escape|up|down|left|right|backspace|delete
```

Escape sequences: `\n` → Enter, `\t` → Tab, `\x1b` → Escape, `\\` → backslash.

### Read output

```bash
ht read-screen --lines 30                        # last 30 lines
ht read-screen --surface surface:2 --scrollback  # full scrollback buffer
ht capture-pane --lines 50                       # tmux alias
```

### Screenshot a pane (macOS only)

```bash
ht screenshot                            # focused pane → /tmp/ht-screenshot-<id>-<ts>.png
ht screenshot --surface surface:2        # specific pane
ht screenshot --output ~/Desktop/build.png
ht screenshot --full-window              # whole app window, no cropping
```

Captures the window via `screencapture -l <CGWindowID>`, then crops to the surface using `sips --cropOffset` (surface rect × devicePixelRatio). Prints the resulting PNG path on stdout.

### Surface titles

Programs emitting OSC 0/2 title escapes (vim, htop, ssh, tmux, …) automatically update the pane title in the sidebar and pane header. Explicit user renames via `rename-surface` lock the title — subsequent OSC escapes are ignored for the life of that surface.

---

## Part 3 — Script Runner

Spawn a command in a new surface tagged with a script key. The sidebar tracks running vs. errored state, matching the behaviour of launching a `package.json` script from the UI.

```bash
ht run-script --cwd ~/project --command "npm run dev"
ht run-script --cwd ~/project --command "bun test" --script-key "tests:unit"
ht run-script --cwd ~/project --command "make" --workspace ws:2
```

Returns `{ ok: true, scriptKey }`. Two concurrent `run-script` calls land in their own surfaces.

---

## Part 4 — Sidebar Status, Progress & Logs

Use these to surface state from long-running processes. The user sees pills, progress bars, and logs in the sidebar without having to read terminal output.

### Status pills

```bash
ht set-status build "compiling" --icon hammer --color "#ff9500"
ht set-status deploy "v1.2.3"
ht clear-status build
```

Status pills are capped at **32 per workspace**; the oldest is evicted on overflow. Use consistent keys per tool so updates replace rather than accumulate. They render in the sidebar as two-line rows (icon + uppercase key on top, value below).

**Workspace attribution.** `ht set-status` (and `clear-status`, `set-progress`, `clear-progress`, `log`) automatically forward `HT_SURFACE` from the shell's env; the Bun handler resolves it to the owning workspace. Scripts running in any pane write to their own workspace card, not the currently-selected one. Explicit `--workspace <id>` still takes precedence.

### Progress bars

```bash
ht set-progress 0.5 --label "Building..."
ht set-progress 1.0 --label "Done"
ht clear-progress
```

### Structured logs

```bash
ht log "Server started on port 3000"
ht log --level error --source build "Compilation failed"
ht log --level success -- "All 42 tests passed"
```

Levels: `info`, `progress`, `success`, `warning`, `error`. Log entries are capped at **200 per workspace** and auto-scroll into view — unless the user has scrolled up to read older entries, in which case their scroll position is preserved.

### Notifications

```bash
ht notify --title "Build Complete" --body "Production updated to v1.2.0"
ht list-notifications
ht clear-notifications
```

Notification list is bounded at **500 entries** process-wide. Emitted notifications carry a `surface_id` (from `HT_SURFACE`), which enables three behaviors in the sidebar:

- Clicking a notification focuses the workspace + pane that emitted it.
- Focusing the source pane by any means stops that notification's glow.
- The pulsing glow runs until the user clicks, dismisses with `×`, or focuses the source.

A short `assets/audio/finish.mp3` plays on arrival (both native webview and web mirror). Playback is best-effort; browser autoplay policies may block it until after user interaction. The user can toggle the cue (**Settings → General → Notification Sound**, or the **Mute / Unmute Notification Sound** command-palette entry) and adjust volume via the companion slider; the web mirror keeps its own mute + volume preference in `localStorage`.

Dismiss a single notification (no CLI shortcut yet — use raw JSON-RPC):

```bash
echo '{"id":"1","method":"notification.dismiss","params":{"id":"notif:42"}}' \
  | nc -U /tmp/hyperterm.sock
```

---

## Part 5 — Live Process Metadata

Every shell's process tree is polled at 1 Hz (slows to 3 Hz when the window is hidden; snaps back to 1 Hz instantly on focus return). These commands read from the cached snapshot.

```bash
ht metadata                          # summary: pid, fg command, cwd, git, counts
ht cwd                               # foreground process cwd
ht ps                                # process tree (PID PPID COMMAND, * = fg)
ht ports                             # listening TCP ports (PORT PROTO ADDR PID CMD)
ht git                               # branch, upstream, ahead/behind, dirty, +/-
```

If `ps`, `lsof`, or `git` are missing from PATH, the related chips stay empty and a one-shot console warning is logged — the polling loop keeps running.

### Open a port in the system browser

```bash
ht open 3000                         # http://localhost:3000
ht open                              # auto-detect unique port
```

### Kill by port

```bash
ht kill 3000                         # SIGTERM
ht kill 3000 --signal SIGKILL
```

### JSON mode

```bash
ht metadata --json | jq '.cwd'
ht ports --json | jq '.[].port'
```

---

## Part 6 — Sideband Canvas Panels

Scripts that speak the sideband protocol (fd 3/4/5) render floating canvas overlays on top of terminal panes — images, SVG, HTML, interactive canvas2d widgets, custom renderer types. The panel registry lets you observe which panels are live per surface.

```bash
ht panels                            # active panels on the focused surface
ht panels --surface surface:3        # specific surface
ht list-panels                       # alias
ht panels --json                     # machine-readable descriptors
```

Each descriptor carries `id`, `type` (`image`/`svg`/`html`/`canvas2d`/custom), `position` (`inline`/`float`/`overlay`/`fixed`), `width`, `height`, `createdAt`, `updatedAt`. Useful for scripts that want to wait for a panel to be rendered, or audit what a sideband-producer has left behind.

---

## Part 7 — Browser Panes

Browser panes embed a WebKit browser alongside terminal panes. They share the same workspace and layout system.

### Open a browser pane

```bash
ht browser open https://example.com              # new workspace
ht browser open-split https://localhost:3000      # split alongside current pane
```

### Navigation

```bash
ht browser browser:1 navigate https://example.org
ht browser browser:1 back
ht browser browser:1 forward
ht browser browser:1 reload
ht browser browser:1 url                          # print current URL
```

### Identify & list

```bash
ht browser browser:1 identify                     # {id, url, title, zoom}
ht browser list                                   # all browser surfaces
```

### Close

```bash
ht browser browser:1 close
```

Navigation failures (bad URL, DNS error, connection refused, etc.) render an inline error overlay over the webview with the failure code. The overlay clears on the next navigation attempt.

---

## Part 8 — Browser Automation (DOM Interaction)

All DOM commands use CSS selectors. They inject JavaScript into the browser pane.

### Click & mouse

```bash
ht browser browser:1 click "button[type='submit']"
ht browser browser:1 dblclick ".item-row"
ht browser browser:1 hover "#menu"
ht browser browser:1 focus "#email"
```

### Forms

```bash
ht browser browser:1 fill "#email" "user@example.com"     # set value
ht browser browser:1 fill "#email" ""                       # clear
ht browser browser:1 type "#search" "query text"            # type char by char
ht browser browser:1 press Enter                            # keypress
ht browser browser:1 select "#region" "us-east"             # dropdown
ht browser browser:1 check "#terms"
ht browser browser:1 uncheck "#newsletter"
```

### Scroll

```bash
ht browser browser:1 scroll --dy 800                       # scroll page down
ht browser browser:1 scroll --selector "#log-view" --dy 400
ht browser browser:1 scroll-into-view "#pricing"
```

### Highlight

```bash
ht browser browser:1 highlight "#checkout"                 # red outline 3s
```

---

## Part 9 — Browser Automation (Waiting)

Block until a condition is met. Critical for reliable automation.

```bash
ht browser browser:1 wait --load-state complete --timeout-ms 15000
ht browser browser:1 wait --selector "#checkout" --timeout-ms 10000
ht browser browser:1 wait --text "Order confirmed"
ht browser browser:1 wait --url-contains "/dashboard"
ht browser browser:1 wait --function "window.__appReady === true"
```

Returns `true` on success, `timeout` on failure.

**Always wait before inspecting or interacting with page content** — pages load asynchronously.

---

## Part 10 — Browser Automation (Inspection)

### Structured getters

```bash
ht browser browser:1 get title                             # page title
ht browser browser:1 get url                               # current URL
ht browser browser:1 get text "h1"                         # text content
ht browser browser:1 get html "main"                       # innerHTML
ht browser browser:1 get value "#email"                    # input value
ht browser browser:1 get attr "a.primary" --attr href      # attribute
ht browser browser:1 get count ".row"                      # element count
ht browser browser:1 get box "#checkout"                   # bounding box
ht browser browser:1 get styles "#total" --property color  # computed style
```

### Boolean checks

```bash
ht browser browser:1 is visible "#checkout"
ht browser browser:1 is enabled "button[type='submit']"
ht browser browser:1 is checked "#terms"
```

### Accessibility snapshot

```bash
ht browser browser:1 snapshot                              # DOM tree with roles/names/refs
```

Returns a JSON tree with `role`, `name`, `text`, `ref` (for interactive elements), and `children`.

---

## Part 11 — Browser JavaScript & Style Injection

```bash
ht browser browser:1 eval "document.title"                 # fire-and-forget eval
ht browser browser:1 addscript "console.log('injected')"   # inject JS
ht browser browser:1 addstyle "body { font-size: 20px }"   # inject CSS
```

---

## Part 12 — Browser Console & Error Capture

Console messages and JS errors are captured automatically via a preload script.

```bash
ht browser browser:1 console                   # list captured console.log/warn/error
ht browser browser:1 console clear             # clear
ht browser browser:1 errors                    # list JS errors + unhandled rejections
ht browser browser:1 errors clear              # clear
```

---

## Part 13 — Browser History, Cookies & DevTools

### History

```bash
ht browser history                             # all visited URLs
ht browser history clear                       # wipe history
```

### Cookies

```bash
ht browser-cookie-list                          # all stored cookies
ht browser-cookie-list example.com              # per-domain
ht browser-cookie-get https://example.com/path  # cookies matching URL
ht browser-cookie-set sid xyz --domain example.com --path / --secure true
ht browser-cookie-delete example.com sid
ht browser-cookie-clear example.com             # per-domain wipe
ht browser-cookie-clear                         # nuke everything
ht browser-cookie-import cookies.json --format json
ht browser-cookie-export --format netscape
ht browser-cookie-capture --surface browser:1   # snapshot the live page's cookies
```

Corrupt `cookies.json`, `browser-history.json`, and `settings.json` are moved aside to a `.bak` file at load time — users see a console warning instead of silently losing state. Write failures log once per transition into the failing state.

### DevTools & find

```bash
ht browser browser:1 devtools                  # toggle WebKit inspector
ht browser browser:1 find-in-page "search"     # find text in page
```

---

## Part 14 — Agent Panes

Agent panes run a `pi --mode rpc` subprocess as a virtual surface. The agent participates in the pane layout like any other surface.

```bash
ht agent new                                   # new agent in a new workspace
ht agent split horizontal                      # split focused pane with an agent
ht agent split vertical
ht agent list                                  # live agents (id only)
ht agent count                                 # number of live agents
ht agent close agent-1                         # close by agent id
ht agent close --surface agent-1               # same, via flag
```

Agents require the `pi` binary on PATH. If it's missing, `ht agent new` succeeds at the RPC layer but the agent subprocess fails to start (check the app's stderr).

---

## Part 15 — Telegram Bridge

A long-poll bot service inside the app mirrors a Telegram chat into a first-class pane. The CLI reads + writes the same chat history. Configure the bot in **Settings → Telegram** (token + allowed user IDs) — this skill assumes that's done.

### Status & chats

```bash
ht telegram status                   # disabled / starting / polling / error: <reason>
ht telegram chats                    # id, name, last seen
```

### Read recent messages

```bash
ht telegram read --chat 8446656662 --limit 20
ht telegram read --limit 5           # defaults --chat to most-recently-active
```

When `--chat` is missing the CLI prints `defaulting to chat <id> (<name>)` to **stderr** and resolves to the most recent chat.

### Send a message

```bash
ht telegram send --chat 8446656662 "build done"
ht telegram send "build done"        # default chat
echo "build done" | ht telegram send # body from piped stdin
make 2>&1 | tail -20 | ht telegram send
```

The `chat_id` resolution order: `--chat` → `$HT_TELEGRAM_CHAT` → most-recent chat (one extra round-trip). Output: `sent [hh:mm] <text>`.

### Default chat via env

```bash
export HT_TELEGRAM_CHAT=8446656662
```

### Notes

- Outbound is rate-limited to 1 msg/sec per chat (3-burst). Failed sends still appear in history with a "failed" badge in the UI.
- A 409 in `ht telegram status` means another `getUpdates` consumer is running — usually a stray app instance.
- Setting **Forward Notifications** in Settings → Telegram makes every `ht notify` (and any sidebar notification) DM all allowed user IDs.

---

## Part 16 — Surface Targeting

### Terminal surfaces

Use `surface:N` IDs. The `--surface` flag targets a specific pane. Without it, commands target the focused surface. Inside a τ-mux terminal, `HT_SURFACE` is auto-set.

```bash
ht send --surface surface:3 "ls\n"
ht metadata --surface surface:3
```

### Browser surfaces

Use `browser:N` IDs. Pass them positionally or with `--surface`:

```bash
ht browser browser:2 click "#btn"                # positional
ht browser --surface browser:2 click "#btn"      # flag
ht browser click "#btn"                           # target focused browser
```

### Agent surfaces

Agent ids look like `agent-1`, `agent-2`, …

```bash
ht agent close agent-2
```

---

## Workflow Recipes

### Recipe: Dev server + browser preview

```bash
# Start dev server in a pane
ht send "npm run dev\n"
ht set-status dev "starting" --icon rocket

# Wait for port to appear
sleep 3
PORT=$(ht ports --json | jq -r '.[0].port')

# Open browser alongside
ht browser open-split "http://localhost:$PORT"

# Update status
ht set-status dev "running on :$PORT" --color "#a6e3a1"
```

### Recipe: Fill a login form

```bash
ht browser open-split https://myapp.com/login
sleep 2
ht browser browser:1 wait --load-state complete --timeout-ms 10000
ht browser browser:1 fill "#email" "admin@example.com"
ht browser browser:1 fill "#password" "$PASSWORD"
ht browser browser:1 click "button[type='submit']"
ht browser browser:1 wait --text "Dashboard" --timeout-ms 10000
ht browser browser:1 get title
```

### Recipe: Multi-pane orchestration

```bash
# Create workspace layout: terminal left, browser right
ht new-workspace --cwd ~/project
ht browser open-split https://github.com/user/repo/pulls

# Start build via script-runner so the sidebar tracks it
ht run-script --cwd ~/project --command "npm run build" --script-key "build"
ht set-progress 0.0 --label "Building..."

# Monitor and update
while true; do
  OUTPUT=$(ht read-screen --lines 5)
  if echo "$OUTPUT" | grep -q "Build complete"; then
    ht set-progress 1.0 --label "Done"
    ht notify --title "Build" --body "Complete"
    break
  fi
  sleep 2
done
```

### Recipe: Inspect and debug a page

```bash
ht browser browser:1 console                     # check for errors
ht browser browser:1 errors                      # JS exceptions
ht browser browser:1 get text ".error-message"   # read error text
ht browser browser:1 eval "performance.now()"    # check perf
ht browser browser:1 snapshot                    # DOM structure
```

### Recipe: CI-like test + notify

```bash
ht send "bun test\n"
ht set-status tests "running" --icon bolt --color "#fbbf24"

sleep 5
OUTPUT=$(ht read-screen --lines 20)
if echo "$OUTPUT" | grep -q "fail"; then
  ht set-status tests "failed" --color "#f87171"
  ht notify --title "Tests Failed" --body "Check the terminal"
  ht log --level error --source tests "Test suite failed"
else
  ht set-status tests "passed" --color "#a6e3a1"
  ht notify --title "Tests Passed" --body "All green"
  ht log --level success --source tests "All tests passed"
fi
```

### Recipe: Run the crazyShell Reviewer

```bash
# One-shot expert review report into code_reviews/
bun run review:agent

# Continuous polling review loop for new commits
bun run review:agent:watch --poll-seconds=900
```

The repository-local reviewer is proposition-only: it inspects the repo with Hermes, consults `DEV_RULES.md` + `doc/`, and writes a dated markdown report with the reference commit into `code_reviews/`. If the run mutates anything outside `code_reviews/`, it fails hard instead of saving a warning report. See `doc/code-review-agent.md` for the report format and watch-loop behavior.

### Recipe: Watch a port and auto-open

```bash
# Wait for any port to appear
while true; do
  PORTS=$(ht ports --json 2>/dev/null)
  COUNT=$(echo "$PORTS" | jq 'length' 2>/dev/null || echo "0")
  if [ "$COUNT" -gt "0" ]; then
    PORT=$(echo "$PORTS" | jq -r '.[0].port')
    ht browser open-split "http://localhost:$PORT"
    ht log "Auto-opened browser for :$PORT"
    break
  fi
  sleep 1
done
```

### Recipe: Notify Telegram from a long build

```bash
ht set-status build "compiling" --icon hammer
START=$(date +%s)
if make all; then
  DUR=$(( $(date +%s) - START ))
  ht set-status build "ok in ${DUR}s" --color "#a6e3a1"
  ht telegram send "✅ build ok in ${DUR}s on $(hostname)"
else
  ht log --level error --source build "make failed"
  ht set-status build "failed" --color "#f87171"
  make all 2>&1 | tail -20 | ht telegram send
fi
```

### Recipe: Pipe test output to Telegram on failure

```bash
OUTPUT=$(bun test 2>&1)
if echo "$OUTPUT" | grep -q "fail"; then
  printf "❌ tests failed:\n%s" "$(echo "$OUTPUT" | tail -30)" | ht telegram send
fi
```

### Recipe: Wait for a sideband panel to render

```bash
# Kick off a script that produces an SVG panel
ht run-script --cwd ~/demo --command "python3 plot.py" --script-key "plot"

# Poll until the panel is live
while true; do
  PANEL=$(ht panels --json | jq -r '.[] | select(.type == "svg") | .id' | head -1)
  if [ -n "$PANEL" ]; then
    ht log --level success "Plot rendered: $PANEL"
    break
  fi
  sleep 0.5
done
```

### Recipe: Clean scripted shutdown

```bash
# Run a batch of operations, then cleanly quit the app
ht run-script --cwd ~/project --command "bun run build" --script-key "build"
sleep 30
ht notify --title "Nightly build" --body "Complete"
ht shutdown                                   # flushes layout, settings, cookies
```

---

## JSON Mode

Add `--json` or `-j` to any command for raw JSON output. This is essential for scripting.

```bash
ht identify --json
ht tree --json
ht metadata --json
ht list-surfaces --json
ht ports --json
ht panels --json
ht agent list --json
ht browser list --json
```

---

## Important Notes

- `ht` has a **5-second timeout** — if a response doesn't arrive, it exits with code 1 and a clear error. Previously it exited 0 silently; scripts that relied on that bug will now see failures.
- Browser `get`, `is`, and `wait` commands are async (JS eval roundtrip) — may take a few hundred ms.
- `wait` returns `"true"` or `"timeout"` — check the result.
- Sidebar status keys are arbitrary strings — use consistent keys per tool.
- `\n` in `ht send` is a carriage return (Enter), not a newline.
- `ht open` without a port errors if zero or multiple ports are detected — use explicit port.
- For `new-split`, use `right` or `down` for predictable behavior.
- Surface-id prefixes: terminals use `surface:N`, browsers use `browser:N`, agents use `agent-N` (hyphen, not colon), Telegram uses `tg:N:<rand>`.
- `ht agent new` + `ht shutdown` require the bun main process and will not work against a web-mirror-only connection.
- `ht telegram send` reads stdin when no positional text is given — `make 2>&1 | ht telegram send` works.
- `HT_TELEGRAM_CHAT` overrides the most-recent-chat fallback for `ht telegram send` and `ht telegram read`.

---

## Complete Command Reference

### System
`ping`, `version`, `identify`, `capabilities`, `tree`, `shutdown`

### Workspaces
`list-workspaces`, `current-workspace`, `new-workspace`, `select-workspace`, `close-workspace`, `rename-workspace`, `next-workspace`, `previous-workspace`

### Surfaces
`list-surfaces`, `new-split`, `close-surface`, `focus-surface`, `list-panes`

### I/O
`send`, `send-key`, `read-screen`, `capture-pane`, `screenshot`

### Sidebar
`set-status`, `clear-status`, `set-progress`, `clear-progress`, `log`

### Notifications
`notify`, `list-notifications`, `clear-notifications`

### Metadata
`metadata`, `cwd`, `ps`, `ports`, `git`, `open`, `kill`

### Sideband panels
`panels`, `list-panels`

### Script runner
`run-script`

### Agents
`agent new`, `agent split`, `agent list`, `agent count`, `agent close`

### Browser
`browser open`, `browser open-split`, `browser navigate`, `browser back`, `browser forward`, `browser reload`, `browser url`, `browser identify`, `browser list`, `browser close`, `browser wait`, `browser click`, `browser dblclick`, `browser hover`, `browser focus`, `browser check`, `browser uncheck`, `browser scroll-into-view`, `browser type`, `browser fill`, `browser press`, `browser select`, `browser scroll`, `browser highlight`, `browser snapshot`, `browser get`, `browser is`, `browser eval`, `browser addscript`, `browser addstyle`, `browser console`, `browser errors`, `browser devtools`, `browser find-in-page`, `browser history`

### Browser cookies
`browser-cookie-list`, `browser-cookie-get`, `browser-cookie-set`, `browser-cookie-delete`, `browser-cookie-clear`, `browser-cookie-import`, `browser-cookie-export`, `browser-cookie-capture`

### Telegram
`telegram status`, `telegram chats`, `telegram read`, `telegram send`
