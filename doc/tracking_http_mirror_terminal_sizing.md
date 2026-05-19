# Tracking — HTTP web mirror terminal sizing

Plan file: `/Users/olivierveinand/.claude/plans/look-at-the-http-fuzzy-tide.md`.

## Symptoms reported by user (2026-05-19)

1. After `clear` in the web mirror, the first row shows a stray `%`.
2. The web terminal renders one column narrower than it should — long output wraps with a stray newline glyph.
3. The web terminal only refits when switching workspaces; resizing the browser window does not adjust the layout.

## Root causes (verified)

- **Padding mismatch (1 col off + `%`)** — `src/web-client/client.css:343` had `.pane .xterm { padding: 6px 8px 8px; }` while native (`src/views/terminal/index.css:2484`) has none. Shared fit math in `src/shared/xterm-fit.ts:99` and `src/views/terminal/surface-manager.ts:2710` subtracts xterm padding, so the web side fit to ~N−2 cols while the PTY (sized by native via `src/bun/webview-handlers/viewport.ts:50`) was at N. zsh's PROMPT_SP cookie + wrap glitch followed.
- **Web-client resize proposals silently dropped** — `src/bun/web/server.ts:1204-1231` parses `surfaceResizeRequest` and calls `this.onSurfaceResizeRequest?.(...)`, but the callback was never assigned in `setupWebServerCallbacks` (`src/bun/index.ts`).
- **Per-pane RO doesn't fire on browser-window resize in nativeViewport mode** — `src/web-client/layout.ts:140-153` scales the container via CSS transform; pane CSS box dimensions are unchanged so the per-pane `ResizeObserver` in `src/web-client/main.ts:601-635` doesn't fire. Workspace switches recreate panes, which is the only path that triggers a refit + proposal.

## Changes landed

- `src/web-client/client.css` — remove `padding: 6px 8px 8px;` from `.pane .xterm` (left a comment explaining why).
- `src/bun/index.ts` — wire `ws.onSurfaceResizeRequest = (surfaceId, cols, rows) => { sessions.resize(...); ws.sendResize(...); }` in `setupWebServerCallbacks`.
- `src/web-client/main.ts` — extract `proposeIfChanged` + `scheduleProposal` from the per-pane ResizeObserver callback; expose `proposeResize` on the `TermRef`; on `window.resize` (after `applyLayout` + `scaleTerminals`) iterate `terms` and call `fitTerminal(term, termEl)` + `proposeResize()` for every term pane.
- `src/shared/xterm-fit.ts`, `src/views/terminal/surface-manager.ts` — add `+ 0.5` pixel epsilon to the `cols/rows = Math.floor((w − padX) / cell.width)` math.
- `doc/changes_to_document.md` — pending entry added for the next website-doc sweep.

## Verification

- `bun run typecheck` — TBD
- `bun test` — TBD
- Manual UX checks (per plan): `clear` should leave row 1 blank; `printf '%*s\n' "$COLUMNS" '' | tr ' ' '='` should fill the visible width without wrap; browser-window resize should update `echo $COLUMNS`.

## Commits

- TBD (will be filled in after the user requests a commit).

## Notes / deviations

- Did not relocate any padding to `.pane-term`. Plan listed it as optional; tested no-padding looked correct against native parity.
- Native fit math change is kept in lockstep with the web fit (`+ 0.5` epsilon) so the two paths cannot drift on sub-pixel measurements.
