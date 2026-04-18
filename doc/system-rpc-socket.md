# HyperTerm Canvas: CLI & RPC Socket Guide

The `ht` Command Line Interface provides complete programmatic control over HyperTerm Canvas from outside the terminal GUI. Whether you want to automate workspace setups, pipe logs into the sidebar, or script complex multi-pane layouts, the CLI gives you access to the terminal's internal state.

Under the hood, `ht` communicates with HyperTerm Canvas via a JSON-RPC Unix Socket located at `/tmp/hyperterm.sock`.

---

## Getting Started

If you haven't already, make sure the `ht` command is available in your path:

```bash
cd /path/to/hyperterm-canvas
bun link
```

You can verify the CLI is connected to the running terminal instance:

```bash
ht ping
# Output: PONG

ht version
# Output: hyperterm-canvas 0.0.1
```

---

## 1. Workspaces and Navigation

Workspaces are logical groups of terminal panes. You can list, create, close, and navigate between them.

**List all workspaces:**
```bash
ht list-workspaces
# Output:
# * ws:1  my-project [selected]
#   ws:2  server-logs
```

**Create and switch workspaces:**
```bash
# Create a new workspace starting in a specific directory
ht new-workspace --name "backend" --cwd "/var/www/api"

# Switch to a specific workspace by ID
ht select-workspace --workspace "ws:2"

# Navigate sequentially
ht next-workspace
ht previous-workspace

# Rename the current workspace
ht rename-workspace "frontend-build"
```

---

## 2. Managing Splits and Panes (Surfaces)

A workspace is divided into panes (referred to internally as "surfaces"). Every terminal instance running inside HyperTerm is a surface with a unique ID (e.g., `surface:5`).

When you run `ht` inside a HyperTerm pane, the environment variables `HT_WORKSPACE_ID` and `HT_SURFACE_ID` are automatically set. If you don't specify a `--surface` flag in your commands, `ht` will target the pane it was executed from.

**Splitting the current pane:**
```bash
ht new-split right  # Splits vertically, placing new pane on the right
ht new-split down   # Splits horizontally, placing new pane below
```

**Interacting with specific panes:**
```bash
# Get the tree of all workspaces, panes, and their PIDs
ht tree

# Focus a specific pane
ht focus-surface --surface "surface:3"

# Close a specific pane
ht close-surface --surface "surface:3"
```

---

## 3. Remote Control: Sending & Reading Data

You can orchestrate commands across multiple panes without leaving your main terminal.

**Sending input:**
```bash
# Send a command to a specific pane (note the \n for Enter)
ht send --surface "surface:2" "npm run dev\n"

# Send a specific keystroke to the focused pane
ht send-key escape
ht send-key enter
ht send-key up
```

**Reading output:**
```bash
# Read the last 20 lines of text from a background pane
ht read-screen --surface "surface:2" --lines 20

# Capture the entire scrollback buffer of the current pane
ht read-screen --scrollback
```

*(Note: `ht capture-pane` is an alias for `ht read-screen` for users familiar with tmux).*

---

## 4. The Sidebar: Status, Progress, and Logs

The HyperTerm Canvas Sidebar is designed to be an ambient dashboard for your scripts. You can push metadata to it directly from the CLI.

### Status Pills
Status pills are key/value pairs that appear under the workspace name in the sidebar. The sidebar renders them as stacked two-line rows (icon + uppercase key on top, high-contrast value below).

```bash
# Set a green status pill indicating a successful build
ht set-status build "passing" --color "#a6e3a1" --icon "✓"

# Update it to failing
ht set-status build "failing" --color "#f38ba8" --icon "✗"

# Remove the pill
ht clear-status build
```

Status is **attributed to the caller's workspace automatically** — inside a HyperTerm shell, `HT_SURFACE` is set on every child process and `ht` forwards it in the `surface_id` param; the Bun-side handler then resolves which workspace owns that surface. You rarely need `--workspace <id>` explicitly. When neither `--workspace` nor `HT_SURFACE` is available (e.g. running `ht` from an external shell), the server falls back to the currently-active workspace. The same resolution applies to `clear-status`, `set-progress`, `clear-progress`, and `log`.

