# τ-mux — Design Guidelines

> A macOS multiplexer where **agents and humans share the same room**.
> This document freezes the visual system and three layout variants
> (Bridge / Cockpit / Atlas) into implementable rules.
> Claude Code: read this file front-to-back before touching any pixel.
> When in doubt, prefer **less chrome, more terminal**. The TUI content is
> sacred — we own the shell around it.

---

## 0 · Core principles (read first)

1. **The terminal content is uncontrolled.** We never redraw what the user's
   TUI prints. We design the *frame*: window chrome, tabs, sidebar, status
   bars, command bar, focus indicator, transitions.
2. **Black is a material, not a background.** The outer window is pure
   `#000` / `#07090b`. Panels are lifted by one small step, never by
   gradients or glassmorphism.
3. **One accent, one signal.** Cyan = humans + focus + system identity.
   Amber = agents. Never introduce a third accent colour for a new feature;
   reuse spacing, weight, or typography instead.
4. **Focus is the only loud state.** Only the focused pane glows. Everything
   else is at rest. No hover animations on non-interactive chrome.
5. **No decorative geometry.** No dotted borders, no illustrated icons, no
   gradients, no skeuomorphism. Every line is a 0.5–1 px functional border.
6. **Monospace for data, sans for chrome.** See §2.
7. **No emoji. Ever.** Use the tokenised SVG icon set (§6).

---

## 1 · Colour tokens

Use these exact values. Do **not** introduce new ones. If you need a new
shade, derive it from an existing token via opacity.

```ts
const TAU = {
  // Surface
  void:          '#000000',   // pure black — terminal body bg, rails
  bg:            '#07090b',   // window background
  panel:         '#0b1013',   // default pane chrome
  panelHi:       '#0f161a',   // pane header when focused, inputs
  panelEdge:     '#1a2328',   // 1 px hairline border
  panelEdgeSoft: '#121a1e',   // sub-hairline / internal divider

  // Text
  text:          '#d6e2e8',   // primary
  textDim:       '#8a9aa3',   // secondary
  textMute:      '#55646c',   // tertiary / labels
  textFaint:     '#38434a',   // disabled / separators

  // Accent — cyan (logo glow)
  cyan:          '#6fe9ff',
  cyanSoft:      '#33b8d6',
  cyanDim:       'rgba(111,233,255,0.18)',   // backgrounds
  cyanGlow:      'rgba(111,233,255,0.55)',   // shadows

  // Agent identity — warm amber
  agent:         '#ffc56b',
  agentSoft:     '#d59a45',
  agentDim:      'rgba(255,197,107,0.14)',

  // States
  ok:            '#8ce99a',
  warn:          '#ffc56b',   // same hue as agent — intentional
  err:           '#ff8a8a',

  // macOS traffic lights
  tlRed: '#ff5f57', tlYel: '#febc2e', tlGrn: '#28c93f',
};
```

### Semantic mapping

| Meaning | Token |
|---|---|
| App identity, system, focus | `cyan` |
| Human session | `cyan` |
| Agent session | `agent` |
| Running / success | `ok` |
| Idle / waiting | `warn` / `agent` |
| Error / destructive | `err` |
| Pane body background | `void` |
| Pane chrome background | `panel` |
| Hairline | `panelEdge` |

**Never** use cyan for an agent pane, or amber for a human one. The colour
IS the identity.

---

## 2 · Typography

Two families only:

- **Inter** (400 / 500 / 600 / 700) — chrome, titles, labels
- **JetBrains Mono** (400 / 500 / 600 / 700) — terminals, data, identifiers,
  paths, tokens, any numeric value

Load via Google Fonts; no third family is permitted.

### Sizes (px) — tight scale, do not invent new steps

| Use | Size | Weight | Family |
|---|---|---|---|
| Window title | 12.5 | 600 | Inter |
| Pane title / tab | 11.5 | 600 | Inter |
| Tab label (inactive) | 11.5 | 500 | Inter |
| Status bar | 11 | 400–500 | JetBrains Mono |
| Terminal body | 11.5 | 400 | JetBrains Mono |
| HUD strip | 10.5 | 400–700 | JetBrains Mono |
| Uppercase micro-label | 10 | 700, `letter-spacing: 1.5` | Inter |
| Sidebar workspace name | 12.5 | 600 | JetBrains Mono |
| Branch chip | 9.5 | 600 | JetBrains Mono |
| Big display (intro) | 42 | 700, `letter-spacing: -1` | Inter |

