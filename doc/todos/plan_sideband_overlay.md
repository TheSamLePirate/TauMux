# Plan 04 — Sideband overlay always visible (focus transparency bug)

## Source quote

> # Sideband view:
> - It must allways be visible on top of the terminal even if the
>   terminal is not focused, now sometimes, it is transparent when not
>   focused

## Bug summary

Floating canvas / HTML / SVG panels rendered through the sideband
protocol (fd 4) sometimes go transparent or disappear when their host
pane loses focus. Expected: panels stay fully opaque on top of the
terminal regardless of focus.

## Investigation plan

The transparency only kicks in "sometimes", which suggests one or
more of:

1. CSS rule `.surface-container:not(.focused) .panel { opacity: 0.x }`
   or similar.
2. Panel z-index falling below an absolutely-positioned focus overlay
   when focus moves.
3. xterm.js webgl renderer being torn down on blur and the canvas
   compositing breaks.
4. PanelManager pruning panels on `blur` events (e.g.
   `surfaceUnmounted` accidentally fired on focus change).

### Reproduction protocol

1. Run `bun start`.
2. Spawn two terminals side-by-side.
3. In left pane: `bun run scripts/demo_clock.ts` (a sideband HTML
   widget that floats).
4. Click into the right pane.
5. Observe whether the clock panel dims / disappears.
6. If not reproducible, try `demo_canvas_life.ts` /
   `demo_canvas_particles.ts` (canvas2d), then SVG demos.

### Likely culprits to grep

```sh
rg "opacity" src/views/terminal/index.css     # stale focus rule?
rg "blur|focusout" src/views/terminal/        # blur handlers
rg "pointer-events" src/views/terminal/index.css
rg "data-focused|--focused" src/views/terminal/
```

Inspect `panel.ts` and `panel-manager.ts` for any `focus` listeners
that change panel `style.opacity` or `style.display`.

## Fix dimensions

### Definitely

- A panel's visibility must depend only on:
  - whether its source surface is mounted (fd4 producer alive)
  - explicit `panel.hide()` / `panel.show()` from the script
  - workspace switch (panels of inactive workspaces are hidden by
    `display: none` per `applyLayout`)

It must **not** depend on focus state.

### Probably

- z-index ordering: panels live at `--z-panel-*` (somewhere in the
  10000s); ensure no overlay (chip flyouts, focus ring, hover badge)
  uses a higher z-index that paints translucently above panels.
- Pointer-events: panels with `interactive: true` need pointer-events
  enabled regardless of pane focus, since clicking a panel should not
  require the pane to be focused first.

### Possibly

- A blur-driven xterm `refresh` ends up wiping the underlying canvas's
  alpha channel and the panel's transparency model layers wrong.

## Implementation steps

1. Reproduce + capture a video / screenshot at the moment of failure.
2. Enable Electrobun devtools; inspect computed styles on the panel
   div before vs after focus change.
3. Identify the offending rule / handler.
4. Patch:
   - If CSS — drop or scope the rule to `.surface-container:not(.focused) .focus-ring`
     so it only dims focus chrome, not panel content.
   - If JS — remove the blur listener; ensure
     `PanelManager.refreshAll()` is idempotent w.r.t. focus events.
5. Add a regression test:
   - In `tests/panel-focus.test.ts`, mount a panel, fire a synthetic
     focus change to a different surface, assert
     `getComputedStyle(panel).opacity === "1"` and `display !== "none"`.
6. Manual verification: re-run reproduction protocol; confirm panel
   stays solid.

## Out of scope

- Hover-to-fade behaviour (some users want it). If we want it later,
  add a `panelDimWhenUnfocused: boolean` setting (default false).
- Z-index re-architecture. Touch only what's broken.

## Files (predicted)

- `src/views/terminal/index.css` — likely fix
- `src/views/terminal/panel-manager.ts` — verify no blur side-effects
- `src/views/terminal/panel.ts` — verify

## Effort

S — once reproduced, the fix is usually a one-line CSS change. Allow
half a day with the regression test.

## Risks

Bug-hunting work — risk is "cannot reproduce". Mitigation: ask the
user to capture exact reproduction (which demo, which focus
transition, what monitor / theme). The plan should include adding
explicit panel-vs-focus assertions to the design report so the next
regression is caught automatically.
