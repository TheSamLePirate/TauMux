# Changes to document in website-doc

Pending updates to fold into `website-doc/` on the next user-driven docs sweep.

## 0.2.60 — PR #9 (D.3 SW update flow with banner)

- Web mirror: when a new bundle is deployed and a previous SW still controls the page, the SW now stays in `waiting` state and the page renders a banner ("A new version is available." / Reload / Later). Clicking Reload posts `{type:"SKIP_WAITING"}`; the new SW activates; `controllerchange` fires and the page reloads onto the new bundle. Clicking Later dismisses the banner without affecting the running session. Old caches are deleted in the new SW's `activate` handler — i.e. only after the user has accepted the update — so a mid-session tab on the old version no longer white-screens on a fresh asset request. First-install path (no previous SW) is unchanged: the SW skips waiting automatically. Reflect in any website-doc PWA / "installation" section.

## 0.2.59 — PR #10 (D.4 auth token scrub)

- Web mirror: the `?t=…` auth token in the page URL is captured at module load and removed from `window.location` via `history.replaceState` after the first successful WebSocket open. Reconnects keep authenticating (the token survives in module scope). On 401 / connection failure the URL is intentionally left intact so the failure is debuggable. No public API change; security hardening only.

## 0.2.58 — PR #8 (E.1 surface RPC startup-race)

- New `surface.wait_ready` RPC + `ht wait-ready [--surface S] [--timeout-ms N]` CLI command. Returns the surface metadata snapshot once it lands, or null on timeout (default 2 s). Use to synchronize automation that races the post-spawn metadata poll.
- `surface.kill_port` and `surface.open_port` no longer throw "no metadata yet — try again in a second" on first-tick race. They poll the cache for up to 2 s before failing with `surface metadata unavailable after 2000ms — pane may have crashed`. Naive scripts no longer need a retry loop. Add the new method + CLI verb to website-doc API + CLI references.

## 0.2.57 — PR #7 (C.3, C.4 mirror polish)

- Web mirror: the agent-plans widget no longer stays hidden forever on a fresh connection. After the first `plansSnapshot` arrives (even an empty one) it now shows a "No active agent plans" placeholder, so users discover it exists before any agent posts a plan.
- Settings → Effects: a "Restore previous bloom (X.XX)" button appears when the user was migrated from the legacy bloom slider AND has not yet picked a non-zero intensity. One click sets `bloomIntensity` to the snapshotted `legacyBloomIntensity`. Reflect in the Effects section of the website-doc settings page.

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
