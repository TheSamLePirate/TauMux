# τ-mux shareBin System & AI Agent Guide

The `shareBin` system provides a frictionless way to add native-feeling sideband commands (like `show_md`, `show_img`, `show_gitdiff`) to the τ-mux terminal environment. 

**For AI Agents (like Claude, ChatGPT, etc.):** Use this guide when the user asks you to create a new graphical sideband command for the terminal.

## Architecture & Concept

Instead of requiring users to manually configure aliases or install dependencies to use sideband features, τ-mux maintains a dedicated directory called `shareBin` at the root of the project. Any executable script placed in this directory automatically becomes a first-class command available in every terminal pane, because τ-mux dynamically prepends the absolute path of `shareBin` to the `$PATH` of every newly spawned terminal session.

---

## How to Create a New Command (Agent Instructions)

When asked to create a new sideband widget or visualization command, follow these strict rules:

### 1. Use TypeScript (Recommended)
We strongly prefer using **TypeScript** run via `bun`. 
Python is supported (via `python3`) but only if specifically requested or required for a specific ML/Data library.

### 2. File Naming & Permissions
- Create the file directly in the `shareBin/` directory.
- **DO NOT** use a file extension. If the command is called `show_widget`, the file path must be exactly `shareBin/show_widget`.
- You **MUST** give the file execution permissions by running: `chmod +x shareBin/show_widget`

### 3. File Boilerplate (TypeScript)
Your script must use the `bun` shebang and import the `ht` client relatively from the same folder.

```typescript
#!/usr/bin/env bun
/**
 * τ-mux — Your Widget Name
 * 
 * Usage:
 *   show_widget <args>
 */

import { ht } from "./hyperterm";

if (!ht.available) {
  console.error("Not running inside τ-mux.");
  process.exit(1);
}

// 1. Generate your content (HTML, SVG, Canvas 2D data, etc.)
const htmlContent = `
  <div style="padding: 20px; background: #1e1e2e; color: #cdd6f4; border-radius: 8px;">
    <h2>Hello from shareBin!</h2>
  </div>
`;

// 2. Display the panel
// Use position: "float", "inline", "fixed", or "overlay" depending on the need.
const panelId = ht.showHtml(htmlContent, {
  position: "float",
  x: 100,
  y: 100,
  interactive: true // Set to true if you need to listen for clicks/mouse events
});

console.log(`Displayed widget (id=${panelId})`);

// 3. React to events (optional)
ht.onClose(panelId, () => {
  console.log("Widget closed by user.");
  process.exit(0);
});

// If the widget is meant to stay alive and update, do not call process.exit()
// unless a termination condition is met (like closing the panel or Ctrl+C).
```

### 4. Boilerplate (Python - Only if required)

```python
#!/usr/bin/env python3
"""Your Widget Name

Usage: show_widget <args>
"""

import sys
from hyperterm import ht

if not ht.available:
    print("Not running inside τ-mux.", file=sys.stderr)
    sys.exit(1)

html_content = "<div>Hello</div>"
panel_id = ht.show_html(html_content, position="inline")

print(f"Displayed widget (id={panel_id})")

# Wait for events if interactive...
```

### 5. Capabilities & References
When generating the internal logic, layout, or graphics for the sideband panel, refer to `doc/system-sideband-protocol.md` to understand:
- How to send `html`, `svg`, `image`, or `canvas2d` content.
- How to use `interactive: true` to receive events like `click`, `mousemove`, `dragend`, and `resize`.
- How to route content properly.

### 6. Do Not Modify Internal Core Code
You do **not** need to modify `bin/ht`, `src/bun/pty-manager.ts`, `rpc-handler`, or `electrobun.config.ts`. The `shareBin` folder is automatically included in the application bundle and appended to the terminal's `$PATH`. Just drop the script in, `chmod +x`, and it's ready to use.

---

## Bundled scripts

The repo ships a small starter set of scripts under `shareBin/` so a fresh checkout is usable out of the box:

| Script              | Purpose                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| `show_chart`        | CSV/TSV column → line / bar / scatter chart in a sideband panel.               |
| `show_diff` / `show_gitdiff` | Coloured diff overlay (file diff or `git diff` of the current repo).  |
| `show_gitlog`       | `git log` graph rendered as an HTML overlay.                                   |
| `show_html`         | Raw HTML body → sideband html panel.                                           |
| `show_img`          | Display an image (path / URL) in a floating panel.                             |
| `show_json`         | Stdin or `<path>` → pretty-printed JSON viewer.                                |
| `show_md`           | Markdown body → rendered overlay (subset: bold / italic / code / links).      |
| `show_qr`           | Encode a string as a QR code SVG.                                              |
| `show_sysmon`       | Live CPU / memory / process panel, refreshed via metadata RPC.                 |
| `show_table`        | CSV/TSV → sortable HTML table.                                                 |
| `show_webcam`       | AVFoundation webcam stream into a panel (macOS — needs entitlement).           |
| `show_yaml`         | YAML body → highlighted block.                                                 |
| `demo_status_keys`  | Exercise every renderer in the smart status-key DSL (Plan #02). See below.     |

### `demo_status_keys` — smart status-key live demo

`shareBin/demo_status_keys` calls `ht set-status` with realistic payloads for every renderer in the DSL (`numeric · time · state · chart · data · rich` — 38 total). Useful for:

- **Visual smoke-testing** the sidebar workspace card + bottom status bar after touching the renderer dispatcher.
- **Showing a new user** the full catalogue of expressive status entries available to any shareBin script.
- **Regression spotting** — `--live` keeps the line-graph / vbar / area renderers ticking with random samples every 1.5 s so you can watch them animate.

```bash
shareBin/demo_status_keys           # set 45 demo entries, exit
shareBin/demo_status_keys --live    # set, then re-tick chart entries until Ctrl-C
shareBin/demo_status_keys --clear   # remove all demo entries
```

Output starts with `[demo_status_keys] using <path-to-ht>` so a misrouted spawn is obvious. The script auto-locates `ht` across all three layouts:

1. **Packaged `.app`** — `<App>/Contents/MacOS/ht` (the Mach-O binary `scripts/post-build.ts` produces).
2. **Dev checkout** — `<repo>/bin/ht`.
3. **Installed shim** — fall back to `which ht`.

When `ht` returns a non-zero status, the first failure prints with full context (exit code + stderr body — most often `HyperTerm Canvas is not running. Socket not found: <path>`); subsequent failures collapse to one line each. The trailing summary tallies success/failure honestly (`Set 3/45 demo status keys`).

The full DSL reference, body grammars, and worked examples live in [`doc/system-rpc-socket.md` § "Smart status keys (suffix DSL)"](system-rpc-socket.md#smart-status-keys-suffix-dsl).