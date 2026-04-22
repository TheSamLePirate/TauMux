# τ-mux Revamp — Master Plan

Source of truth: `design_guidelines/Design Guidelines tau-mux.md` (do not modify).
Reference artboards: `design_guidelines/images_example/{bridge,cockpit,atlas}.png`.
Reference JSX (tokens + primitives + variants): `design_guidelines/src/*`.

Progress tracker: `doc/tau-mux-revamp-progress.md` — tick each step as it lands.

---


## Caution : Keep every functionalities. Dont remove functionalities

## Goals (from user answers)

1. **100 % compliance** with the guideline on the main shell *and* every overlay (command palette, settings, process manager, agent panel, browser pane, telegram pane, toasts, sidebar notifications).
2. **All three variants** — Bridge (default), Cockpit, Atlas — switchable at runtime, persisted in `AppSettings`.
3. **Rip-and-replace** non-conforming chrome (purple accent, radial body gradients, backdrop-filter glass, big radii, decorative icons).
4. **WebGL bloom preserved** as an opt-in effect (default OFF after the revamp — only the focused pane glows per §4).
5. **Inter bundled locally** (`assets/fonts/`), **JetBrains Mono Nerd Font kept** for terminal body.
6. `design_guidelines/` is read-only reference. `src/web-client/` is out of scope for this revamp.

---

## Hard rules restated (from §0, §11 — must be enforceable)

- Only two accents ever: **cyan `#6fe9ff`** (human + focus + system) and **amber `#ffc56b`** (agent). No third accent.
- One glowing element on screen at any time: the focused pane. Nothing else.
- Black is a material: `void #000` (pane body), `bg #07090b` (window), `panel #0b1013` (chrome). No body gradients. No `backdrop-filter`.
- Borders: 0.5 px hairline `panelEdge #1a2328`. 1 px only for emphatic dividers (status bar top edge).
- Radii: 12 (window) / 8 (pane) / 4–6 (button) / 3 (chip). Nothing larger anywhere.
- Spacing grid: **4 px**.
- Fonts: **Inter** for chrome, **JetBrains Mono (Nerd)** for anything terminal-pasteable (paths, model names, branches, counts, tokens).
- **No emoji.** Geometric SVG icons only (§6).
- Traffic lights stay stock macOS colours. Do not restyle.
- Animations restricted to `tauBlink`, `tauPulse`, `tauGlowPulse`, dashed-edge offset (Atlas), ticker scroll (Atlas).

---

## Phase map

Each phase has an exit criterion. A phase is not "done" until its exit criterion holds under `bun test` + `bun run typecheck` + a manual `bun start` smoke.

### Phase 0 — Preflight

- Create baseline design report (`bun run baseline:design`) before any visual change so regressions are diffable.
- Snapshot current `index.css` vars for reference (git history is enough — no copy).
- Tag the tip commit `pre-tau-revamp` so rollback is one command.

**Exit:** baseline captured; tag pushed; this plan + progress tracker committed.

### Phase 1 — Token foundation

- New `src/views/terminal/tau-tokens.ts` mirroring the `TAU` palette in `design_guidelines/src/tokens.jsx` as a typed constant export.
- Rewrite `:root` in `src/views/terminal/index.css` to derive from `TAU`:
  - purge every `--accent-primary*`, `--accent-secondary*`, `--glow-gold*`, `--glow-purple*` ref;
  - introduce `--tau-void`, `--tau-bg`, `--tau-panel`, `--tau-panel-hi`, `--tau-edge`, `--tau-edge-soft`, `--tau-text`, `--tau-text-dim`, `--tau-text-mute`, `--tau-text-faint`, `--tau-cyan`, `--tau-cyan-soft`, `--tau-cyan-dim`, `--tau-cyan-glow`, `--tau-agent`, `--tau-agent-soft`, `--tau-agent-dim`, `--tau-ok`, `--tau-warn`, `--tau-err`, `--tau-tl-red`, `--tau-tl-yel`, `--tau-tl-grn`;
  - radii: `--tau-r-window: 12px`, `--tau-r-pane: 8px`, `--tau-r-chip: 3px`, `--tau-r-btn: 5px`.
- Delete `body::before` and `body::after` gradient overlays. Body becomes flat `--tau-bg`.
- Remove every `backdrop-filter` / `-webkit-backdrop-filter` in `index.css` (sidebar, titlebar, glass surfaces, palette, overlays).

