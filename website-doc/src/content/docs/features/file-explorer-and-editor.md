---
title: File explorer + editor
description: Native sidebar CWD file explorer and CodeMirror editor pane.
sidebar:
  order: 11
---

τ-mux ships a native file explorer in the sidebar and a CodeMirror 6 editor pane. Together they let you browse the workspace's CWD, open files into a split, edit them, and save — without leaving the terminal. Both are **native-only** today; the web mirror's HTTP/WS protocol is not yet wired for them.

## Sidebar CWD file explorer

Every workspace card carries a CWD row at the top, even single-CWD workspaces and metadata-unavailable states. Below the CWD row sits a collapsible file explorer rooted at the selected workspace CWD.

### Behaviour

- **Lazy listing.** Directories are read on expand, not at app launch.
- **Default-ignored folders.** `.git`, `node_modules`, `.next`, `.nuxt`, `.svelte-kit`, `dist`, `build`, `coverage`, `.turbo`, `.cache` are filtered by default (count surfaced as `ignored`).
- **Dotfiles** are hidden by default; toggle in Settings → General → Show dotfiles.
- **Max entries** per directory is capped (default 250, configurable in Settings). When the cap is hit the listing reports `truncated: true` so the UI can show a "+N more" affordance.
- **Sort order.** Directories → symlinks → files, then natural alphanumeric.
- **Refresh** rebuilds the listing for the focused directory.
- **Accessible semantics.** The tree uses `role="tree"` / `role="treeitem"`, supports keyboard nav, has strong focus rings.

### Symlink-cycle protection (0.3.148)

Every `kind: "symlink"` entry now carries two extra fields:

- **`linkTarget: string | null`** — the resolved realpath of the link, or `null` for dangling links.
- **`cycle: true`** — set when the realpath equals the listed directory itself or any of its ancestors.

The webview can refuse navigation into a `cycle: true` entry with a clear "this would loop" affordance, instead of letting the user walk into the loop. The detection helper `isAncestorOrSelf(candidate, root)` correctly anchors on the path separator so `/foo` is NOT treated as an ancestor of `/foobar`.

### New File action

The explorer's header has a **New File** button that opens a create-enabled CodeMirror editor split. Save (`⌘S`) writes the file at the typed path; cancel (`Escape`) closes the empty split without leaving a stray file.

### Source

- `src/bun/sidebar-file-explorer.ts` — pure `listSidebarFileExplorerDirectory(request)` function.
- `src/shared/types.ts` — `SidebarFileExplorerEntry` and `SidebarFileExplorerListing` types.

## CodeMirror editor pane

The editor surface (`editor:*`) is a native webview-only pane backed by CodeMirror 6.

### Opening files

- **From the sidebar.** Click any file in the explorer to open it in a new split (or focus the existing editor pane if it's already open).
- **From the CLI.** `ht edit /path/to/file.ts` or `ht editor open /path/to/file.ts` — both open the file in a split pane in the focused workspace.
- **New file.** The explorer's New File button (or `ht editor new`) opens an empty editor with a path prompt.

### Editing

- **Save** with `⌘S` (writes atomically; see "Conflict detection" below).
- **Reload** discards local edits and re-reads from disk.
- **Close** the pane without saving — unsaved changes are lost (no prompt in v1; tracked as a polish gap).
- **Layout persistence.** Editor panes survive a τ-mux restart — they're stored in `layout.json` with the file path and re-open on launch.

### Conflict detection

The editor RPC carries the file's `mtime` from open. On save, the bun side compares the on-disk `mtime` to the one the editor knew about. If they differ (something else wrote the file in the meantime), the save returns a `conflict` error instead of silently overwriting. The editor surface presents a "force save" affordance to override.

### Binary / large-file guardrails

The bun-side `editor.read` RPC refuses to load files that:

- Contain a null byte in the first 8 KiB (heuristic for binary).
- Exceed a configurable size cap (default 5 MiB).

Both refusals come back as a structured error so the editor pane can render an explanatory placeholder.

### Where the editor doesn't go (yet)

- **Web mirror.** The editor pane is native-only. The HTTP/WS protocol doesn't carry editor content yet.
- **Multi-cursor / find-and-replace.** Standard CodeMirror functionality is enabled but UI affordances beyond the editor's built-in keymaps are minimal.
- **Language servers / completions.** No LSP integration. CodeMirror's built-in syntax highlighting is on; everything else is by-keyboard.

### Source

- `src/bun/webview-handlers/editor.ts` — the bun-side RPC handlers.
- `src/views/terminal/editor-pane.ts` — the webview editor surface.
- `src/bun/rpc-handlers/editor.ts` — socket-side editor RPC (used by `ht edit`).

## Read more

- [`ht edit` / `ht editor`](/cli/surfaces-and-io/) — CLI commands to open files.
- [Settings](/configuration/settings/) — file-explorer toggles (dotfiles, max-entries, default-collapsed).