**Line heights:** 1.05 for display, 1.5–1.6 for everything else.

**Never** use Inter for a value that could be pasted into a terminal (paths,
tokens, counts, branch names, model names). Those are always Mono.

---

## 3 · Spacing, radius, borders

- Grid unit: **4 px**. All paddings/gaps are multiples of 4.
- Pane radius: **8 px**. Window radius: **12 px**. Chips/badges: **3 px**.
  Buttons: **4–6 px**. No radius larger than 12 anywhere.
- Borders: **0.5 px** on Retina (`border: 0.5px solid`). Use 1 px only for
  emphatic dividers (status bar top edge).
- Shadows: avoid. Only the **focused pane** and the **outer window** get
  shadows. Both are specified in §4.

---

## 4 · Focus indicator (the only loud state)

The focused pane is the *only* element in the UI with a glow. This is how
the user locates their cursor across 3–6 panes.

```css
.pane { border: 0.5px solid var(--panelEdge); }
.pane--focused-human {
  border-color: var(--cyan);
  box-shadow: 0 0 0 0.5px var(--cyan), 0 0 24px var(--cyanDim);
}
.pane--focused-agent {
  border-color: var(--agent);
  box-shadow: 0 0 0 0.5px var(--agent), 0 0 24px var(--agentDim);
}
```

Additionally:
- The pane-header background shifts from `panel` → `panelHi`.
- The identity dot at the top-left of the pane gains a `box-shadow` glow of
  the same colour.

**Nothing else glows.** Not buttons, not tabs, not links. If you feel the
urge to add a glow, re-read §0.

---

## 5 · The window shell

Every variant uses the same outer `AppWindow`:

```
┌──────────────────────────────────────────────────────────┐
│ ● ● ●   τ  τ-mux        [toolbar slot]                   │  38 px title bar
├──────────────────────────────────────────────────────────┤
│                                                          │
│                   [content slot]                         │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ [status bar slot]                                        │  26 px
└──────────────────────────────────────────────────────────┘
```

- Title bar: 38 px, gradient `#0d1317 → #0a0e11`, hairline divider below.
- Traffic lights: standard 12 px red/yellow/green with 8 px gap. **Keep
  stock.** Never recolour or restyle them.
- App identity: pixel-τ SVG logo (14 px) + "τ-mux" word-mark (12.5 px, 600),
  followed by an em-gap then the toolbar.
- Corner radius: 12 px; outer drop-shadow `0 30px 80px rgba(0,0,0,.55)`;
  inner hairline `0 0 0 0.5px #1a2328`.

---

## 6 · Icons

**All icons are geometric SVG primitives** — rectangles, circles, short
strokes. Never draw illustrated or organic icons. The approved set:

| Name | Shape |
|---|---|
| `split` | square with vertical divider |
| `grid` | 2×2 squares |
| `agent` | circle with inner dot |
| `human` | head + shoulders abstract |
| `plus` | `+` stroke |
| `git` | three nodes + connecting strokes |
| `spark` | 4-point star |
| `tau` | the pixel-T logo |

Icon sizes: 10, 11, or 14 px. Stroke weight 0.7–0.9 px. Colour = `currentColor`.
If you need a new icon, **keep it to ≤ 12 strokes/rects and no curves that
aren't circles or arcs**.

### The pixel-τ logo

The τ is a hand-tuned 10×10 pixel grid, rendered as `<rect>` elements. It is
**never** a raster image. The glow is a CSS `drop-shadow` filter:
`drop-shadow(0 0 6px cyanGlow) drop-shadow(0 0 2px cyan)`.

---

## 7 · Agent vs human — the identity rule

Anywhere a session is represented, it **must** carry a colour signal:

- **Human session** → cyan dot / cyan text accents / cyan tab badge.
- **Agent session** → amber dot / amber text accents / amber tab badge.
- Mixed workspace → white dot, no accent.

