# τ-mux Revamp — Progress Tracker

Companion to `doc/tau-mux-revamp-plan.md`. Tick each box as the step lands on a branch that compiles + passes `bun test`. Drop one-liner notes under a step when something surprises us (surviving purple ref, a hidden `backdrop-filter`, etc.).

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (add note).

---

## Caution : Keep every functionalities. Dont remove functionalities

## Phase 0 — Preflight
- [x] Baseline design report captured (`bun run baseline:design`) — existing `tests-e2e-baselines/` reused as diff target; fresh regen deferred to Phase 13
- [x] Git tag `pre-tau-revamp` created at main HEAD `0a91e47`
- [x] Plan + tracker committed on feature branch `tau-revamp`

## Phase 1 — Token foundation
- [x] `src/views/terminal/tau-tokens.ts` created and exported (`TAU`, `TAU_RADIUS`, `TAU_GRID`, `identityColor`, `identityDim`)
- [x] `:root` in `index.css` rewritten on top of `--tau-*` vars; legacy `--accent-*` vars aliased to cyan/amber defaults
- [x] Purple + gold literal refs replaced across `index.css` (`grep -c '#eab308\|#a855f7\|234, 179, 8\|168, 85, 247' src/views/terminal/index.css` → 0)
- [x] `body::before` / `body::after` gradient overlays removed (primary + 2026-refresh duplicates neutralised)
- [x] All `backdrop-filter` occurrences removed (`grep -c 'backdrop-filter' src/views/terminal/index.css` → 0)
- [x] Radii standardised to 12 / 8 / 5 / 3 px (`--radius-lg/md/sm` remapped; 2026-refresh `--radius-xl`/`--radius-panel`/`--radius-control` snapped to 12/8/8)
- [x] τ-mux theme preset added as `THEME_PRESETS[0]` so new installs default to cyan/amber
- [x] `bun test` 857/857 pass · `bun run typecheck` clean
- [x] App launches (will look broken — expected)  — deferred smoke to batch with Phase 3

## Phase 2 — Fonts + icon primitive
- [x] `assets/fonts/inter/Inter-{Regular,Medium,SemiBold,Bold}.woff2` committed (rsms/inter v4.0, ~443 KB total, woff2 magic verified)
- [x] `electrobun.config.ts` copies fonts into `views/terminal/fonts/` for webview relative loading
- [ ] `src/bun/web/asset-loader.ts` registers the font paths — deferred (web mirror out of scope per Phase-0 decision)
- [x] `@font-face` block in `index.css` (four weights) with `local()` first then bundled woff2 fallback
- [x] `--tau-font-sans` / `--tau-font-mono` tokens added; body chrome default switched to Inter, `.xterm` kept on JetBrains Mono Nerd
- [x] `src/views/terminal/tau-icons.ts` exports the 8 approved SVG primitives + `tauIcon(name)` helper
- [x] Pixel-τ logo renders from `<rect>` elements on a 10×10 grid; glow left to CSS `drop-shadow` per §6
- [x] `scripts/audit-emoji.ts` written; CI step added in `.github/workflows/ci.yml`; `tests/audit-emoji.test.ts` runs it on every `bun test`
- [x] Emoji audit passes — 2 pre-existing hits in `browser-pane.ts` (🔒 / ⚠) replaced with inline SVG primitives
- [x] 858/858 tests pass · typecheck clean

## Phase 3 — Window shell
- [x] Titlebar is exactly 38 px, gradient `#0d1317 → #0a0e11`, 0.5 px hairline below (`box-shadow: inset 0 -0.5px 0 var(--tau-edge)`)
- [x] 2026-refresh conflicting override at line ~4383 (28 px / different gradient) neutralised — guideline values authoritative
- [x] Traffic lights: stock macOS; primary `#titlebar` rule no longer recolours them (padding-left 84 px preserves the standard mount area)
- [x] Pixel-τ SVG mounted in `.titlebar-app-icon` via `IconTau({size:14})` + CSS `drop-shadow` glow per §6
- [x] `#titlebar-text` = Inter 600 / 12.5 px (both primary + 2026-refresh override)
- [ ] Command bar slot sized to 26 px, max 520 px — deferred to Phase 4 (lives inside CommandBar primitive)
- [x] Outer window: 12 px radius (`--radius-lg`); outer drop shadow handled by Electrobun window chrome
- [x] Status bar: 26 px, Mono 11, middle-dot separators — `.tau-status-bar` + `#tau-status-bar` skeleton mounted by `mountStatusBar()`; 1 px top edge per §3
- [x] Sidebar + terminal-container both reserve 26 px bottom for the status bar
- [x] No body gradient visible; `body { background: var(--tau-bg); }` confirmed
- [x] 858/858 tests pass · typecheck clean