**Exit:** grep for `#eab308`, `#a855f7`, `backdrop-filter`, `radial-gradient(` in `src/views/terminal/index.css` returns zero hits. App still launches (may look broken — expected at this phase).

### Phase 2 — Fonts + icon primitive

- Drop Inter 400/500/600/700 woff2 into `assets/fonts/inter/`. Register in `electrobun.config.ts` `copy` rules under `vendor/fonts/inter/`. Add to `VENDOR_MAP` / `readBinaryAsset` in `src/bun/web/asset-loader.ts` (pattern: `assets/audio/finish.mp3`).
- `@font-face` block in `index.css` targeting the bundled files. **JetBrains Mono Nerd Font stays as-is** for `.tau-mono` and the xterm body.
- New `src/views/terminal/tau-icons.ts` — SVG primitive registry: `split`, `grid`, `agent`, `human`, `plus`, `git`, `spark`, `tau`. Each a pure function returning an `SVGElement` with `currentColor` stroke, 0.7–0.9 px weight, size `10|11|14`.
- Pixel-τ logo rendered from `<rect>` elements (10×10 grid) with `drop-shadow(0 0 6px cyanGlow) drop-shadow(0 0 2px cyan)`.
- Add an **emoji audit script** (`scripts/audit-emoji.ts`) — regex for emoji code points over `src/views/terminal/**` + `src/bun/**`. Fails CI if any hit is found (excluding comments and test fixtures). Wire into `bun test`.

**Exit:** Inter renders via bundled file (offline-verifiable with `/System` DNS off). Emoji audit is green. No raster logo in the bundle.

### Phase 3 — Window shell

Target file: `src/views/terminal/index.ts` + `index.html` + `index.css`.

- Titlebar height → **38 px** exactly, gradient `#0d1317 → #0a0e11`, 0.5 px hairline below.
- Traffic lights: stock macOS (Electrobun default). Confirm no CSS override recolours them.
- App identity: pixel-τ SVG (14 px) + `τ-mux` wordmark in Inter 600 / 12.5 px.
- Command bar = `CommandBar` primitive (see Phase 4) — 26 px tall, max 520 px wide.
- Outer window: 12 px radius; outer shadow `0 30px 80px rgba(0,0,0,.55)`; inner hairline `0 0 0 0.5px #1a2328`.
- Status bar: 26 px, Mono 11, `textDim`; items separated by middle dots in `textFaint`.

**Exit:** titlebar + status bar match §5 / §8.3 pixel-for-pixel at 1x. No gradient on body, no glow on non-focused chrome.

### Phase 4 — Shared primitives

New module `src/views/terminal/tau-primitives.ts` — all primitives vanilla TS, DOM-only (no React):

- `Pane({ identity: 'human' | 'agent' | 'mixed', focused, tabs, actions, body })` — 28 px header, 7 px identity dot, 10 px padding, 8 px gap.
- `Tab({ label, active, badge })` — 3×10 px padding, radius 5, active → `panelHi` bg + 600 weight.
- `TabBadge({ kind: 'branch' | 'model' | 'status', text })` — Mono 9.5, 0.5 px border, 3 px radius.
- `CommandBar({ placeholder, onInvoke })`.
- `StatusBar({ zones: [identity, meters, spacer, cost] })`.
- `Meter({ value, max, semantic: 'ok'|'warn'|'err', width=50 })` — 4 px tall, label-paired (never solo).
- `BranchChip({ name })` — Mono 600 / 9.5 / `rgba(111,233,255,0.08)` bg, 0.5 px cyan-dim border.
- `WorkspaceCard({ name, sessions[], module, version, active })` — 8–10 px padding, 8 px radius, box-drawing tree glyphs in `textFaint`, running dot pulsing `ok`.
- `IdentityDot({ kind, running })` — 7 px, cyan or amber, `tauPulse` when running, `box-shadow` glow only when its pane is focused.

Current `sidebar.ts` `sidebar-manifest-card.ts` `surface-manager.ts` are rewrapped to render via these primitives rather than their own bespoke DOM.

**Exit:** every pane/tab/chip on screen is produced by these primitives; grep confirms no stray inline `style="background:` on chrome elements.

### Phase 5 — Focus indicator

