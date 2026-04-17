# HTTP Web UI Refactor — Analysis and Plan

Branch: `http-web-ui-refactor`
Target files: `src/bun/web-server.ts`, new module tree under `src/bun/web/` and `src/web-client/`.

The web mirror works end-to-end (HTTP + WS, history replay, panels, chips, sidebar) but is built as a single 1.5k-line Bun module whose last third is a self-contained HTML/CSS/JS blob. Terminal state is "mostly right" because xterm.js does the heavy lifting, but it drifts whenever clients reconnect, miss a frame, or race server-initiated events (workspace switches, resizes, panel moves). The visual language is also stuck on Catppuccin/neon and no longer matches the Graphite "macOS control room" direction set in `doc/system-webview-design-guidelines.md`.

This document is in two parts:

1. **Analysis** — what exists, where it hurts, and why.
2. **Plan** — the target architecture, migration steps, test plan, and acceptance criteria.

## Status (live)

| Milestone | Summary | Status |
| --- | --- | --- |
| M1 | Split server, extract client source, `bun build` pipeline | ✅ done |
| M2 | Protocol v2 envelopes, `hello` + full `snapshot`, state cache on server | ✅ done |
| M3 | Reducer-driven client store, inline SVG icons, reconciling views | ✅ done |
| M4 | Session ring buffer, resume on reconnect, TTL cleanup | ✅ done |
| M5 | `@xterm/headless` + SerializeAddon for terminal-state-correct history | ✅ done |
| M6 | Shared Graphite tokens, DM Sans chrome, calmer radii/borders | ✅ done |
| M7 | 16 ms stdout coalescing, metadata dedup, WS backpressure | ✅ done |
| M8 | `webMirrorBind` (loopback default), optional `webMirrorAuthToken` | ✅ done |
| M9 | Client resize proposals via ResizeObserver + FitAddon (opt-in) | ✅ done |
| M10 | Docs refresh | ✅ done |

Tests: 666 passing across 44 files (bun test) + 43 Playwright e2e (bun run test:e2e). Typecheck + lint clean.

**New files** (at M10 close). `src/bun/web/{asset-loader,connection,page,server,state-store}.ts`, `src/shared/web-protocol.ts`, `src/shared/web-theme-tokens.css`, `src/web-client/{main,store,icons}.ts`, `src/web-client/client.css`, `scripts/build-web-client.ts`, `tests/{web-protocol,web-resume,web-coalescer,web-auth,web-client-store,session-history}.test.ts`.

**Post-M10 extractions** (on `refactor-code-as-best-practice`). `src/web-client/main.ts` further shrank 1133 → 701 LOC by peeling off:
`src/web-client/{transport,protocol-dispatcher,panel-renderers,sidebar,layout,panel-interaction}.ts`, each paired with a focused test file. `SidebandMetaMessage` and `PanelEvent` became discriminated unions in `src/shared/types.ts`, narrowed at the wire boundary so flush ops can't leak into the render path. The Electrobun message handlers in `src/bun/index.ts` are now gated by `satisfies BunMessageHandlers` for compile-time coverage.

**Legacy.** `src/bun/web-server.ts` is now a 4-line re-export shim so existing imports keep working. The old 1.5k-line blob is gone.

---

## Part 1 — Analysis

### 1.1 Inventory

| File | Role | Size |
| --- | --- | --- |
| `src/bun/web-server.ts` | HTTP + WS server, asset inlining, HTML page, CSS, client JS | 1,548 LOC |
| `src/bun/session-manager.ts` | PTY + 64 KB output history per surface | 237 LOC |
| `src/bun/index.ts` (§ web) | Wires `WebServer` to sessions, RPC, settings | ~150 LOC relevant |
| `tests/web-server.test.ts` | WS welcome, history, stdin, broadcast | 222 LOC |
| `src/views/terminal/index.css` | Native-app Graphite tokens (reference for the new style) | 5,973 LOC |
| `src/shared/settings.ts` | `webMirrorPort`, `autoStartWebMirror`, theme presets | 523 LOC |

No client code lives outside `web-server.ts`. There is no build step, no typecheck, and no shared type with `src/shared/`.

### 1.2 Data flow (current)

```
PTY stdout ─► SessionManager.onStdout ─┬─► RPC ─► native webview
                                       └─► WebServer.broadcastStdout
                                              │
                                              ▼
                                    JSON.stringify per chunk
                                              │
                                              ▼
                                 for ws in clients: if subscribed, send
```