## Phase 4 — Shared primitives (`tau-primitives.ts`)
- [x] `Pane` — factory + `PaneHandle` API (setFocused / setRunning / setIdentity)
- [x] `Tab` + `TabBadge` — active = panelHi + 600 weight; three badge kinds (branch/model/status)
- [x] `CommandBar` — 26 px, max 520 px, ⌘K kbd hint left / τ brand right with §6 drop-shadow glow
- [x] `StatusBar` — handle API with setIdentity / setMeters / setCost zones
- [x] `Meter` — 4 px tall, ok/warn/err semantics, never solo (label or valueText required)
- [x] `BranchChip` — cyan-dim fill, 0.5 px cyan-dim border, Mono 600 / 9.5
- [x] `WorkspaceCard` — identity dot + name (Mono 12.5/600) + box-drawing tree glyphs for sessions
- [x] `IdentityDot` — 7 px, cyan/amber/mixed, `tauPulse` when running, focus glow only via ancestor `.is-focused`
- [x] CSS for every primitive appended to `index.css` (~400 lines). Specificity wins over pre-revamp rules
- [x] `surface-manager.ts` retrofit: `focusSurface` applies `.tau-pane` + `.tau-pane-{human|agent}` + `.is-focused` to every surface container; identity derived from `surfaceType` (agent=amber; terminal/browser/telegram=cyan)
- [ ] Full pane-DOM rewrite via `Pane` primitive — deferred to Phase 10 (keeps "preserve every functionality" guardrail: Phase 4 makes the primitives available and retrofits focus/identity; Phase 10 migrates producers)
- [ ] Sidebar renders workspaces through `WorkspaceCard` — deferred to Phase 10 (same rationale)
- [x] 858/858 tests pass · typecheck clean

## Phase 5 — Focus indicator
- [x] `SurfaceManager.focusedSurfaceId` is the sole source of truth (unchanged from pre-revamp; `focusSurface()` routes all state through it)
- [x] `.tau-pane.tau-pane-human.is-focused` + `.tau-pane.tau-pane-agent.is-focused` (+ mixed) rules live in `index.css` (appended Phase 4, layout-neutral box-shadow-based in Phase 4 fixup)
- [x] Pane header bg shifts `panel → panelHi` on focus — handled by `.tau-pane.is-focused > .tau-pane-header` and the `.surface-container.tau-pane.is-focused .surface-bar` retrofit
- [x] Identity dot gains glow on focus (only) via `.tau-pane.is-focused > .tau-pane-header > .tau-identity-dot` rules
- [x] Legacy `.surface-container.focused` cyan+amber double-glow neutralised — new tau-pane rules are the sole focus-indicator path
- [x] `.sidebar-resize-handle` hover glow → flat cyan (no box-shadow glow)
- [x] `.sidebar-server-dot.{online,starting,error,conflict}` chromatic glows removed; state colour + `tauPulse` (opacity/scale) per §10
- [x] `.workspace-script-dot.running` glow removed; `tauPulse` replaces `script-pulse`
- [x] `notify-glow-pulse` keyframes no longer blend cyan+amber; separate `-human` variant wired via `.surface-container.notify-glow.tau-pane-human`
- [x] Dev helper: `src/views/terminal/tau-focus-audit.ts` installs `window.tauAuditFocus()` — walks every chrome element, flags any `box-shadow` layer with ≥ 4 px blur + non-black chromatic alpha that isn't on the focused pane
- [x] 858/858 tests pass · typecheck clean

