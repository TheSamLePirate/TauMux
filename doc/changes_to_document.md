# Changes to document in website-doc

Pending updates to fold into `website-doc/` on the next user-driven docs sweep.

## 0.2.56 — PR #6 (D.1 pointer capture, D.2 FIFO)

- Web mirror panel drag/resize gestures migrated to Pointer Events with `setPointerCapture` so a fast off-screen flick can no longer leave a panel "stuck" mid-drag (the browser now guarantees an end event). User-visible only as a stability fix; no API change.
- Web mirror's pending-frame buffer for sideband panel data is now per-panel FIFO (cap 16). Multiple binary frames arriving before `ensurePanelDom` runs are now drained in order rather than collapsed to the last one.

## 0.2.55 — PR #5 (C.1, C.2 UX polish)

- Theme preset cards in Settings → Theme now move the active-card border on the same tick as the click (no need to close & reopen the panel).
- Command palette descriptions for Open Browser Split / New Browser Workspace / Split Agent Right / Split Agent Down now make the "creates a new pane" semantics explicit. Update website-doc command-palette page if it lists these.

## 0.2.53 — PR #3 (A.2 dev configDir)

- `bun start`, `bun run dev`, and `bun run build:dev` now set `HT_CONFIG_DIR=$HOME/Library/Application Support/hyperterm-canvas-dev`. The dev runtime no longer shares socket / settings / cookies / browser-history with an installed τ-mux on the same machine. Mention in the website-doc dev section if applicable.

## 0.2.52 — PR #2 (A.1 `ht browser help`)

- New `ht browser help` subcommand (also `ht browser --help` / `ht browser -h`) prints the same browser-section block as the global `ht --help`. The `Unknown browser subcommand: …` error path tells users to run this; it now actually works. Reflect in `website-doc/src/content/docs/cli/` browser pages.

## 0.2.51 — PR #1 (Cluster A nits + RPC-only doc)

- **N16 — `ht send` escape sequences.** `bin/ht --help` now documents that `\n` and `\r` both send carriage return, plus `\t`, `\x1b`, `\\`. Mirror the same one-liner under the I/O section in `website-doc/src/content/docs/cli/io.md` (or wherever the `send` command is documented).
- **M4 — RPC-only methods (no CLI verb).** `doc/system-rpc-socket.md` now has a new "RPC-only methods (no CLI verb)" subsection listing `surface.kill_pid`, `surface.rename`, `notification.dismiss`, `browser.stop_find` with rationales. Mirror this table into `website-doc/src/content/docs/api/system.md`.
- **N12 — readScreen vs webviewResponse.** Added a "Read-style replies" subsection to `doc/system-rpc-socket.md`. If the website has an internals/architecture page covering bun↔webview RPC, add a short pointer there.