Metadata, sideband meta, panel events, workspace layout, notifications, and sidebar pills all reach the browser through `WebServer.broadcast({type, …})` with **no sequencing, no acks, no resync protocol**. Binary sideband data is sent as a length-prefixed binary frame (a good idea) but is emitted on the same WS as the JSON stream, so ordering between `sidebandMeta` (JSON) and its matching `sidebandData` (binary) is only best-effort.

### 1.3 State management — where it actually breaks

Concrete symptoms observed or reproducible from reading the protocol:

1. **Reconnect wipes the client.** `ws.onclose` blanks `panes`, `panels`, and DOM, then exponential-backoff reconnects. On reconnect the server replays every surface's 64 KB `history` in one shot. Multi-pane workspaces flash blank, scrollback past 64 KB is permanently lost to that client, and any in-flight panel state is dropped.
2. **No sequence numbers.** If the OS buffer flushes mid-`send`, or if `ws.send` throws for one client, subsequent chunks for that client are skipped but neighbours still advance. The client has no way to detect the gap → xterm renders a corrupted buffer that only a manual reload fixes.
3. **History is bounded at 64 KB of *raw bytes***, not rendered screen state. `tail -f` for a minute blows it out. There is no xterm serialize round-trip, so the rejoining client starts mid-escape-sequence and renders garbled colors until the next full redraw.
4. **`subscribeWorkspace` is client-local, but `focusSurface` is global.** A web client clicking a pane calls `onFocusSurface` which mutates host state and broadcasts `focusChanged` to *all* clients. Two users on the mirror fight each other.
5. **Panel state is last-writer-wins with no reconciliation.** Drag on web client A, drag on web client B simultaneously → server broadcasts both `panelEvent`s, clients apply them in arrival order, native app sees two `onPanelUpdate`s back to back. No epochs, no client IDs, no conflict hints.
6. **Resize is one-way.** The server sends `resize` when the PTY resizes. The browser never sends its container size, so the client's xterm is `FitAddon.fit()`ed to whatever the pane rect computed locally — if it does not match the PTY cols/rows, TUI apps (vim, btop) render misaligned. The server has no way to learn that a web client is smaller than the native window.
7. **Metadata is fire-and-forget at 1 Hz.** If a client misses the `surfaceMetadata` broadcast (reconnect, transient slow consumer), it shows stale chips until the next tick — or forever, because `welcome` does not include current metadata snapshots.
8. **Welcome is incomplete.** `welcome` carries surfaces and workspaces but *no metadata, no panels, no sidebar logs/notifs/status/progress*. A freshly-connected client sees no chips, no pills, no active progress bar until the next push. The state is there on the server (in `rpc-handler`), it is simply never serialised on connect.
9. **Workspace switching subscribes the WS but does not purge the DOM.** On `subscribeWorkspace`, server sends history for the new workspace's surfaces; client renders both old and new panes until a `layoutChanged` eventually arrives and reshapes `computeRects`. Visible flicker and zombie panes.
10. **No backpressure, no coalescing.** `broadcastStdout` does one `JSON.stringify` per chunk per surface per client. A fast producer (a build log) hot-loops `ws.send` on the event loop. There is no `ws.getBufferedAmount()` check and no coalescing window.
11. **Binary/JSON frame race.** `sidebandData` binary frame can arrive before the `sidebandMeta` JSON describing it if the parser emits them in quick succession (the two go through different code paths: direct `broadcast` vs `broadcastSidebandBinary`). Client drops the binary silently if the panel is not yet known.
12. **Global vars in the client.** Twelve top-level `var` maps (`panes`, `panels`, `surfaceMetadata`, `workspaces`, `sidebarNotifs`, …). No encapsulation, no way to unit-test any of it.
13. **Asset bundling is fragile.** `findProjectRoot()` walks up ten levels probing for `node_modules/xterm/lib/xterm.js`. Packaged builds rely on a `vendor/` dir populated by `electrobun.config`. Anything that changes the layout (symlinks, pnpm stores) silently falls back to `/* asset not found */`.
14. **No auth.** Server listens on `0.0.0.0`. Anyone on the LAN can type into the user's shell. The README flags this. For a pro-quality product this cannot stay the default.
15. **Zero error surfacing.** Client `try { JSON.parse } catch { return }` swallows protocol errors. Server `send` is wrapped in empty catches. When things go wrong you get silence, not a log.
16. **Tests are shallow.** `tests/web-server.test.ts` covers happy path (welcome, history, stdin echo). Nothing tests binary frames, reconnect, workspace switch, panel drag, metadata replay, or backpressure.

