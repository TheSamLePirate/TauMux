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
- [ ] `SurfaceManager.focusedPaneId` is the sole source of truth
- [ ] `.tau-pane.is-focused-human` + `.tau-pane.is-focused-agent` rules live in `index.css`
- [ ] Pane header bg shifts `panel → panelHi` on focus
- [ ] Identity dot gains glow on focus
- [ ] Dev helper confirms only one chrome `box-shadow` besides the outer window

## Phase 6 — Variant A: Bridge (default)
- [ ] `src/views/terminal/variants/bridge.ts` created
- [ ] 240 px non-collapsible sidebar
- [ ] Top-right segmented workspace switcher (3 pills)
- [ ] Split: utility top-left, big terminal top-right, wide bottom
- [ ] Inner padding 6 px, gap 6 px
- [ ] Status bar carries Codex meter + Week meter + $ cluster
- [ ] Artboard diff ≤ ±4 px vs `bridge.png`

## Phase 7 — Variant B: Cockpit
- [ ] `src/views/terminal/variants/cockpit.ts` created
- [ ] 52 px icon rail, 22 px τ-mark top, 36×36 workspace buttons
- [ ] HUD strip (22 px Mono 10.5) between header + body on every pane
- [ ] Up to 4 panes (2×2 or 2+2) layout
- [ ] Command bar centred
- [ ] Pulsing amber dot on workspaces with a running agent
- [ ] Artboard diff ≤ ±4 px vs `cockpit.png`

## Phase 8 — Variant C: Atlas
- [ ] `src/views/terminal/variants/atlas.ts` created
- [ ] 220 px graph column with 20 px faint grid
- [ ] Node rendering (repo / agent / tool / self colours) + active halo
- [ ] Edge rendering with dashed cyan animation on active
- [ ] Bottom-left info card (name / last action / model)
- [ ] 36 px tab rail with 26×26 two-letter mnemonic chips
- [ ] Activity ticker (32 px) with left-mark, event stream, right meters
- [ ] Artboard diff ≤ ±4 px vs `atlas.png`

## Phase 9 — Variant switcher + persistence
- [ ] `layoutVariant` added to `AppSettings` / `DEFAULT_SETTINGS` / `validateSettings`
- [ ] `updateSettings` wiring in `src/bun/rpc-handlers/system.ts`
- [ ] Settings panel "Layout" section with three variant previews
- [ ] Command palette entries for each variant
- [ ] Keyboard: `Ctrl+h/j/k/l`, `⌘K`, `⌘⇧P`, `⌘\`, `⌘G`
- [ ] Choice survives app restart

## Phase 10 — Overlay compliance sweep
- [ ] `command-palette.ts`
- [ ] `settings-panel.ts`
- [ ] `process-manager.ts`
- [ ] `agent-panel.ts` + `agent-panel-*.ts`
- [ ] `browser-pane.ts`
- [ ] `telegram-pane.ts`
- [ ] `prompt-dialog.ts`
- [ ] `toast.ts`
- [ ] `panel.ts`
- [ ] `terminal-search.ts`
- [ ] `surface-details.ts`
- [ ] `agent-panel-dialogs.ts`
- [ ] `sidebar.ts` + `sidebar-manifest-card.ts` + `sidebar-state.ts` (variant-aware)

## Phase 11 — Bloom gate
- [ ] Settings migration writes `bloomMigratedToTau: true` and stores `legacyBloomIntensity`
- [ ] Default bloom intensity = 0 on fresh install
- [ ] Setting description updated to reflect "optional, off by design"
- [ ] Shader target restricted to terminal body layer only (not chrome)

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