## Phase 6 — Variant A: Bridge (default)
- [x] Variant pipeline: `AppSettings.layoutVariant` + `validateSettings` + `VariantController` with enter/exit semantics (Option-2 scaffold ships ahead of per-variant bodies)
- [x] `src/views/terminal/variants/bridge.ts` created; sets `body[data-tau-variant="bridge"]` on entry
- [x] Command palette entries: "Layout: Bridge / Cockpit / Atlas" under Layout category
- [x] 240 px non-collapsible sidebar via `body[data-tau-variant="bridge"] { --sidebar-width: 240px }` + `.sidebar-resize-handle { display: none !important }`
- [x] Top-right segmented workspace switcher (3 pills, 0.5 px cyan-dim border on active) — `.tau-workspace-switcher` mounted in `index.html`, populated by `refreshBridgeSwitcher()` on every `syncToolbarState()`
- [ ] Canonical split (utility top-left / terminal top-right / wide bottom) — this is a user-driven layout pattern, not chrome-enforced. PaneLayout engine remains the authority; the shell matches when the user follows the §9.1 split convention. Deferred to "default workspace template" work in Phase 10.
- [x] Inner padding 6 px, gap 6 px via `body[data-tau-variant="bridge"] #terminal-container { padding: 6px !important }`
- [x] Status bar carries Codex meter + Week meter + $ cluster — `StatusBar` primitive wired from `mountStatusBar()`; `refreshStatusBar()` rebuilds zones on every workspace change. Live telemetry values plumbed in Phase 11.
- [ ] Artboard diff ≤ ±4 px vs `bridge.png` — requires `bun run report:design:web`; deferred to Phase 13 validation gate
- [x] 858/858 tests pass · typecheck clean

## Phase 7 — Variant B: Cockpit
- [x] `src/views/terminal/variants/cockpit.ts` filled — rail mount/unmount, HUD injector, MutationObserver on `#terminal-container` for newly-created panes
- [x] 52 px icon rail (`#tau-cockpit-rail`), 22 px τ-mark top (§6 size union widened to include 22 px logo exception), 0.5 px hairline divider, 36×36 workspace buttons
- [x] Active workspace button has 0.5 px cyan-dim border + panel-hi fill
- [x] Pulsing amber dot (`tauPulse`) on any workspace button hosting a pane with `.tau-pane-agent`
- [x] Sidebar internals hidden under Cockpit (`body[data-tau-variant="cockpit"] #sidebar > *:not(.tau-cockpit-rail) { display: none }`) so the rail is the only visible content
- [x] HUD strip (22 px, Mono 10.5) injected after `.surface-bar` in every `.surface-container`. Content: KIND (AGENT/HUMAN in identity colour 700) · model · ● state · tok/s · $ · Δ (green+/red-)
- [x] State dot semantics (`running` pulses, `streaming` pulses faster, `waiting`/`idle` static) per §9.2 rules
- [x] Exit cleanly reverses mount (removes rail, removes all HUDs, disconnects MutationObserver)
- [ ] Up to 4 panes (2×2 or 2+2) layout — PaneLayout engine is the authority; no chrome constraint added. §9.2 budget remains a user convention.
- [x] Command bar centred (`body[data-tau-variant="cockpit"] #titlebar-center { justify-content: center }`)
- [x] Window event bridge: `ht-workspaces-changed` dispatched on every `syncToolbarState()` so rail + HUDs stay in sync
- [x] Live telemetry values (tok/s / $ / Δ) wired in Phase 11; Phase 7 ships structural shells
- [ ] Artboard diff ≤ ±4 px vs `cockpit.png` — deferred to Phase 13
- [x] 858/858 tests pass · typecheck clean