- Single source of truth for focus state: `SurfaceManager.focusedPaneId`.
- CSS:
  ```css
  .tau-pane { border: 0.5px solid var(--tau-edge); }
  .tau-pane.is-focused-human { border-color: var(--tau-cyan); box-shadow: 0 0 0 0.5px var(--tau-cyan), 0 0 24px var(--tau-cyan-dim); }
  .tau-pane.is-focused-agent { border-color: var(--tau-agent); box-shadow: 0 0 0 0.5px var(--tau-agent), 0 0 24px var(--tau-agent-dim); }
  ```
- Pane header bg shifts `panel → panelHi` on focus.
- Identity dot gains glow on focus.
- Audit `index.css` for every `box-shadow` — anything that isn't on `.tau-pane.is-focused-*` or the outer window gets deleted.

**Exit:** at any moment, exactly one `box-shadow` is rendered in the chrome tree aside from the outer window shadow. Verified via a dev helper that counts `box-shadow` computed values on `.tau-*` nodes.

### Phase 6 — Variant A: Bridge (default)

File: `src/views/terminal/variants/bridge.ts`.

- 240 px sidebar (non-collapsible in this variant).
- Segmented workspace switcher top-right (3 pills, active = 0.5 px cyanDim border).
- Pane split: 1 large top-right terminal, 1 utility top-left (lazygit/logs), 1 wide bottom pane.
- Inner padding 6 px; inter-pane gap 6 px.
- Status bar shows Codex meter + Week meter + $ cluster.

**Exit:** app launches into Bridge by default; matches `bridge.png` artboard at ±4 px on every key landmark.

### Phase 7 — Variant B: Cockpit

File: `src/views/terminal/variants/cockpit.ts`.

- 52 px icon rail sidebar (pure `void` bg): 22 px τ-mark top, hairline, then 36×36 workspace buttons.
- HUD strip (22 px, Mono 10.5) between header and body on every pane: `KIND · model · state · tok/s · $ · Δ`.
- Up to 4 panes (2×2 or 2+2 arrangement). No bottom pane overflow.
- Command bar centred in toolbar.
- Small pulsing amber dot on workspaces with a running agent.

**Exit:** Cockpit selectable in settings; 4-pane 2×2 case works with PTY + sideband + agent pane mixed; matches `cockpit.png`.

### Phase 8 — Variant C: Atlas

File: `src/views/terminal/variants/atlas.ts`.

- 220 px graph column (left), `void` bg with 20 px faint grid pattern.
- Nodes: 4.5 px radius default, 6 px + coloured fill when active, 12 px pulsing halo when running.
- Edges: `panelEdge` at rest (0.6 px); active = dashed cyan (`3 3`, 1 px, 0.55 opacity) with `stroke-dashoffset` 0 → -6 / 0.6 s linear infinite.
- Node colours: repo = `text`, agent = `agent`, tool = `textDim`, self (τ-mux) = `cyan`.
- Info card pinned bottom-left of graph: focused node name (bold) + last action + model.
- 36 px tab rail between graph and panes; 26×26 two-letter mnemonic chips (`CC`, `OC`, `LZ`, `CX`, `ZS`), active chip glows identity colour, running dot top-right.
- Activity ticker (32 px) replaces status bar. Left: `τ TICKER`. Middle: pipe-separated event stream, colour-coded by actor. Right: condensed meters + cost. Scrolls linearly at 60 s loop.

**Exit:** Atlas selectable; graph re-renders on metadata changes; ticker animates. Matches `atlas.png`.

### Phase 9 — Variant switcher + persistence