### 1.4 UI style — gap with the Graphite direction

The design doc mandates:

- UI font: DM Sans / system-ui; mono reserved for terminal and telemetry
- Palette: graphite base, yellow accent, neutral secondary
- Matte surfaces, restrained borders, no neon glows
- Shape system: 8/10/12/18 px radii
- Sentence-case labels

The web mirror currently ships:

- Mono (`JetBrains Mono Nerd Font`) for every UI chrome label — toolbar, sidebar, chips
- Catppuccin Mocha palette hard-coded in `APP_CSS` (`#1e1e2e`, `#89b4fa`, `#f38ba8`)
- Purple pulsing notification glow with backdrop blur (neon motif)
- Ad hoc radii (9, 8, 6 px mixed), emoji toolbar icons (`☰ ← ⛶`)
- `rgba(168,85,247,…)` borders that read as a different product from the native app

None of the theme presets defined in `src/shared/settings.ts` reach the browser. The web client has no idea the user is on Graphite.

### 1.5 Root causes

Three structural issues explain almost every symptom:

- **No client-owned state machine.** The browser is a thin glue layer that mutates the DOM from whatever message lands. There is no single reducer, no view-model, no notion of a canonical state snapshot to compare against on reconnect.
- **The server is stateless per-connection.** It knows "this ws is subscribed to these surfaces" and nothing else. There is no client session, no last-seen sequence, no replay cursor.
- **The HTML page is a string concatenation.** No modules, no types, no build — so nothing above can be added without making the file unmaintainable.

---

## Part 2 — Plan

### 2.1 Goals

Must-have:

1. Terminal state converges correctly after reconnect, workspace switch, and rapid output.
2. Visuals match `doc/system-webview-design-guidelines.md` (Graphite tokens shared with the native app).
3. Client code is modular TypeScript, typechecked with the rest of the project.
4. Protocol is versioned, sequenced, documented, and covered by tests.
5. Optional token auth gated by a setting.

Non-goals (explicitly out of scope for this refactor):

- Mobile-first responsive polish beyond what the tokens give us.
- Co-editing / multi-cursor semantics. Last-writer-wins is fine as long as every client converges within one tick.
- E2E browser automation tests. We rely on protocol-level integration tests against a headless WS client.

### 2.2 Target architecture

> **Note on current state.** The target-layout sketch below is the
> original plan. What actually landed is flatter: `src/web-client/`
> uses top-level files (`main.ts`, `store.ts`, `transport.ts`,
> `protocol-dispatcher.ts`, `sidebar.ts`, `layout.ts`,
> `panel-interaction.ts`, `panel-renderers.ts`, `icons.ts`,
> `client.css`) instead of the `store/` / `transport/` / `view/` /
> `theme/` subdirectories. `src/bun/web/` has `server.ts`,
> `connection.ts`, `asset-loader.ts`, `page.ts`, `state-store.ts`
> (broadcaster + snapshot logic live inside `connection.ts` and
> `server.ts`). Shared CSS is at `src/shared/web-theme-tokens.css`;
> the legacy `src/bun/web-server.ts` is a 4-line re-export shim.

```
src/bun/web/
  server.ts              — Bun.serve lifecycle, routing, auth
  asset-loader.ts        — vendor/node_modules resolution, typed results
  connection.ts          — per-client session: id, cursor, sequence, subscriptions
  broadcaster.ts         — coalesced stdout, backpressure-aware, ordered JSON + binary
  snapshot.ts            — builds a full "welcome-v2" payload from live state
  protocol.ts            — shared with client: message union, version, schemas
  page.ts                — emits index.html referencing /assets/client.js + /assets/client.css

src/web-client/          — compiled with bun build into dist/web-client
  main.ts                — entry
  store/                 — reducer + selectors (workspace, surfaces, panels, sidebar)
  transport/ws.ts        — reconnect, resync, sequence ack
  view/
    toolbar.ts
    sidebar.ts
    pane.ts
    panel.ts
    chips.ts
  theme/
    graphite.css         — imports tokens shared with native app
    components.css       — toolbar/sidebar/pane/sheet families

src/shared/
  web-protocol.ts        — NEW. Types for every WS message, version constant
  web-theme-tokens.css   — NEW. The CSS custom properties used by both native and web

tests/
  web-server.test.ts     — existing, extended
  web-protocol.test.ts   — NEW. Snapshot building, sequence/resync, coalescing
  web-client-store.test.ts — NEW. Reducer-level, run with bun test
```