Shapes are identical between the two. The signal is *only* colour + an
optional `AGENT` / `HUMAN` label in the HUD (Cockpit variant).

Rationale: users must, at a glance, know which cursor is theirs and which
is a robot's.

---

## 8 · Shared primitives

All three variants use these same components. Do not fork them.

### 8.1 `Pane`

```
┌─────────────────────────────────────────────┐
│ ● Tab A  Tab B  Tab C        ⌗  ◱  ×        │  28 px header
├─────────────────────────────────────────────┤
│                                             │
│          terminal body (uncontrolled)       │
│                                             │
└─────────────────────────────────────────────┘
```

- Header: 28 px, 10 px horizontal padding, 8 px gap.
- Identity dot: 7 px, left-most. Cyan or amber. Glows if focused.
- Tabs: 3 × 10 px padding, radius 5, active = `panelHi` bg + 600 weight.
- Tab badge (optional): 9.5 px Mono, 0.5 px border, 3 px radius; carries
  branch name, model name, or a short status like `editing`, `+18 −2`.
- Action row on the right: 18×18 icon buttons, flat unless active.
- Body: absolutely positioned, `void` background, scrollable.

### 8.2 `CommandBar` (⌘K)

Always present in the toolbar slot unless explicitly suppressed. 26 px tall,
max 520 px wide, centred or left-aligned per variant.

```
┌─⌘K─────────────────────────────────────────τ─┐
│  Run command, switch pane, attach agent…    │
└─────────────────────────────────────────────┘
```

- Left: `⌘K` kbd hint in Mono 11, `textMute`.
- Middle: placeholder copy in Inter 12, `textDim`.
- Right: single `τ` glyph in cyan, serving as the brand mark.

### 8.3 `StatusBar`

26 px, Mono 11, `textDim`. Items separated by middle dots (`·`,
`textFaint`). Zones from left to right:

1. **Identity** — session label, pane count
2. **Usage meters** — `label value meter` clusters (see §8.4)
3. *(flex spacer)*
4. **Cost / model** — dollars today, model name, verbosity

### 8.4 `Meter`

4 px tall, 50 px wide by default. Background `panelEdge`, fill in the
meter's semantic colour (`ok` / `warn` / `err`), with a matching glow.
Always paired with a numeric label; never stand-alone.

### 8.5 `BranchChip`

9.5 px Mono 600 on `rgba(111,233,255,0.08)` with a 0.5 px cyan-dim border
and 3 px radius. Used on sidebar workspace rows and in tab badges.

### 8.6 `WorkspaceCard` (sidebar)

```
● τ-mux                              [module]
├ ● claude-code  •
├ ● lazygit
└ ● zsh
tau-mux v0.1.2
```

- 8–10 px padding; 8 px radius; transparent bg, `panelHi` when active.
- Session list uses box-drawing characters (`├`, `└`) in `textFaint`.
- A small pulsing `ok` dot appears next to a running session.
- The directory/version line is Mono 10.5, `textMute`, below the sessions.

---

## 9 · The three variants

Implement **all three** as switchable layouts under the same `AppWindow`.
Users pick one; the choice persists in `localStorage`.

### 9.1 Bridge — refined current

The respectful refinement. Use as the default.

```
┌──window chrome─────────────────────────────────┐
│ ●●●  τ  τ-mux  [⌘K…]  [Workspace 01|02|03]  ⌗  │
├─────────┬──────────────────┬───────────────────┤
│ SIDEBAR │   Pane A        │   Pane B          │
│ 240 px  │   lazygit       │   opencode (focus)│
│         ├──────────────────┴───────────────────┤
│         │   Pane C — τ-mux logs (wide)         │
├─────────┴──────────────────────────────────────┤
│ [status bar with Codex / Week meters / $]      │
└────────────────────────────────────────────────┘
```

Rules specific to Bridge:
- Sidebar width: **240 px**, never collapsible in this variant.
- Top-right contains a **workspace switcher** segmented control (3 pills,
  active has 0.5 px cyanDim border).
- Pane split: 1 large terminal pane on top-right, 1 utility pane top-left
  (lazygit / logs), 1 wide pane along the bottom.
- Inner padding of the pane area: **6 px**, gap between panes **6 px**.