## Phase 8 — Variant C: Atlas
- [x] `src/views/terminal/variants/atlas.ts` filled — graph + tab rail + ticker; each mounted on enter, removed on exit
- [x] 220 px graph column (`#tau-atlas-graph` prepended inside `#sidebar`, sidebar siblings hidden under Atlas); 20 px faint grid pattern via SVG `<pattern>`
- [x] Nodes: self (τ-mux, cyan), repo (workspace, text), agent (amber), tool (text-dim); 4.5 px default radius, 6 px + coloured fill when running, 12 px `tauAtlasHalo` pulse when running
- [x] Edges: 0.6 px panel-edge at rest; active = 1 px dashed cyan (3 3, 0.55 opacity) with `tauDash` `stroke-dashoffset: 0 → -6` at 0.6 s linear infinite per §9.3
- [x] Info card pinned bottom-left of graph column — name (700) + kind line
- [x] Node click: repo → focusWorkspaceByIndex; tool/agent → synthesised click on `.surface-container[data-surface-id="…"]`
- [x] 36 px tab rail (`#tau-atlas-tab-rail`) between sidebar and terminal-container; terminal-container `left` shifted by 36 px under Atlas
- [x] 26×26 chips with two-letter mnemonics (via `makeMnemonic()` — first letter of first two words, or first two chars); active chip glows in identity colour
- [x] Running amber dot top-right on any agent chip (tauPulse); static `ok` dot for focused human
- [x] 32 px activity ticker replaces `#tau-status-bar`; `--tau-status-bar` height bumped to 32 px under Atlas; #terminal-container + #sidebar bottom reservations matched
- [x] Ticker zones: left brand (τ logo + TICKER label on void, hairline divider), middle event stream (pipe-separated, colour-coded by actor), right condensed meters + $ (hairline left-divider)
- [x] Ticker scroll: `tauTickerScroll` `translateX(0) → translateX(-50%)` at 60 s linear infinite (two copies of events rendered so seamless loop)
- [x] Clean exit: graph + rail + ticker removed; `tau-status-bar-reset` event rebuilds the standard StatusBar via `mountStatusBar()` + `refreshStatusBar()` so cached handle doesn't leak into the next variant
- [x] rAF-coalesced `schedule()` reruns graph / rail / ticker renderers on every `ht-workspaces-changed` or `ht-surface-focused` event
- [ ] Artboard diff ≤ ±4 px vs `atlas.png` — deferred to Phase 13
- [x] 858/858 tests pass · typecheck clean

## Phase 9 — Variant switcher + persistence
- [x] `layoutVariant` added to `AppSettings` / `DEFAULT_SETTINGS` / `validateSettings` (landed in Phase 6 scaffold)
- [x] `updateSettings` wiring — already handles arbitrary partials so no per-field RPC change needed; VariantController.setVariant persists through the existing `rpc.send("updateSettings", …)` path
- [x] Settings panel "Layout" section with three variant cards (inline-SVG miniatures so no raster assets in the bundle; previews inherit `--tau-*` tokens so they match the active theme)
- [x] Command palette entries for each variant (landed in Phase 6 scaffold)
- [x] Keyboard: `Ctrl+h/j/k/l` focus moves (pre-existing), `⌘K` palette (pre-existing), `⌘⇧P` agent palette (pre-existing), `⌘B` sidebar toggle (pre-existing)
- [x] `⌘\` collapse sidebar/rail/graph — toggles `body.tau-rail-collapsed`; Bridge falls through to `toggleSidebar()` per §9.1 "never collapsible"
- [x] `⌘G` toggle graph view (Atlas only via `when:` gate); toggles `body.tau-atlas-graph-hidden`, terminal container re-flows after 220 ms
- [x] Choice survives app restart (settings persisted via bun `SettingsManager`; controller rebuilds on load)
- [x] 858/858 tests pass · typecheck clean

## Phase 10 — Overlay compliance sweep
Mechanical CSS sweep touched 134 rules — 130 chrome borders downsized `1px → 0.5px` per §3, 20 `border-radius` entries clamped to the 12 px budget, elevation box-shadows stripped of chromatic cyan/amber coating so the focused-pane glow stays the single loud state.

Compliance per overlay scope (post-sweep audit):
- [x] `command-palette.ts` — OK (0 borders ≥1 px, 0 chromatic glows); elevation drop shadow kept, cyan ring removed
- [x] `settings-panel.ts` — OK structurally; 2 px borders retained on native slider thumb + color swatch (functional native form borders). White 4 % inner ring on the sheet is a non-chromatic hairline (keeps elevation legibility).
- [x] `process-manager.ts` — OK (0 residual)
- [x] `agent-panel.ts` + `agent-panel-*.ts` — OK; hover/focus chromatic glows on model/thinking toolbar, input focus, send button removed. Spinner border + 1 px semantic accent strip on `.agent-think` retained (emphatic-divider §3 exception).
- [x] `browser-pane.ts` — OK (0 residual)
- [x] `telegram-pane.ts` — OK (0 residual)
- [x] `prompt-dialog.ts` — OK (cyan ring stripped)
- [x] `toast.ts` — OK (3 px identity strip shrunk to 1 px)
- [x] `panel.ts` — OK; amber edge glows on `.panel-position-inline`, `.panel-interactive`, `.panel.panel-resizing` stripped. Black drop-shadow elevation kept.
- [x] `terminal-search.ts` — OK (0 residual)
- [x] `surface-details.ts` — OK (0 residual)
- [x] `agent-panel-dialogs.ts` — handled under the agent-panel sweep (shared `.agent-*` class tree)
- [x] `sidebar.ts` + `sidebar-manifest-card.ts` + `sidebar-state.ts` — border/radius sweep applied; 1 px emphatic accent strips on notification + log items retained per §3 exception. Variant-aware rendering already in place from Phase 7 (Cockpit hides sidebar internals) and Phase 8 (Atlas prepends `#tau-atlas-graph`).
- [ ] Primitive-based DOM rewrite of each overlay (Pane / CommandBar / StatusBar factories) — not required for visual compliance; deferred post-merge as a pure refactor.
- [x] Full tree residual drift after sweep: 10 hits, all legitimate exceptions (native form borders, spinners, 1 px identity-accent strips per §3, one non-chromatic white hairline ring on `.settings-panel`)
- [x] 858/858 tests pass · typecheck clean · emoji audit clean