- Extend `AppSettings` with `layoutVariant: "bridge" | "cockpit" | "atlas"` (default `"bridge"`). Wire through `DEFAULT_SETTINGS` + `validateSettings` + `src/bun/rpc-handlers/system.ts` per the "Adding a settings field" pattern in `CLAUDE.md`.
- Settings Panel → new "Layout" section with three variant previews (use thumbnails of the three artboards from `design_guidelines/images_example/`, bundled under `vendor/images/`).
- Command palette entries: "Layout: Bridge", "Layout: Cockpit", "Layout: Atlas" — each routes through `updateSettings`.
- Keyboard (from §10): `Ctrl+h/j/k/l` focus moves; `⌘K` palette; `⌘⇧P` agent palette; `⌘\` collapse sidebar (Cockpit + Atlas); `⌘G` toggle graph (Atlas).

**Exit:** variant switches live without reload; choice survives app restart.

### Phase 10 — Overlay compliance sweep

For each overlay, rebuild from the primitives. Every overlay gets: `void` or `panel` bg (no glass), 0.5 px hairlines, Mono for values, Inter for labels, cyan/amber identity signals only.

Overlays to migrate, in order (each is a sub-task in the progress tracker):

1. `command-palette.ts` — match `CommandBar` visual; results list uses `panel` rows, `panelHi` on active.
2. `settings-panel.ts` — left nav Inter 500, right pane with labelled controls; sliders become `Meter` primitives where they express a value (bloom intensity, volume).
3. `process-manager.ts` — table in Mono; CPU/MEM columns use inline `Meter`; identity column shows `IdentityDot`.
4. `agent-panel*.ts` — amber identity throughout; model name in Mono; slash-command menu uses the same row style as command palette.
5. `browser-pane.ts` — pane header = `Pane` primitive; URL chip is `BranchChip` variant in cyan.
6. `telegram-pane.ts` — chat header uses `WorkspaceCard` style; message rows use Inter for body, Mono for `@handles`, `#channels`, timestamps.
7. `prompt-dialog.ts`, `toast.ts`, `panel.ts`, `terminal-search.ts`, `surface-details.ts`, `agent-panel-dialogs.ts` — same rules applied.
8. `sidebar.ts` + `sidebar-manifest-card.ts` + `sidebar-state.ts` — rewrite to variant-aware: list layout in Bridge, icon rail in Cockpit, graph in Atlas.

**Exit:** no overlay has a `backdrop-filter`, no purple or amber-where-cyan-belongs, every value ≥ 1 char that could be pasted into a terminal is Mono.

### Phase 11 — Bloom effect gate

- `terminal-effects.ts` → WebGL bloom is allowed to live, but:
  - Default `bloomIntensity = 0` after migration (add a one-shot migration in `SettingsManager` so existing installs opt in explicitly).
  - Setting description updated: "Optional WebGL bloom over terminal body. The τ-mux design system uses only the focused-pane glow; enable this only if you want the terminal text itself to bloom."
  - Effect applies **only to the terminal body layer**, never to chrome (pane borders, tabs, status bar). Sanity-check the shader's element target.

**Exit:** fresh install shows no bloom; existing settings are preserved. Focused-pane glow is the only glow in the default config.

### Phase 12 — Emoji, icon, animation audit

- Run the Phase-2 emoji audit across the full `src/` tree. Replace any surviving emoji with a Phase-2 SVG icon.
- Grep `sidebar.ts` + `surface-manager.ts` + `process-manager.ts` for unicode symbols standing in for icons (`●`, `■`, `▸`, `▾`, `@@`, `─`, `├`, `└`) — allowed in tree/diff structure per §11 "Do", forbidden as button faces.
- Animation audit: every CSS `animation:` or `@keyframes` in `index.css` must be one of `tauBlink`, `tauPulse`, `tauGlowPulse`, Atlas `tauDash`, Atlas `tauTickerScroll`. Anything else deleted.
- Hover audit: hover effects only on (a) interactive buttons (subtle `rgba(0,0,0,0.06)` bg), (b) workspace cards (`panelHi` bg), (c) tabs (cursor only). Strip everything else.

**Exit:** audit script green; `grep -E "animation:|@keyframes" src/views/terminal/index.css` prints only the approved names.

### Phase 13 — Validation gates

- `bun test` — full suite green (801+ tests).
- `bun run typecheck` — clean.
- `bun run report:design:web` — regenerate design report; visually diff each artboard against the Phase-0 baseline and against `design_guidelines/images_example/*.png`.
- Manual smoke (`bun start`):
  - Bridge: open 3 panes (human + agent + logs), confirm focus ring is the only glow; cycle with `Ctrl+h/j/k/l`.
  - Cockpit: 4-pane layout, HUD strip updates `tok/s` and `$` live from metadata poller.
  - Atlas: graph animates dashed cyan edge when an agent pane is active; ticker scrolls one full loop without jank.
  - Command palette: `⌘K` opens centred in Cockpit, left-aligned in Bridge.
  - Emoji + animation audit scripts pass in CI.
- §11 Do/Don't checklist walked manually with a screenshot recorder.

