# Pi Agent Pane

This document describes the in-app Pi agent pane inside τ-mux.

## Goals

The Pi agent pane is a first-class surface type alongside terminal and browser panes. It is designed for the τ-mux use case:

- keep agent work visible in the pane layout
- expose Pi RPC functionality without dropping to an external terminal
- preserve terminal-first behavior elsewhere in the app
- support long-running coding workflows with session/history awareness
- surface model, session, tool, and queue state in a compact UI

The pane is an overlay-style workspace surface. It does **not** replace the PTY model used by terminal panes.

## Architecture

### Bun side

Relevant files:

- `src/bun/pi-agent-manager.ts`
- `src/bun/index.ts`

The main process launches `pi --mode rpc --no-session` and forwards JSON-RPC commands/events between the webview and Pi.

The main process now also provides two app-side helpers for the pane UI:

- **session listing** via `agentListSessions`
- **session tree parsing** via `agentGetSessionTree`

These helpers are implemented in `src/bun/index.ts` by reading Pi session files from:

- `~/.pi/agent/sessions`

This lets the webview show richer resume/tree UIs even though Pi RPC itself does not expose a full interactive `/resume` or `/tree` TUI.

### Webview side

Relevant files:

- `src/views/terminal/agent-panel.ts`
- `src/views/terminal/surface-manager.ts`
- `src/views/terminal/index.ts`
- `src/views/terminal/index.css`

`agent-panel.ts` owns the pane UI and presentation logic.

`surface-manager.ts` creates agent surfaces and wires panel callbacks.

`index.ts` bridges custom DOM events to Electrobun RPC messages.

## Core Features

### 1. Session browser UI

`/resume` without arguments opens a recent-session browser instead of asking for a raw path.

The browser shows:

- session name when available
- cwd
- first user prompt preview
- last modified time
- full file path

Manual path entry remains available through the dialog.

### 2. Session tree browser

`/tree` opens a tree/history browser built from Pi JSONL session files.

The browser shows:

- entry depth
- entry role
- active leaf marker
- timestamp
- child count

Current behavior:

- selecting a **user** node triggers Pi `fork` from that entry
- non-user nodes are displayed but not yet switched-to in-place through RPC

This is intentionally conservative because Pi RPC exposes `fork`, while the full interactive tree leaf-navigation flow is TUI-specific.

### 3. Image prompts

The pane supports image attachments for:

- prompt
- steer
- follow-up

Images can be attached by:

- paste
- drag and drop

The UI renders:

- attachment chips before send
- image thumbnails in historical messages when present in Pi session content

Images are sent using Pi RPC `images` payloads in the format documented by Pi RPC.

### 4. Rich model UX

The model UI now surfaces capability metadata from Pi model objects:

- provider
- reasoning support
- vision/image support
- context window
- max output tokens
- pricing badges when available

### 5. Scoped model cycling

The pane adds a local scoped-model UX for `Ctrl+P` / `Shift+Ctrl+P` cycling.

Users can include/exclude models from local cycling in the model picker. If a scoped set exists, cycling stays within that set before falling back to Pi's default cycle behavior.

This scope currently lives in pane memory only.

### 6. Tool affordances

Historical and live tool cards now expose lightweight actions such as:

- rerun bash command
- copy command
- copy path
- copy output

The implementation stays within the project's UI guidelines:

- no keyboard focus is stolen away from the pane input workflow
- actions are small mouse affordances layered on top of the visible transcript

### 7. Extension UI improvements

The pane supports more of Pi RPC extension UI behavior:

- `setWidget`
- `set_editor_text`
- dialog methods
- notifications/status chips

## RPC Additions

Added webview RPC message types in `src/shared/types.ts`:

- `agentGetMessages`
- `agentListSessions`
- `agentGetSessionTree`
- image-aware payloads for:
  - `agentPrompt`
  - `agentSteer`
  - `agentFollowUp`

## Styling Notes

The refreshed styling keeps the existing τ-mux visual direction:

- dark, low-noise surfaces
- small, dense controls
- badge-driven metadata display
- no framework dependency
- no React

New styling areas include:

- model metadata badge rail
- attachment tray and thumbnails
- scoped model controls
- tool action pills
- session browser/tree dialog affordances
- richer drop-state visuals

## Limitations

Current known limitations:

1. **Tree navigation is fork-oriented**
   - the custom tree browser displays the session tree well
   - in-place tree leaf switching is not fully mirrored from Pi TUI
   - user-node branching is implemented through `fork`

2. **Scoped model selection is local-only**
   - it is not yet persisted in app settings

3. **Session discovery is filesystem-based**
   - recent sessions are inferred from `~/.pi/agent/sessions`
   - behavior depends on Pi's session storage layout

4. **Existing dev runtime bridge noise remains**
   - app launch succeeds
   - unrelated `internalBridgeHandler` JSON parse warnings/errors may still appear in dev output

## Validation

The feature set was validated with:

- `bun run typecheck`
- `bun test`
- `bun start`

At the time of implementation, typecheck and tests passed, and the app launched successfully.
