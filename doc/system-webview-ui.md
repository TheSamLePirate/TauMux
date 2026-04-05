# HyperTerm Canvas: Webview & UI System Guide

The frontend of HyperTerm Canvas runs inside an [Electrobun](https://electrobun.dev) Webview. This environment is responsible for taking the raw data provided by the Bun backend and turning it into a beautiful, interactive, Catppuccin-themed user interface.

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
- A Surface is a single terminal instance (running `xterm.js`) combined with its floating Canvas Panels.
- Surfaces are organized using a **Binary Tree** (`PaneLayout`).
- When you split a surface horizontally or vertically, the available space is mathematically halved.
- You can resize panes by clicking and dragging the dividers (the gaps between terminals) with your mouse.

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
| **Focus Direction** | `Cmd+Alt+Arrow` | Moves keyboard focus to the adjacent pane in the direction of the arrow. |
| **Next Workspace** | `Ctrl+Cmd+]` | Jumps to the next workspace in the list. |
| **Prev Workspace** | `Ctrl+Cmd+[` | Jumps to the previous workspace in the list. |
| **Jump to Workspace** | `Cmd+1` to `Cmd+9`| Jumps directly to Workspace 1 through 9. |
| **Toggle Sidebar** | `Cmd+B` | Shows or hides the left Sidebar. |
| **Command Palette** | `Cmd+Shift+P` | Opens the fuzzy-finder to search commands (Coming Soon). |
| **Copy / Paste** | `Cmd+C` / `Cmd+V` | Standard terminal copy/paste. |

---

## 3. The Surface Bar & Context Menus

Every pane features a minimal "Surface Bar" at the top. This bar displays the current process name or title (e.g., `zsh` or `npm`).

### UI Actions
On the far right of the Surface Bar, there are three tiny buttons:
- **`│` (Split Right)**
- **`─` (Split Down)**
- **`×` (Close)**

### Right-Click Context Menu
If you **Right-Click** anywhere on the Surface Bar, a native Context Menu will appear allowing you to:
- **Rename** the pane (useful for keeping track of what is running where).
- Trigger Splits.
- Close the pane.

---

## 4. The Sidebar

The Sidebar is your ambient dashboard. It's hidden by default but can be toggled via `Cmd+B`. It is broken down into three main sections:

### 1. Workspace List
A list of all active workspaces. The currently active workspace is highlighted with its accent color. You can click on any workspace to switch to it.

### 2. Status & Progress (Per-Workspace)
If a script in the active workspace has used the RPC API to push metadata (via `ht set-status` or `ht set-progress`), it appears here. 
- **Status Pills** are great for showing build states (e.g., `Build: Passing`).
- **Progress Bars** show fractional completion (0.0 to 1.0) for long-running scripts.

### 3. Logs
A continuous feed of structural logs pushed via the RPC API (`ht log`). Logs are color-coded by severity (`info`, `error`, `success`, `warning`).

---

## 5. UI Architecture & Performance Notes

### `xterm.js` Integration
HyperTerm Canvas uses `xterm.js` for the text grid. It is configured with:
- **WebLinksAddon:** URLs in the terminal become clickable.
- **FitAddon:** When you resize a pane, `FitAddon` recalculates the rows/columns to perfectly fill the new DOM dimensions and signals the PTY backend to adjust.
- **Scrollback:** The UI maintains up to **10,000 lines** of scrollback history per pane.

### Memory Considerations
When you switch to a different workspace, the panes of the previous workspace are **hidden** (`display: none`), not destroyed.
This means if you have 5 workspaces, each with 4 splits, you have **20 instances of `xterm.js`** running in the DOM simultaneously.

While `xterm.js` is highly optimized, keeping dozens of WebGL contexts alive in the background can consume significant GPU memory. It is recommended to close workspaces (`Cmd+W`) when you are done with them rather than letting them pile up indefinitely.

### Redraw Lag on Resize
When you drag a pane divider to resize two terminals, the DOM borders update fluidly at 60fps. However, the actual text grid (`xterm.js`) will only snap to the new dimensions once you **release the mouse button** (`mouseup`). This is an intentional design choice to prevent the CPU from thrashing while trying to reflow thousands of characters 60 times per second during a drag operation.