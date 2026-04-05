# Webview UI System

This system handles the frontend rendering inside the Electrobun Webview. It is responsible for orchestrating the terminal emulators (xterm.js), the workspace/pane layout, and the sidebar UI.

## Core Components

- **`SurfaceManager`** (`src/views/terminal/surface-manager.ts`): The central state holder for the Webview. It maintains:
  - **Workspaces:** Collections of logically grouped terminal panes (surfaces).
  - **Surfaces (`SurfaceView`):** Contains the actual `xterm.js` instance, the DOM containers, and a dedicated `PanelManager` for sideband elements.
  - **Sidebar:** For displaying the workspaces list, statuses, logs, and progress.
- **`PaneLayout`** (`src/views/terminal/pane-layout.ts`): Implements a binary tree to compute geometric bounds (`x`, `y`, `width`, `height`) for split terminal panes. Supports nested horizontal and vertical splits, similar to `tmux`.
- **`xterm.js`**: Renders the text grid. Customizations include Catppuccin Mocha theme, JetBrains Mono font, and WebLinksAddon.

## Flow

1. The Bun main process sends a signal via Electrobun RPC (e.g., `addSurfaceAsSplit`).
2. `SurfaceManager` instantiates a new `SurfaceView`, adding a new DOM container (`<div class="surface-container">`) and initializing a new `Terminal` via xterm.js.
3. `PaneLayout` recalculates the binary tree bounds, dividing available space based on the split direction.
4. `SurfaceManager` updates the CSS properties (`left`, `top`, `width`, `height`) of all surfaces in the active workspace.
5. The `FitAddon` is invoked on each xterm instance, and a resize event is propagated back to Bun to update the PTY dimensions.
6. DOM Event Listeners handle user interaction (e.g., clicking pane dividers to resize them, or right-clicking surface bars for context menus).

## Critiques & Limitations

- **DOM Bloat on Hidden Workspaces:** In `switchToWorkspace`, inactive workspaces are simply hidden via `view.container.style.display = "none"`. While this is standard, having dozens of xterm.js instances lingering in the DOM (with active `xterm.js` WebGL or Canvas renderers) can consume massive amounts of GPU memory. A mechanism to pause rendering or offload hidden instances could improve performance.
- **Simplistic Directional Focus:** `focusDirection("left" | "right" | "up" | "down")` relies on `PaneLayout` logic that might not perfectly align with visual layout in deeply nested, asymmetrical splits.
- **Divider Rendering Lag:** Resizing panes by dragging a divider triggers `applyPositions` on `mousemove`, which updates DOM styles, but `applyLayout` (which calls `term.fit()`) is only called on `mouseup`. This creates a visual disconnect where the terminal character grid jumps to its new size only after the drag ends, rather than resizing fluidly.