The HTML page becomes ~30 lines: `<link>`, `<script type="module" src="/assets/client.js">`, a single `<div id="root">`. Everything else moves into typed modules.

### 2.3 Protocol v2 — versioned, sequenced, resumable

New message envelope (bidirectional):

```ts
interface Envelope<T> {
  v: 2;                 // protocol version
  seq: number;          // server-assigned monotonically increasing, per connection
  ack?: number;         // client → server: highest seq received
  type: T;
  payload: unknown;
}
```

New message types:

- `session/hello` — server → client on connect. Includes `sessionId`, `serverInstanceId`, `protocolVersion`, `capabilities`.
- `state/snapshot` — server → client. Full current state: workspaces (with layouts), surfaces (with cols/rows, *current metadata*, outputCursor), panels, sidebar (notifications, logs, status pills, progress), nativeViewport.
- `surface/history` — server → client. Per-surface scrollback reconstructed via xterm `SerializeAddon` on the server (run once per surface, cached) — delivers valid terminal state, not raw bytes mid-escape.
- `surface/output` — server → client. `{ surfaceId, seq, data }`. Coalesced to ~8 KB or 16 ms windows.
- `surface/output-gap` — server → client when it detects a client missed chunks. Triggers a `surface/history` refresh.
- `surface/resize-request` — client → server. Client reports its rendered cols/rows. Server replies with `surface/resize-granted` or keeps its own size authoritative.
- `panel/op` — unified panel mutation with `epoch` and `originClientId`. Last-writer-wins but clients can tell whether their own op was the one that landed.
- `metadata/patch` — server → client. Delta-encoded metadata (only changed fields per surface).
- `workspace/follow` — client → server. `{ workspaceId, follow: true }` — scoping focus tracking per client. The host's own focus is unchanged by web-client clicks unless `follow: false` (default for read-only mode).
- `input/stdin`, `sidebar/toggle`, `notifications/clear` — unchanged in intent, migrated to envelope.

Sequencing rules:

- Every server → client message has a `seq`.
- Clients send `ack` at least every 500 ms or every 64 messages.
- If the server notices `client.lastAckSeq` lagging by more than N seconds or bytes, it stops buffering and triggers a `state/snapshot` on next activity.
- Reconnect includes `resumeSessionId` + `lastSeenSeq` as a query string. If the server still has buffered output past that seq, it replays only the delta. Otherwise it sends a fresh `state/snapshot`.

### 2.4 Server changes

1. **`Connection`** class per WS — owns `sessionId`, `sequence`, `subscriptions`, `sendBuffer`, `bufferedBytes`. Replaces the ad hoc `ClientData`.
2. **`Broadcaster`** — batches stdout per (surfaceId, client) with a 16 ms flush window and an 8 KB cap. Skips clients whose `ws.getBufferedAmount()` exceeds a high-water mark and marks them as "stalled"; next send triggers a `state/snapshot`.
3. **`Snapshot.build()`** — pure function: `(sessions, rpcState, metadataStore, panels, sidebar, nativeViewport) → Snapshot`. Called on hello, on workspace change, on stall-recover.
4. **xterm SerializeAddon on the server** — we already run xterm for the native view. Run a headless `Terminal` per surface on the bun side, tee PTY output into it, and expose `serialize()` for history replay. This gives correct TUI state on reconnect instead of raw-byte replay. (Library: `@xterm/headless` + `@xterm/addon-serialize`. Both are small and already in the xterm monorepo we vendor.)
5. **Metadata cache** — store last snapshot of `SurfaceMetadata` per surface inside `WebServer` (it is already broadcast, just not retained). Include it in every `state/snapshot` and emit `metadata/patch` (diff) on updates.
6. **Auth** — optional token in `settings.webMirrorAuthToken`. When set, server requires `?t=<token>` on the WS upgrade and on `GET /`. When empty, open (back-compat default).
7. **Binding** — add `settings.webMirrorBind` (`0.0.0.0` | `127.0.0.1`, default `127.0.0.1`). The current LAN-by-default is a foot-gun.
8. **Logging** — route all `console.*` through a `log("web", level, msg, ctx)` helper that can be tail-filtered.

### 2.5 Client changes

