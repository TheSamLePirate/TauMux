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
Status pills are key/value pairs that appear under the workspace name in the sidebar.

```bash
# Set a green status pill indicating a successful build
ht set-status build "passing" --color "#a6e3a1" --icon "✓"

# Update it to failing
ht set-status build "failing" --color "#f38ba8" --icon "✗"

# Remove the pill
ht clear-status build
```

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

Trigger native-looking notifications that overlay the terminal UI.

```bash
ht notify --title "Deployment Complete" --body "Production updated to v1.2.0"
```

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

Use `ht capabilities --json` to get a list of all 29 available JSON-RPC methods.

---

## Limitations and Caveats

- **Parameter Parsing:** The `ht` CLI flag parser is simplistic. It expects flags in the format `--key value` (with a space). It **does not** support `--key=value`.
- **No Sidebar Read API:** Currently, you can write status pills, progress, and logs to the sidebar, but there is no API method to read them back out (e.g., you cannot do `ht get-status`).
- **Signal Handling:** While closing a pane via `ht close-surface` sends a SIGKILL to the underlying shell, deep process trees (like a spawned dev server) might occasionally be left orphaned depending on the shell configuration.