### 9.2 Cockpit — icon rail + HUD

Denser. Sidebar becomes a 52 px icon rail. Every pane gets a 22 px HUD
strip between header and body showing `KIND · model · state · tok/s · $ · Δ`.

```
┌──window chrome─────────────────────────────────┐
│ ●●●  τ  τ-mux · cockpit   [⌘K centred]   ⌕ ◉ ⚙│
├──┬─────────────────────┬────────────────────────┤
│τ │   Pane A            │   Pane B               │
│T │   ┌─HUD──────────┐  │   ┌─HUD──────────┐    │
│T │   │ HUMAN · zsh  │  │   │ AGENT · CC   │    │
│T │   └──────────────┘  │   └──────────────┘    │
│M │   lazygit           │   diff (editing)      │
│R ├─────────────────────┼────────────────────────┤
│t │   Pane C            │   Pane D               │
│  │   opencode          │   tau-mux logs         │
├──┴─────────────────────┴────────────────────────┤
│ [status bar with palette hints, cost]          │
└────────────────────────────────────────────────┘
```

Rules specific to Cockpit:
- **Icon rail 52 px**, pure `void` bg. One 22 px τ-mark at top, hairline
  divider, then 36×36 workspace buttons (8 px radius, 0.5 px cyanDim border
  when active). A small pulsing amber dot on any workspace with a running
  agent.
- **HUD strip** (22 px, Mono 10.5):

  `AGENT · sonnet-4.5 · ● running         142 tok/s   $0.81   Δ +34 −18`

  - Left: uppercase `AGENT` / `HUMAN` in the identity colour, 700 weight.
  - Middle-left: model name in Mono `text`.
  - Middle: state (`running` / `waiting` / `idle` / `streaming`) with a
    colour-coded dot; `running` pulses.
  - Right: metrics. Rules:
    - `tok/s`: integer, never shown for humans.
    - `$`: always 2 decimals, USD.
    - `Δ`: two numbers, green `+`, red `−`.
- Up to **4 panes** supported (2×2 or 2+2). No bottom pane overflow.
- Toolbar command bar is **centred**, not left-aligned.

### 9.3 Atlas — graph + ticker

Radical. Replace the list sidebar with a **workspace graph** and add a
bottom activity **ticker**.

```
┌──window chrome─────────────────────────────────┐
│ ●●●  τ  τ-mux · atlas   [⌘K]      ⌘\ ⌘G       │
├──────────┬──┬───────────────────────────────────┤
│  GRAPH   │T │   Pane A (tall, focused)         │
│  220 px  │a │   claude-code editing            │
│          │b │                                  │
│   ● repo │R ├───────────────────────────────────┤
│   ● agent│a │   Pane B                          │
│   ● tool │i │   opencode                       │
│   ─ edge │l │                                  │
│          │  │                                  │
├──────────┴──┴───────────────────────────────────┤
│ τ TICKER │ ● CC edit +18 −2 │ ● codex waiting…│
└────────────────────────────────────────────────┘
```

Rules specific to Atlas:
- **Graph column 220 px**, `void` bg with a 20 px faint grid pattern.
- Nodes: 4.5 px radius default, 6 px + coloured fill when active, animated
  12 px pulsing halo when `running`. Label placed 10 px to the right in
  Mono 10.
- Edges: `panelEdge` at rest (0.6 px); active edges become dashed cyan
  (`3 3`, 1 px, 0.55 opacity) with a `stroke-dashoffset` animation from
  `0` → `-6` at 0.6 s linear infinite.
- Node colours: repo = `text`, agent = `agent`, tool = `textDim`,
  self (τ-mux) = `cyan`.
- A small info card pinned to the bottom-left of the graph shows the
  currently focused node: name (bold), last action, model.
- **Tab rail** between graph and panes: 36 px wide, 26×26 tab chips with
  two-letter mnemonics (`CC`, `OC`, `LZ`, `CX`, `ZS`). Active chip glows
  in its identity colour. A small green dot top-right on any running tab.