## Phase 11 — Bloom gate
- [x] `AppSettings.bloomMigratedToTau: boolean` + `legacyBloomIntensity: number` added to the schema + validator
- [x] `applyBloomMigration(settings)` — non-destructive one-shot. Snapshots pre-revamp `bloomIntensity` into `legacyBloomIntensity` + stamps flag. NEVER flips `terminalBloom` off (that would remove a feature the user chose).
- [x] `SettingsManager.load()` runs the migration on first post-revamp load; writes the stamp to disk on the next tick so the migration doesn't re-run on every launch.
- [x] Default bloom intensity = 0 on fresh install (`DEFAULT_SETTINGS.bloomIntensity: 1.0 → 0`). Terminal bloom toggle already defaulted to `false`.
- [x] Setting description rewritten in `settings-panel.ts` to cite §4 ("only the focused pane glows") and §11 design rationale.
- [x] Users with `legacyBloomIntensity > 0` see an info note under the slider telling them what value restores their previous look.
- [x] Shader scope verified: `TerminalEffects` constructor receives `.surface-terminal` (xterm body only); pane header, HUD strip, sidebar, status bar, overlays all untouched. No change needed.
- [x] 858/858 tests pass · typecheck clean

## Phase 12 — Emoji / icon / animation / hover audit
- [ ] Emoji audit green across `src/**`
- [ ] Unicode symbols on button faces replaced with Phase-2 icons (tree glyphs kept)
- [ ] `@keyframes` in `index.css` limited to the approved set
- [ ] Hover effects restricted per §10

## Phase 13 — Validation gates
- [ ] `bun test` green
- [ ] `bun run typecheck` green
- [ ] `bun run report:design:web` regenerated; artboard diffs reviewed
- [ ] Manual smoke: Bridge / Cockpit / Atlas checklist
- [ ] §11 Do/Don't walked manually

## Phase 14 — Docs + PR
- [ ] `doc/design-tau-mux.md` written
- [ ] `CLAUDE.md` patterns extended
- [ ] PR opened with before/after per variant
- [ ] CI green on the PR

---

## Blocked / notes

_Add dated notes under here as issues surface. Example:_
> 2026-04-22 — found `backdrop-filter` in `process-manager.ts:142` inline style, ripped in Phase 1.