### Progress Bars
Display a global progress bar for long-running tasks within a workspace.

```bash
# Set progress to 50%
ht set-progress 0.5 --label "Compiling assets..."

# Clear the progress bar when done
ht clear-progress
```

### Logs
Push structural logs to the sidebar's log viewer.

```bash
ht log "Server listening on port 3000"
ht log --level error --source "webpack" "Failed to compile module"
ht log --level success "Tests passed (42/42)"
```

*(Valid levels are: `info`, `progress`, `success`, `warning`, `error`)*

---

## 5. System Notifications

Trigger notifications that land in the sidebar (and the web mirror) with a glow animation and a short `finish.mp3` cue.

```bash
ht notify --title "Deployment Complete" --body "Production updated to v1.2.0"
```

The CLI auto-forwards `HT_SURFACE`, so notifications emitted from inside a pane carry a `surface_id`. That drives three behaviors:

- Clicking the notification in the sidebar focuses the originating workspace + pane.
- Focusing the source pane by any means clears that notification's glow.
- The glow keeps pulsing until the user clicks, dismisses, or focuses the source.

Dismiss individual entries from the sidebar's `×` button, or via the `notification.dismiss` RPC method:

```bash
echo '{"id":"1","method":"notification.dismiss","params":{"id":"notif:42"}}' | nc -U /tmp/hyperterm.sock
```

`ht list-notifications` returns the current ring-buffer; `ht clear-notifications` empties it.

---

## 6. Live Process Metadata

A metadata poller (see [system-process-metadata.md](system-process-metadata.md)) observes every descendant of every shell. The CLI exposes five commands against the poller's cached snapshot.

**Summary of the current surface:**

```bash
ht metadata
# pid        12345
# fg pid     12346
# fg command bun run dev
# cwd        /Users/olivier/work
# tree       4 process(es)
# ports      1 listener(s)
```

**Just the cwd of the foreground process:**

```bash
ht cwd
# /Users/olivier/work
```

**Full descendant tree** (with a `*` on the foreground row):

```bash
ht ps
#   PID  PPID  COMMAND
#   12345     1  -zsh
# * 12346 12345  bun run dev
#   12347 12346  node --experimental-vm-modules …
```

**Listening TCP ports** — joined back to the tree command so you can see "what's serving :3000":

```bash
ht ports
# PORT   PROTO  ADDRESS          PID    COMMAND
# 3000   tcp    *                12346  bun run dev
# 8080   tcp6   ::1              12347  python3 -m http.server
```

**Open ports in the browser:**

```bash
ht open 3000                         # http://localhost:3000
ht open                              # resolves the unique listening port
```

`ht open` without a port errors if there are zero or multiple ports, listing the candidates so you can pick one.

**Signal the process bound to a port:**

```bash
ht kill 3000                         # SIGTERM (default)
ht kill 3000 --signal SIGKILL        # or SIGHUP, SIGUSR1, etc.
```

Every metadata command accepts `--surface <id>` to target a non-focused pane. Inside a HyperTerm shell, `HT_SURFACE` is auto-set so the CLI uses the *current* pane by default.

**Raw JSON:**

```bash
ht metadata --json
# {
#   "pid": 12345,
#   "foregroundPid": 12346,
#   "cwd": "/Users/olivier/work",
#   "tree": [
#     {"pid":12345,"ppid":1,"command":"-zsh","cpu":0.1,"rssKb":2048},
#     {"pid":12346,"ppid":12345,"command":"bun run dev","cpu":12.4,"rssKb":45312}
#   ],
#   "listeningPorts": [{"pid":12346,"port":3000,"proto":"tcp","address":"*"}],
#   "updatedAt": 1728766122123
# }
```

Because metadata fans out identically to the web mirror, you can also observe it live over WebSocket by watching `{ type: "surfaceMetadata", surfaceId, metadata }` frames on the mirror connection — useful for building remote dashboards or piping into telemetry systems.