1. **Store.** Single TS module with a reducer over `AppState = { workspaces, surfaces, focusedSurfaceId, activeWorkspaceId, panels, sidebar, nativeViewport, connection }`. All view modules subscribe via a minimal `store.subscribe(selector, cb)` (no framework). Applying a message = `reducer(state, msg)`; re-render is diff-driven (no full re-render on every tick).
2. **Transport.** Wraps `WebSocket` with:
   - exponential-backoff reconnect with `resumeSessionId` + `lastSeenSeq`
   - ack timer
   - parser that routes envelopes to the store, binary frames to `panels.ingestBinary`
   - offline banner via `connection` slice
3. **Views.** One module per surface type: `Toolbar`, `Sidebar`, `PaneGrid`, `Pane`, `Chips`, `PanelLayer`. Each subscribes to a slice and emits intents. No direct DOM access from store logic.
4. **Resize feedback.** Pane observes its own rect with `ResizeObserver`, runs `FitAddon.proposeDimensions`, and emits `surface/resize-request` (rate-limited to 250 ms). Server decides whether to resize the PTY (it will, unless a native client is driving it).
5. **Theme.** Replace hard-coded Catppuccin with `--graphite-*` tokens mirrored from `src/shared/web-theme-tokens.css`, and consume the active theme from `state/snapshot.theme`. DM Sans for UI chrome, JetBrains Mono only for terminal + chip values.
6. **No emoji chrome.** Use inline SVG icons (16 px) for sidebar toggle, fullscreen, status dot, back. Keep it to six icons.
7. **Error surface.** Any unhandled protocol error becomes a toast pill at the top of the pane grid with a retry button.
8. **Build.** `bun build src/web-client/main.ts --target=browser --outdir=assets/web-client --minify`. The `WebServer` serves the built file from `/assets/client.js`. Dev mode reads the un-minified build; packaged mode reads the minified one copied to `vendor/`.

### 2.6 UI — what the new surface looks like

Structure (each item maps to a module):

- **Toolbar** (52 px, `bg-title`, bottom `1px border-soft`)
  - Left: sidebar toggle, workspace switcher (button, not `<select>`)
  - Center: workspace name + pane-count chip + "Remote" badge
  - Right: connection pill (green dot + ms RTT), client count, fullscreen, settings
- **Sidebar** (304 px, slide, `bg-sidebar`, `border-soft` right)
  - Workspace list (same cards as native)
  - Active workspace stats (pane count, listening ports total, CPU %)
  - Notifications section (cards, max 5, purple left rail from tokens)
  - Logs section (mono, max 10)
  - Server status (listening host/port/auth)
- **Pane grid** — same binary-tree compute as today, but pane chrome uses the native `surface-bar` look (system sans title, mono-only chips for cwd / fg cmd / ports, `radius-lg 18px`, `border-soft`, focus ring via `accent-primary-strong`).
- **Panels** — `radius-md 12px`, matte surface, no backdrop blur on body (only on drag handle), drag/resize unchanged.
- **Command palette parity** is not in scope for v1 but the tokens leave room.

All above consume the same CSS custom properties as the native app (`--accent-primary`, `--bg-shell`, `--border-soft`, etc.) — we ship a shared `web-theme-tokens.css` referenced from both views.

### 2.7 Milestones and order of work

Each milestone is a landable PR. The branch stays functional throughout.

**M1 — Extract and stabilise (no behaviour change).**
- Split `web-server.ts` into `server.ts`, `asset-loader.ts`, `page.ts`, `connection.ts`.
- Move HTML/CSS/JS strings into `src/web-client/` and wire a `bun build` step producing `assets/web-client/client.{js,css}`.
- Package build copies the built client into `vendor/web-client/`.
- Typecheck passes, existing tests pass untouched.

**M2 — Protocol v2 envelopes + snapshot.**
- Define `src/shared/web-protocol.ts`.
- Server sends `session/hello` + `state/snapshot` on connect with all live state (metadata, panels, sidebar).
- Client translates v2 messages to the legacy DOM (still monolithic view).
- Add `tests/web-protocol.test.ts` covering snapshot completeness and envelope sequencing.

**M3 — Client store and view modules.**
- Introduce reducer + slices (`store/`).
- Rewrite views as subscribers. Remove global `var` maps.
- Replace emoji chrome with inline SVG.
- Unit-test the reducer.

**M4 — Reconnect + resume.**
- Server keeps a per-session ring buffer (2 MB cap) keyed by `sessionId` with TTL 60 s after disconnect.
- Client reconnect carries `resumeSessionId` + `lastSeenSeq`.
- Server delta-replays or falls back to snapshot.
- Add test: kill WS mid-stream, reconnect, verify no gap and no duplicate bytes.

