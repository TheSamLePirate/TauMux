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

The Sidebar is your ambient dashboard. It's hidden by default but can be toggled via `Cmd+B`. Every workspace becomes a card:

### 1. Workspace card header
A colored dot (workspace accent), the name, an index badge (`01`, `02`, …) that matches the `Cmd+N` jump shortcut, a pane-count badge if there's more than one pane, and a close button.

### 2. Focused foreground command
When the focused pane in that workspace is running something other than the shell, a monospace accent chip shows the full foreground argv (e.g. `bun run dev`, `vim src/foo.ts`). Falls back to the focused pane's title otherwise.

### 3. Listening port chips
Aggregated across *every* pane in the workspace, deduped by port number. Clickable just like the pane-header chips — opens the URL in the system browser. This is the fastest way to see "what's listening where" across many workspaces at a glance.

### 4. Status & Progress (Per-Workspace)
If a script in the active workspace has used the RPC API to push metadata (via `ht set-status` or `ht set-progress`), it appears here.
- **Status Pills** are great for showing build states (e.g., `Build: Passing`).
- **Progress Bars** show fractional completion (0.0 to 1.0) for long-running scripts.

### 5. Logs
A continuous feed of structural logs pushed via the RPC API (`ht log`). Logs are color-coded by severity (`info`, `error`, `success`, `warning`).

### 6. Notifications & Web Mirror status
At the bottom of the sidebar: the latest notification ring-buffer (from `ht notify`) and a live indicator for the web mirror showing its URL when running.

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
