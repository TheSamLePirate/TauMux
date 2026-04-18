# HyperTerm Canvas: Webview & UI System Guide

The frontend of HyperTerm Canvas runs inside an [Electrobun](https://electrobun.dev) Webview. This environment is responsible for taking the raw data provided by the Bun backend and turning it into a beautiful, interactive, macOS-oriented terminal workspace UI.

For the visual system and styling rules that govern this UI, see [system-webview-design-guidelines.md](system-webview-design-guidelines.md).

This guide details how the UI is structured, how the tiling window manager works, and how to interact with the visual components.

---

## 1. The Layout: Workspaces & Panes

HyperTerm Canvas operates using a **Tiling Window Manager** approach, heavily inspired by `tmux`.

### Workspaces
The highest level of organization is the Workspace. You can think of a Workspace as a "Tab" or a "Virtual Desktop".
- Each Workspace has a unique color accent (used in the UI borders and Sidebar).
- Only one Workspace is visible on the screen at a time.
- You can cycle through them using `Ctrl+Cmd+]` / `[` or jump to them via the Sidebar.

### Surfaces (Panes)
Within a Workspace, the screen can be divided into multiple `Surfaces`.
- A Surface is either a **terminal instance** (running `xterm.js`) or a **browser instance** (running `<electrobun-webview>`).
- Terminal surfaces have IDs like `surface:N`; browser surfaces use `browser:N`.
- Surfaces are organized using a **Binary Tree** (`PaneLayout`).
- When you split a surface horizontally or vertically, the available space is mathematically halved.
- You can resize panes by clicking and dragging the dividers (the gaps between terminals/browsers) with your mouse.

---

## 2. Keyboard Shortcuts

Because HyperTerm prioritizes keyboard-centric workflows, most actions can be performed without touching the mouse.

*Note: In macOS, `Cmd` is the Command key. In Linux/Windows, this usually maps to the `Super` or `Ctrl` key depending on the OS integration.*

| Action | Shortcut | Description |
|---|---|---|
| **New Workspace** | `Cmd+N` | Opens a brand new workspace with a fresh shell. |
| **Split Right** | `Cmd+D` | Splits the currently focused pane vertically. |
| **Split Down** | `Cmd+Shift+D` | Splits the currently focused pane horizontally. |
| **Close Pane** | `Cmd+W` | Closes the currently focused pane. If it's the last pane, the workspace closes. |
| **Open Browser Split** | `Cmd+Shift+L` | Splits a browser pane alongside the focused pane. |
| **Focus Direction** | `Cmd+Alt+Arrow` | Moves keyboard focus to the adjacent pane in the direction of the arrow. |
| **Next Workspace** | `Ctrl+Cmd+]` | Jumps to the next workspace in the list. |
| **Prev Workspace** | `Ctrl+Cmd+[` | Jumps to the previous workspace in the list. |
| **Jump to Workspace** | `Cmd+1` to `Cmd+9`| Jumps directly to Workspace 1 through 9. |
| **Toggle Sidebar** | `Cmd+B` | Shows or hides the left Sidebar. |
| **Command Palette** | `Cmd+Shift+P` | Fuzzy finder over every action (including the ones below). |
| **Process Manager** | `Cmd+Alt+P` | Opens the live process overlay — every pid in every workspace with CPU / RSS / kill. |
| **Pane Info** | `Cmd+I` | Opens the detail view for the focused pane — identity, git, ports, process tree. |
| **Settings** | `Cmd+,` | Opens the full settings panel (general, appearance, theme, effects, network, advanced). |
| **Find in Terminal** | `Cmd+F` | Toggles the search bar for the focused pane's scrollback (or find-in-page for browser). |
| **Escape** | `Esc` | Closes any active overlay (settings, process manager, command palette). |
| **Copy / Paste** | `Cmd+C` / `Cmd+V` | Standard terminal copy/paste. |
| **Font Size** | `Cmd+=` / `Cmd+-` / `Cmd+0` | Increase, decrease, or reset font size. |

---

## 3. The Surface Bar & Context Menus

Every pane features a minimal "Surface Bar" at the top. From left to right:

1. **Pane title** — the user-renamed title or the shell name (e.g. `zsh`). This is *not* the foreground command; it's a stable label.
2. **Live metadata chips** (added in the metadata pipeline):
   - **Foreground command** (amber) — only shown when the foreground process differs from the shell. Full argv, truncated to ~48 chars, full text on hover. Updates within one poll tick (~1 s).
   - **CWD chip** (muted monospace) — last two path segments (`…/proj/src`). Full absolute path on hover.
   - **Port chips** (green) — one per unique listening port across the whole descendant process tree. **Click (or keyboard-activate) to open** `http://localhost:<port>` in the system browser. Tooltip shows `proto address:port (pid N)`.
3. **Action buttons** on the far right:
   - **`ⓘ` (Pane Info)** — opens the detail panel for this pane (`Cmd+I`).
   - **`│` (Split Right)**
   - **`─` (Split Down)**
   - **`×` (Close)**

Chips update automatically as the foreground process changes, you `cd` to a new directory, or a process binds/releases a TCP port. The metadata pipeline that drives them is documented in [system-process-metadata.md](system-process-metadata.md).

### Right-Click Context Menu
Right-click anywhere on the Surface Bar for a native context menu:
- **Rename** the pane (useful for keeping track of what is running where).
- Trigger Splits.
- Close the pane.

### Pane Drag & Drop
Click and drag on the Surface Bar (but not on the chips or buttons) to rearrange panes — drop zones highlight the destination. A small ghost of the bar follows the cursor; release over another pane to swap or split.

---

## 4. The Sidebar

The Sidebar is your ambient dashboard. It's hidden by default but can be toggled via `Cmd+B`. It's laid out top-to-bottom as: **Notifications → Workspaces → Logs → Web mirror footer**. Urgent signals sit above the workspace list so they're visible without scrolling.

### 1. Notifications (top of sidebar)
Emitted via `ht notify` (or the `notification.create` RPC). Each notification is an individually interactive row:

- **Click the body** — focuses the workspace and pane that emitted it. If the notification has no associated surface (external source), clicking is a no-op.
- **Hover-revealed `×`** — dismisses that single notification (routes through `dismissNotification` → `notification.dismiss` RPC). No need to clear the entire list.
- **Glow pulse** — a purple/cyan animation loops on each row until the user *clicks it*, *dismisses it*, or *focuses the source surface* by any other means (keyboard, palette, click on a pane). Same visual family as the surface-pane notify-glow.
- **Finish sound** — when a new notification arrives, `assets/audio/finish.mp3` plays in both the native webview (relative `audio/finish.mp3`) and the web mirror (served by the Bun HTTP server at `/audio/finish.mp3`). Autoplay failures (policy-blocked tabs) are swallowed — the sound is a cue, not a requirement. Playback fires on *create* only; dismiss/clear rebroadcasts stay silent.

The header shows `Notifications (N)` with a batch-clear button. The ring-buffer is capped at 500 entries process-wide (see `doc/system-rpc-socket.md`).

### 2. Workspace card
A colored accent dot, the workspace name, and a close button. No more index/pane-count badges — the card now leans on the header, status lines, and package card for density.

### 3. Focused foreground command
When the focused pane in that workspace is running something other than the shell, a monospace accent chip shows the full foreground argv (e.g. `bun run dev`, `vim src/foo.ts`). Falls back to the focused pane's title otherwise.

### 4. Surface labels
Below the meta row, when the workspace has more than one pane, its surfaces are listed as plain one-line labels (no bubble, just a `·` bullet). First four shown; overflow collapses to a `+N more` italic line.

### 5. Listening port chips
Aggregated across *every* pane in the workspace, deduped by port number. Clickable — opens `http://localhost:<port>` in the system browser.

### 6. Package.json card (collapsible dropdown)
Workspaces whose resolved cwd has a `package.json` get a card with the package name/version, and a toggle caret (`▸` / `▾`). Collapsed by default to keep the sidebar compact.

When expanded, the body shows the description, `bin` entries, and every script as a clickable "run" button with a live state dot (green = running in any pane, red = last run exited non-zero within ~10 s, grey = idle). Click to spawn the script in a new pane tagged with its script key. The card is omitted entirely when no `package.json` is resolved.

### 7. Status entries & progress (per-workspace)
Pushed via `ht set-status` / `ht set-progress`. Status entries render as two-line rows — **icon + uppercase key** on top for scanability, **value** below in monospace with strong contrast. Multiple statuses stack vertically.

Status is **routed to the emitting pane's workspace**: the `ht` CLI auto-forwards `HT_SURFACE`, and the Bun handler resolves that surface to its owning workspace. Scripts in any pane correctly write into their own card, not whatever workspace happens to be selected. Explicit `--workspace <id>` still wins; only when neither hint is available does the server fall back to the active workspace.

### 8. Logs
A feed of structured logs pushed via `ht log`. Levels `info`, `progress`, `success`, `warning`, `error`. Auto-scrolls unless the user has scrolled up to read history.

### 9. Web mirror footer
Always pinned at the bottom: dot indicator (green = online, dim = offline) and the `:port` when a web mirror is running.

The sidebar only re-renders when the visible projection changes (port set or focused-surface foreground pid) — cwd churn or tree reshuffles don't trigger a redraw, so it stays calm even when something's busy.

---

## 5. The Pane Info panel (`Cmd+I`)

Clicking the `ⓘ` button on any surface bar (or pressing `Cmd+I` on the focused pane, or picking **Show Pane Info** from the command palette) opens a centered overlay with everything we know about that single surface. The content is split into four sections that live-update as the metadata poller emits:

1. **Identity** — shell PID, foreground PID, foreground command (full argv), cwd (with a one-click **copy** button), surface ID, and how long ago the snapshot was polled.
2. **Git** — only rendered when cwd is inside a git repo. Shows branch + HEAD SHA, upstream with ahead/behind counts, file counts (staged / unstaged / untracked / conflicts), and line counts from `git diff HEAD --shortstat`. Branch name is emphasized with the accent color.
3. **Listening ports** — table of every TCP listener in the process tree with proto/address/pid/command columns. Each row has an **open** button (opens `http://localhost:<port>` in the default browser) and a **kill** button (SIGTERM, Shift-click for SIGKILL).
4. **Process tree** — full descendant table (PID / PPID / command / CPU % / Memory). Foreground row highlighted in accent. CPU% cell tints toward red as load increases. Kill button per row.

`Escape` closes the panel. If the surface closes while the panel is open, the body switches to "This pane no longer exists." without destroying the overlay — closing manually via the `×` button or `Escape` is always available.

---

## 6. The Process Manager (`Cmd+Alt+P`)

A full-screen overlay that tabulates every process in every workspace. Opens via `Cmd+Alt+P`, **View → Process Manager…**, or the command palette.

### Summary line
`N processes · X.X% CPU · Y.Y M RSS` across the entire app — a quick sense of load.

### Workspace cards
Each workspace gets its own accent-bordered card (active workspace highlighted in amber), with a header showing the color dot, workspace name, and process count. Inside:

### Surface rows
Each pane inside the workspace is a collapsible section with a header showing the pane title, the surface's cwd, and port chips. Click the header (or press Enter when focused) to collapse/expand.

### Process table
Each surface's process tree is rendered as a table:

| Column | Contents |
|--------|----------|
| PID | the pid; foreground row is highlighted in accent |
| Command | full argv from `ps -o args`, truncated with tooltip for the rest |
| CPU % | instantaneous %, cell color heats toward red as the number grows (via CSS `color-mix` + `--heat` variable) |
| Memory | RSS formatted as K / M / G |
| — | **kill** button; SIGTERM by default, **Shift+click** for SIGKILL |

The panel refreshes in place on every metadata change (push-based; no webview-side polling). `Escape` closes it.

---

## 7. Browser Panes

Browser panes are first-class surfaces that share the same layout, workspace, and navigation system as terminal panes. They render via Electrobun's `<electrobun-webview>` custom element (OOPIF — Out-Of-Process IFrame), which runs in a fully isolated browser process.

### Address bar
Each browser pane has a compact address bar with back/forward/reload buttons, a lock icon (🔒 for HTTPS, ⚠ for HTTP), a URL input field, and a DevTools button. The URL input auto-detects whether input is a URL or a search query.

### Browser-specific shortcuts
When a browser pane is focused, keyboard shortcuts switch from terminal mode to browser mode:

| Shortcut | Action |
|----------|--------|
| `Cmd+L` | Focus address bar |
| `Cmd+[` / `Cmd+]` | Back / Forward |
| `Cmd+R` | Reload |
| `Alt+Cmd+I` | Toggle DevTools |
| `Cmd+F` | Find in page |
| `Cmd+=` / `Cmd+-` / `Cmd+0` | Zoom in / out / reset |

Global shortcuts (sidebar, palette, workspace nav) work regardless of surface type.

### Overlay z-ordering
Because `<electrobun-webview>` renders as a native layer above the parent webview, browser panes are hidden via `toggleHidden()` when overlays (command palette, settings, process manager, dialogs) open, and restored when they close.

### Cookie management
Browser panes support importing cookies from JSON (EditThisCookie) or Netscape/cURL files via **Settings → Browser → Cookies** or the CLI (`ht browser-cookie-import`). Imported cookies are auto-injected into matching domains on each navigation. See [`system-browser-pane.md`](system-browser-pane.md) § 10 for details.

### Automation
See [`system-browser-pane.md`](system-browser-pane.md) for the full browser automation API — 50+ commands for navigation, DOM interaction, waiting, inspection, script injection, cookie management, and console/error capture.

## 8. UI Architecture & Performance Notes

### `xterm.js` Integration
HyperTerm Canvas uses `xterm.js` for the text grid. It is configured with:
- **WebLinksAddon:** URLs in the terminal become clickable.
- **FitAddon:** When you resize a pane, `FitAddon` recalculates the rows/columns to perfectly fill the new DOM dimensions and signals the PTY backend to adjust.
- **Scrollback:** The UI maintains up to **10,000 lines** of scrollback history per pane.

### Memory Considerations
When you switch to a different workspace, the panes of the previous workspace are **hidden** (`display: none`), not destroyed.
This means if you have 5 workspaces, each with 4 splits, you have **20 instances of `xterm.js`** running in the DOM simultaneously.

Browser panes run in isolated OOPIF processes. Each open browser pane consumes additional system memory (~50–100 MB per process). Close browser panes when no longer needed.

While `xterm.js` is highly optimized, keeping dozens of WebGL contexts alive in the background can consume significant GPU memory. It is recommended to close workspaces (`Cmd+W`) when you are done with them rather than letting them pile up indefinitely.

### Redraw Lag on Resize
When you drag a pane divider to resize two terminals, the DOM borders update fluidly at 60fps. However, the actual text grid (`xterm.js`) will only snap to the new dimensions once you **release the mouse button** (`mouseup`). This is an intentional design choice to prevent the CPU from thrashing while trying to reflow thousands of characters 60 times per second during a drag operation.