---

## Advanced Usage: JSON Output & RPC

Every `ht` command supports the `--json` (or `-j`) flag. This will format the output as raw JSON, making it extremely easy to parse using tools like `jq`.

```bash
ht identify --json
# {
#   "focused_surface": "surface:1",
#   "active_workspace": "ws:1",
#   "socket_path": "/tmp/hyperterm.sock"
# }
```

### Custom RPC Scripts
Because `ht` is just a thin wrapper over a JSON-RPC Unix socket, you can bypass the CLI entirely and communicate with the terminal using Python, Node, or Netcat.

**Example using `nc` (Netcat):**
```bash
echo '{"id":"1", "method":"system.ping", "params":{}}' | nc -U /tmp/hyperterm.sock
# {"id":"1","result":"PONG"}
```

Use `ht capabilities --json` to get the live list of all available JSON-RPC methods (currently 33+, including the metadata surface methods below).

### Method reference

All methods accept an optional `surface_id` in their params; if omitted, the server substitutes the focused surface. A trailing description in **bold** marks methods added with the metadata pipeline.

**`system.*`** — `ping`, `version`, `identify`, `capabilities`, `tree`.

**`workspace.*`** — `list`, `current`, `create`, `select`, `close`, `rename`, `next`, `previous`.

**`surface.*`** — `list`, `split`, `close`, `focus`, `send_text`, `send_key`, `read_text`, **`metadata`**, **`open_port`**, **`kill_port`**, **`kill_pid`**.

**`sidebar.*`** — `set_status`, `clear_status`, `set_progress`, `clear_progress`, `log`.

**`notification.*`** — `create`, `list`, `clear`, `dismiss`.

**`pane.*`** — `list`.

**`browser.*`** — `list`, `open`, `open_split`, `close`, `identify`, `navigate`, `back`, `forward`, `reload`, `url`, `wait`, `click`, `dblclick`, `hover`, `focus`, `check`, `uncheck`, `scroll_into_view`, `type`, `fill`, `press`, `select`, `scroll`, `highlight`, `snapshot`, `get`, `is`, `eval`, `addscript`, `addstyle`, `find`, `stop_find`, `devtools`, `console_list`, `console_clear`, `errors_list`, `errors_clear`, `history`, `clear_history`.

### Live metadata methods in detail

```json
// surface.metadata — cached snapshot from the poller
{"id":"1","method":"surface.metadata","params":{"surface_id":"surface:2"}}
// → result: SurfaceMetadata | null

// surface.open_port — optional port; resolves from metadata if omitted
{"id":"2","method":"surface.open_port","params":{"surface_id":"surface:2","port":3000}}
// → result: { url, port } ; throws if ambiguous or no listener

// surface.kill_port — resolves pid from metadata, sends signal
{"id":"3","method":"surface.kill_port","params":{"port":3000,"signal":"SIGTERM"}}
// → result: { pid, port, signal }

// surface.kill_pid — signal a pid tracked by a surface's process tree
// (used by the Process Manager UI). Rejects pids that aren't in a
// live SurfaceMetadata.tree; rejects signals outside the whitelist.
{"id":"4","method":"surface.kill_pid","params":{"pid":12346,"signal":"SIGKILL"}}
// → result: { pid, signal }
// → error if pid is not a descendant of any surface shell
// → error if signal is not in { SIGTERM, SIGINT, SIGKILL, SIGHUP, SIGQUIT }
```

All four error via thrown messages (surface server converts to `{"error":"..."}`). `signal` accepts either `SIGTERM` or `TERM`; the server rewrites to a Node-style `NodeJS.Signals` value and then validates against the whitelist above. `surface.kill_pid` additionally requires the pid to appear in at least one surface's tracked process tree — raw `process.kill(N, SIG)` on arbitrary system pids is not reachable through the socket.

---

### Browser automation methods in detail

Browser panes use `browser:N` surface IDs. Pass `surface_id` to target a specific pane; if omitted, commands target the focused browser pane.

