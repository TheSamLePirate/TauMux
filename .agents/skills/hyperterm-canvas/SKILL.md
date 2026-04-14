---
name: hyperterm-canvas
description: Operate HyperTerm Canvas through the `ht` CLI. Manage workspaces, terminal panes, browser panes, sidebar status, notifications, process metadata, and browser automation. Use when running long-lived processes in panes, automating browser interactions, orchestrating multi-pane workflows, inspecting live process state, or surfacing status to the user through the HyperTerm UI.
---

# HyperTerm Canvas — Complete `ht` CLI Skill

This skill covers every capability of the `ht` command line interface — terminal panes, browser panes, workspace management, sidebar state, notifications, live process metadata, and full browser automation.

## Prerequisites

- HyperTerm Canvas must be running
- `ht` must be in PATH (install via menu: **HyperTerm Canvas → Install 'ht' Command in PATH**)
- Default socket: `/tmp/hyperterm.sock` (override with `HT_SOCKET_PATH`)

Quick check:

```bash
ht ping        # → PONG
ht version     # → hyperterm-canvas 0.0.1
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

---

## Part 3 — Sidebar Status, Progress & Logs

Use these to surface state from long-running processes. The user sees pills, progress bars, and logs in the sidebar without having to read terminal output.

### Status pills

```bash
ht set-status build "compiling" --icon hammer --color "#ff9500"
ht set-status deploy "v1.2.3"
ht clear-status build
```

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

Levels: `info`, `progress`, `success`, `warning`, `error`.

### Notifications

```bash
ht notify --title "Build Complete" --body "Production updated to v1.2.0"
ht list-notifications
ht clear-notifications
```

---

## Part 4 — Live Process Metadata

Every shell's process tree is polled at 1 Hz. These commands read from the cached snapshot.

```bash
ht metadata                          # summary: pid, fg command, cwd, git, counts
ht cwd                               # foreground process cwd
ht ps                                # process tree (PID PPID COMMAND, * = fg)
ht ports                             # listening TCP ports (PORT PROTO ADDR PID CMD)
ht git                               # branch, upstream, ahead/behind, dirty, +/-
```

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

## Part 5 — Browser Panes

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

---

## Part 6 — Browser Automation (DOM Interaction)

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

## Part 7 — Browser Automation (Waiting)

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

## Part 8 — Browser Automation (Inspection)

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

## Part 9 — Browser JavaScript & Style Injection

```bash
ht browser browser:1 eval "document.title"                 # fire-and-forget eval
ht browser browser:1 addscript "console.log('injected')"   # inject JS
ht browser browser:1 addstyle "body { font-size: 20px }"   # inject CSS
```

---

## Part 10 — Browser Console & Error Capture

Console messages and JS errors are captured automatically via a preload script.

```bash
ht browser browser:1 console                   # list captured console.log/warn/error
ht browser browser:1 console clear             # clear
ht browser browser:1 errors                    # list JS errors + unhandled rejections
ht browser browser:1 errors clear              # clear
```

---

## Part 11 — Browser History & DevTools

```bash
ht browser history                             # all visited URLs
ht browser history clear                       # wipe history
ht browser browser:1 devtools                  # toggle WebKit inspector
ht browser browser:1 find-in-page "search"     # find text in page
```

---

## Part 12 — Surface Targeting

### Terminal surfaces

Use `surface:N` IDs. The `--surface` flag targets a specific pane. Without it, commands target the focused surface. Inside a HyperTerm terminal, `HT_SURFACE` is auto-set.

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

# Start build in the terminal
ht send "npm run build\n"
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

---

## JSON Mode

Add `--json` or `-j` to any command for raw JSON output. This is essential for scripting.

```bash
ht identify --json
ht tree --json
ht metadata --json
ht list-surfaces --json
ht ports --json
ht browser list --json
```

---

## Important Notes

- `ht` has a 5-second timeout — if a response doesn't arrive, it exits
- Browser `get`, `is`, and `wait` commands are async (JS eval roundtrip) — may take a few hundred ms
- `wait` returns `"true"` or `"timeout"` — check the result
- Sidebar status keys are arbitrary strings — use consistent keys per tool
- `\n` in `ht send` is a carriage return (Enter), not a newline
- `ht open` without a port errors if zero or multiple ports are detected — use explicit port
- For `new-split`, use `right` or `down` for predictable behavior
- Browser surfaces use `browser:N` IDs, terminal surfaces use `surface:N` IDs

---

## Complete Command Reference

### System
`ping`, `version`, `identify`, `capabilities`, `tree`

### Workspaces
`list-workspaces`, `current-workspace`, `new-workspace`, `select-workspace`, `close-workspace`, `rename-workspace`, `next-workspace`, `previous-workspace`

### Surfaces
`list-surfaces`, `new-split`, `close-surface`, `focus-surface`, `list-panes`

### I/O
`send`, `send-key`, `read-screen`, `capture-pane`

### Sidebar
`set-status`, `clear-status`, `set-progress`, `clear-progress`, `log`

### Notifications
`notify`, `list-notifications`, `clear-notifications`

### Metadata
`metadata`, `cwd`, `ps`, `ports`, `git`, `open`, `kill`

### Browser
`browser open`, `browser open-split`, `browser navigate`, `browser back`, `browser forward`, `browser reload`, `browser url`, `browser identify`, `browser list`, `browser close`, `browser wait`, `browser click`, `browser dblclick`, `browser hover`, `browser focus`, `browser check`, `browser uncheck`, `browser scroll-into-view`, `browser type`, `browser fill`, `browser press`, `browser select`, `browser scroll`, `browser highlight`, `browser snapshot`, `browser get`, `browser is`, `browser eval`, `browser addscript`, `browser addstyle`, `browser console`, `browser errors`, `browser devtools`, `browser find-in-page`, `browser history`