**M5 — xterm-headless history.**
- Add `@xterm/headless` + `@xterm/addon-serialize` dependencies.
- Maintain a headless terminal per surface in `SessionManager` (behind a feature flag to keep memory opt-in).
- Replace `getOutputHistory` with `serialize()` on initial subscribe.
- Measure memory: target < 2 MB per idle surface, < 6 MB for a busy 10k scrollback.

**M6 — Graphite theme.**
- Extract shared CSS tokens to `src/shared/web-theme-tokens.css`.
- Rebuild client stylesheet against tokens.
- Wire `state/snapshot.theme` so web reflects the user's selected preset.
- Visual pass against the design guidelines doc: toolbar 52 px, radii 8/10/12/18, no neon glow, DM Sans chrome.

**M7 — Backpressure, coalescing, metadata patches.**
- Implement `Broadcaster` with 16 ms flush window and `getBufferedAmount` check.
- Server emits `metadata/patch` diffs instead of full `surfaceMetadata` every tick.
- Stress test: 4 clients, `yes` piped through `pv -L 10M`, confirm no event-loop stall > 50 ms.

**M8 — Optional auth and bind-local default.**
- `settings.webMirrorBind` = `127.0.0.1` default, `0.0.0.0` opt-in.
- `settings.webMirrorAuthToken` — when set, required on `GET /` and WS upgrade.
- Settings UI row + clear warning when binding publicly.

**M9 — Resize feedback.**
- Client sends `surface/resize-request` from `ResizeObserver`.
- Server accepts when no native client has focus on that surface; otherwise ignores and notifies client of authoritative size.

**M10 — Docs and cleanup.**
- Update `doc/system-webview-ui.md` and `README.md`.
- Retire the legacy client path.
- Final pass on the design guidelines checklist.

### 2.8 Test plan

Unit / protocol (`bun test`):

- Snapshot contains all surfaces, metadata, panels, sidebar on a freshly-populated `SessionManager`.
- Envelope sequence is strictly monotonic per connection; skipping triggers `surface/output-gap`.
- Reducer: `state/snapshot` replaces, `metadata/patch` merges, `panel/op` resolves by epoch.
- Reconnect with valid `lastSeenSeq` replays only the delta; with stale id triggers snapshot.
- `Broadcaster` coalesces bursts; high buffered amount marks the client stalled.

Integration (bun test, real `Bun.serve` + `WebSocket`):

- Two clients, one producer; both receive identical output bytes (after serialize).
- Client A drags a panel; client B sees the final position within one tick.
- Workspace switch on client A does not affect client B's focused workspace.
- Auth: with token set, unauthenticated WS upgrade is rejected with 401.

Manual (documented in PR):

- `bun start`, open `http://localhost:3000`, run `vim` in one pane and `btop` in another. Resize the browser. Kill the browser tab and reopen — expect visual continuity.
- Toggle Graphite / Obsidian / Tokyo Night themes in native settings; confirm web reflects within a few hundred ms.

### 2.9 Acceptance criteria

- `bun test` and `bun run typecheck` pass.
- `bun start` + browser: cold-open a TUI app (vim), reconnect, screen state is intact.
- Four parallel clients do not stall the event loop with a fast producer (measured).
- Default bind is loopback; public bind warns; auth token can be set and enforced.
- Web UI passes the design guidelines checklist (DM Sans chrome, mono only for terminal/chips, Graphite tokens, 8/10/12/18 radii, no neon).
- `doc/system-webview-ui.md` and `README.md` reflect the new behaviour. This file stays as the historical record of the refactor.

### 2.10 Risks and tradeoffs

- **Headless xterm memory.** Running a shadow terminal per surface adds ~1–3 MB per pane. Mitigation: cap scrollback for the shadow terminal at 2 000 lines (configurable), feature-flag it, fall back to byte history if disabled.
- **Build step complexity.** Adding `bun build` for the web client introduces a produced artefact. Mitigation: keep it in `assets/web-client/` committed for dev (so `bun start` does not require a build), run `bun build` in CI and in the packaging hook.
- **Auth default.** Enabling a default token would break the current no-setup zero-config mirror. We compromise: bind `127.0.0.1` by default, keep auth opt-in, surface a clear warning in settings when binding `0.0.0.0`.
- **Protocol version churn.** We ship v2 and delete v1 in one go (the mirror is alpha; no external clients consume it). If this assumption ever breaks we can add a `?v=1` fallback handler; not worth pre-building.