```json
// Open a browser split
{"id":"1","method":"browser.open_split","params":{"url":"https://example.com"}}

// Navigate
{"id":"2","method":"browser.navigate","params":{"surface_id":"browser:1","url":"https://example.org"}}

// Wait for page load
{"id":"3","method":"browser.wait","params":{"surface_id":"browser:1","load_state":"complete","timeout_ms":15000}}
// → result: "true" or "timeout"

// Click an element
{"id":"4","method":"browser.click","params":{"surface_id":"browser:1","selector":"button[type='submit']"}}

// Fill a form field
{"id":"5","method":"browser.fill","params":{"surface_id":"browser:1","selector":"#email","text":"user@example.com"}}

// Get page title (async — result comes back via eval roundtrip)
{"id":"6","method":"browser.get","params":{"surface_id":"browser:1","what":"title"}}
// → result: "Example Domain"

// Check if element is visible
{"id":"7","method":"browser.is","params":{"surface_id":"browser:1","check":"visible","selector":"#dashboard"}}
// → result: "true" or "false"

// Get captured console logs
{"id":"8","method":"browser.console_list","params":{"surface_id":"browser:1"}}
// → result: [{"level":"log","args":["hello"],"timestamp":1728766122123}, ...]

// Inject CSS
{"id":"9","method":"browser.addstyle","params":{"surface_id":"browser:1","css":"body { font-size: 20px }"}}

// Cookie management
{"id":"10","method":"browser.cookie_list","params":{}}
// → result: [{name, value, domain, path, expires, secure, httpOnly, sameSite, source, updatedAt}, ...]

{"id":"11","method":"browser.cookie_import","params":{"data":"[{\"name\":\"session\",\"value\":\"abc\",\"domain\":\".example.com\"}]","format":"json"}}
// → result: {"imported": 1}

{"id":"12","method":"browser.cookie_export","params":{"format":"json"}}
// → result: JSON string of all cookies

{"id":"13","method":"browser.cookie_capture","params":{"surface_id":"browser:1"}}
// → result: {"captured": 5, "domain": "example.com"}
```

For the full method reference (including 9 cookie methods), see [`doc/system-browser-pane.md`](system-browser-pane.md) § 6.

## Limitations and Caveats

- **Parameter Parsing:** The `ht` CLI flag parser is simplistic. It expects flags in the format `--key value` (with a space). It **does not** support `--key=value`.
- **No Sidebar Read API:** Currently, you can write status pills, progress, and logs to the sidebar, but there is no API method to read them back out (e.g., you cannot do `ht get-status`).
- **Browser eval is async:** `browser.get`, `browser.is`, and `browser.wait` use a JS eval → host-message roundtrip. Results may take a few hundred milliseconds and time out after 5s (get/is) or the configured timeout (wait).
- **Signal Handling:** While closing a pane via `ht close-surface` sends a SIGKILL to the underlying shell, deep process trees (like a spawned dev server) might occasionally be left orphaned depending on the shell configuration.

## Input validation & audit log

A small set of sensitive methods run through a schema check before the handler fires:

| Method | Enforced constraints |
|---|---|
| `surface.kill_pid` | `pid` required integer ≥ 1; `signal` ≤ 16 chars, additionally whitelisted to SIGTERM/INT/KILL/HUP/QUIT; pid must be tracked by a live surface tree |
| `surface.kill_port` | `port` required integer 1..65535 |
| `workspace.create` | `cwd` ≤ 4096 chars; `name` ≤ 256 chars; `cwd` is realpath-resolved and must be an existing directory (falls back to `$HOME` otherwise) |
| `browser.eval` | `script` required ≤ 256 KiB |
| `browser.click` | `selector` required ≤ 2048 chars |

Schema failures surface as `{"error":"..."}` on the JSON-RPC wire (same shape as handler errors).

An **audit line** is emitted to `console.debug` for every RPC call: `[rpc] <method> paramBytes=<n>`. Parameter contents are never logged (they may contain tokens, cookies, or shell input). Set `LOG_RPC=0` in the environment to suppress the audit log entirely (e.g., in tests or high-throughput tracing).