**Exit:** every bullet in §12 "Implementation checklist" answerable as "yes" for the three default layouts and each overlay.

### Phase 14 — Docs + PR

- `doc/design-tau-mux.md` — new subsystem doc explaining the token layer, primitives, variants, settings field, and bloom opt-in. Cross-link from `doc/design-report.md`.
- Update `CLAUDE.md`:
  - "Adding a settings field" snippet gains `layoutVariant` as an example.
  - New "Adding a chrome element" pattern pointing at `tau-primitives.ts`.
- PR titled **"τ-mux design system + Bridge/Cockpit/Atlas variants"** with before/after screenshots per variant and a rollback note (revert the Phase-1 commit).

**Exit:** PR open, CI green.

---

## File-level impact map

| File | Phase | Change kind |
|---|---|---|
| `src/views/terminal/index.css` | 1, 3, 5, 10, 12 | Rewrite :root, purge gradients/glass, add focus styles |
| `src/views/terminal/index.ts` | 3, 9 | Titlebar + variant mount |
| `src/views/terminal/tau-tokens.ts` | 1 | New |
| `src/views/terminal/tau-icons.ts` | 2 | New |
| `src/views/terminal/tau-primitives.ts` | 4 | New |
| `src/views/terminal/variants/bridge.ts` | 6 | New |
| `src/views/terminal/variants/cockpit.ts` | 7 | New |
| `src/views/terminal/variants/atlas.ts` | 8 | New |
| `src/views/terminal/sidebar.ts` | 10 | Variant-aware rewrite |
| `src/views/terminal/sidebar-manifest-card.ts` | 10 | Primitive-based |
| `src/views/terminal/surface-manager.ts` | 4, 5 | Focus id + primitive wiring |
| `src/views/terminal/command-palette.ts` | 10 | Primitive-based |
| `src/views/terminal/settings-panel.ts` | 9, 10 | Add Layout section |
| `src/views/terminal/process-manager.ts` | 10 | Primitive-based |
| `src/views/terminal/agent-panel*.ts` | 10 | Amber identity throughout |
| `src/views/terminal/browser-pane.ts` | 10 | Primitive-based |
| `src/views/terminal/telegram-pane.ts` | 10 | Primitive-based |
| `src/views/terminal/terminal-effects.ts` | 11 | Default off + scoped |
| `src/shared/types.ts` | 9 | `layoutVariant` field |
| `src/bun/rpc-handlers/system.ts` | 9 | `updateSettings` wiring |
| `src/bun/settings-manager.ts` | 9, 11 | Migration + validation |
| `electrobun.config.ts` | 2 | Font copy rules |
| `src/bun/web/asset-loader.ts` | 2 | Font vendor map |
| `assets/fonts/inter/*` | 2 | New bundled assets |
| `scripts/audit-emoji.ts` | 2 | New |
| `doc/design-tau-mux.md` | 14 | New |
| `CLAUDE.md` | 14 | Patterns added |

Files **not** touched: `design_guidelines/**` (read-only reference), `src/web-client/**` (out of scope), `tests-e2e/**` (unless a smoke needs a new selector).

---

## Risk register

- **Fonts + offline**: if a network-only font path slips through, the app silently falls back to system. Mitigation: bundle + `@font-face local()` block, plus a Phase-13 assertion that `getComputedStyle(document.body).fontFamily` starts with `Inter`.
- **Bloom migration footgun**: if we reset bloom to 0 naively we will surprise users who like it. Mitigation: one-shot migration that writes `bloomMigratedToTau: true` + preserves the old value under `legacyBloomIntensity` so "Restore previous" is one click.
- **Three variants × every overlay = combinatoric QA**. Mitigation: overlays render inside a shared `AppWindow` and should be layout-agnostic — verify each overlay under each variant only once in Phase 13.
- **Ticker animation + 60 fps**: `stroke-dashoffset` and `transform: translateX` both GPU-composited; avoid layout-thrash by not animating width.
- **Purple accent is load-bearing somewhere unexpected**: grep before Phase 1 commit; if it shows up in agent-panel identity, migrate to amber.

---

## Rollback plan

- Phase 0 tag `pre-tau-revamp` is the rollback anchor.
- Each phase is one PR-sized commit or a small stacked series; `git revert <phase-N>` walks backwards.
- The token rewrite (Phase 1) is the riskiest single change — keep it isolated so the revert is clean.