- **Activity ticker**: 32 px tall, replaces the normal status bar.

  `[τ TICKER]  ● CC edit src/chrome.jsx +18 −2 │ ● codex review waiting │ ● you lazygit staged 1 │ ✓ opencode built 4.2s   [codex 86% ▓▓ week 13% ▓ $0.809]`

  - Left block: cyan `τ` + `TICKER` label on `void`, hairline divider.
  - Middle: event stream, pipe-separated, events colour-coded by actor.
  - Right block: condensed meters + cost, hairline divider.

---

## 10 · Interaction rules

- **Focus follows click** on any pane header. Only one pane is focused at
  a time. Keyboard: `Ctrl+h/j/k/l` moves focus.
- **⌘K** opens the command palette everywhere.
- **⌘⇧P** opens the agent palette (filtered to agents).
- **⌘\\** collapses the sidebar/rail/graph (Cockpit + Atlas).
- **⌘G** toggles graph view (Atlas).
- Tab switching inside a pane: `Ctrl+Tab` / `Ctrl+⇧+Tab`.
- **No hover effects on decorative chrome.** Hover only applies to:
  - interactive buttons (subtle `rgba(0,0,0,0.06)` bg)
  - workspace cards in the sidebar (`panelHi` bg)
  - tabs (cursor only)
- Animations: reserved for *state*, not ornament. Allowed:
  - `tauBlink` — 1.1 s on cursors
  - `tauPulse` — 1.4 s on running session dots
  - `tauGlowPulse` — on the τ logo when τ-mux itself is processing
  - dashed-edge offset — on live graph edges in Atlas
  - ticker scroll — linear, 60 s loop
  Nothing else animates.

---

## 11 · Do / Don't quick reference

### ✅ Do

- Use Mono for every terminal-paste-able value.
- Use cyan for humans and focus; amber for agents.
- Keep borders at 0.5 px hairline.
- Put exactly one glowing element on screen: the focused pane.
- Use box-drawing characters (`├ └ ▾ ▸ @@ ─`) for tree/diff structure.
- Recreate the τ logo from `<rect>` elements, never as a raster.
- Round to 4 px on spacing, 8 px on pane radius, 12 px on window radius.

### ❌ Don't

- Don't introduce a third accent colour.
- Don't use gradients on panels (title bar is the only exception).
- Don't apply `backdrop-filter`. This is a dark app, not Liquid Glass.
- Don't use emoji, illustrated icons, or photographic imagery.
- Don't glow anything other than the focused pane and running indicators.
- Don't recolour the macOS traffic lights.
- Don't add dotted borders — they're what the old design got wrong.
- Don't exceed 12 px radius anywhere.
- Don't use Inter for paths, model names, branch names, or diff counts.
- Don't redraw the terminal content. You don't own it.

---

## 12 · Implementation checklist

When adding a new feature, verify **in this order**:

1. Does it fit inside an existing primitive (`Pane`, `CommandBar`,
   `StatusBar`, `WorkspaceCard`, `BranchChip`, HUD)? If not, *should* it?
2. Is every value coloured per §7 and §1?
3. Is every number / path / token rendered in JetBrains Mono?
4. Does any element glow other than the focused pane? If yes, remove.
5. Are borders 0.5 px? Radii 8/12? Spacing multiples of 4?
6. Is there a hover or animation that isn't covered by §10? Remove.
7. Does the feature work in **all three** variants (Bridge, Cockpit, Atlas)?
   If not, pick the variants it belongs in and document why.

---

## 13 · File / component map (reference)

```
index.html                       shell + font loading + script order
src/tokens.jsx                   TAU palette, keyframes (source of truth)
src/chrome.jsx                   AppWindow, Pane, TrafficLights, TauLogo,
                                 CommandBar, StatusBar, Meter, IconBtn,
                                 SidebarSection, WorkspaceCard, BranchChip, Ico
src/mock-data.jsx                TUI body mocks (lazygit, opencode, codex,
                                 diff, claude-code, zsh) + WORKSPACES seed
src/variant-bridge.jsx           layout A
src/variant-cockpit.jsx          layout B
src/variant-atlas.jsx            layout C
src/app.jsx                      canvas mount
```

Any new primitive goes in `chrome.jsx` and must export via `Object.assign(window, {...})`.
Variant-specific widgets (HUD, Graph, TabRail, Ticker) live in their variant file.
