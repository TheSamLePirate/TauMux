# Phase 5 — Theme system

**Parent plan:** `00_master_plan.md`
**Tracking doc:** `doc/tracking_feature_upgrade_to_AAA_phase5.md`
**Status:** In progress — started 2026-05-16.
**Owner:** webview.
**Engineer-weeks:** ~2.0 (medium-low confidence).
**Lifts:** Tau primitives A→S, Terminal effects A→S, Settings panel A→S (with the reset-to-default UI), Notifications + Native menus → bonus A→S as theme tokens land.

---

## Discovery

The token system already exists at `src/shared/web-theme-tokens.css` (84 lines, exhaustive Graphite palette). Native + mirror both import it. The Phase 5 plan's "token layer reorg" step is therefore mostly done — Phase 5 is layering Light + High-Contrast themes on top, plus the reduced-motion JS guard for the canvas-based effects layer.

---

## Steps

### Step 1 — Reduced-motion JS guard for terminal-effects

The Phase 0 CSS blanket (`@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.001ms !important; … } }`) catches every CSS animation. But `terminal-effects.ts` runs its own RAF loop on a `<canvas>` element; CSS doesn't reach it. A user who set "reduce motion" in their OS still sees pulse rings on every keystroke.

Fix: listen to `matchMedia("(prefers-reduced-motion: reduce)")` at constructor time, flip `available` to false if it's set, and re-evaluate on the matchMedia `change` event.

Tests: extend `tests/terminal-effects.test.ts` with a matchMedia stub.

### Step 2 — `audit:theming` script

Scan CSS for hard-coded colour literals outside the token block in `web-theme-tokens.css`. Fail on any hex / rgb() / hsl() that didn't come from a `var(--ht-…)` reference.

A regression — adding a `color: #ff00ff` to a component CSS — should fail loudly. This is the same shape as the existing `audit:emoji` / `audit:animations` scripts; live alongside them as `bun run audit:theming`.

### Step 3 — Light + High-Contrast theme tokens

Add two alternate token blocks to `web-theme-tokens.css`:

```css
:root[data-theme="graphite-light"] {
  --ht-bg-window: #fafafa;
  --ht-bg-shell: #f4f4f5;
  …every other token, light-mode value…
}

:root[data-theme="high-contrast"] {
  --ht-bg-window: #000;
  --ht-text-strong: #fff;
  --ht-border-bright: #fff;
  …
}
```

Every token in the dark block gets an override in both light + HC. The values are derived from the existing Graphite Dark palette by careful colour-space mapping (not eye-balling).

### Step 4 — Theme setting + switcher

Add `settings.theme: "system" | "graphite-dark" | "graphite-light" | "high-contrast"` (default `"system"`). Apply via `documentElement.dataset.theme`. On `"system"`, read `matchMedia("(prefers-color-scheme: light)")` and pick `graphite-light` vs `graphite-dark`; live-update on the `change` event.

`forced-colors: active` (Windows High-Contrast) automatically picks the high-contrast theme via a CSS media-query block.

Settings UI: a select control in the Appearance section.

### Step 5 — Deferred to P8: visual baselines per theme

`bun run report:design` currently captures one screenshot set. Capturing three (Dark + Light + HC) and gating against all three needs the live Playwright environment + design-report pipeline that lands in P8. Documented as a P8 handoff.

---

## Per-step acceptance criteria

| Step | Acceptance |
|---|---|
| 1 | terminal-effects honours `prefers-reduced-motion: reduce` at construction + on change. Test verifies the behaviour under a stubbed matchMedia. |
| 2 | `bun run audit:theming` exits 0 on the current codebase; introducing a `#xxx` outside the token block fails. |
| 3 | Both new `:root[data-theme=…]` blocks exist and cover every token from the dark block. |
| 4 | Settings has a `theme` field; selecting a non-default value flips `documentElement.dataset.theme`. |
| 5 | Documented handoff to P8. |

---

## Lifts to track in `feature_grades.json`

- `tau-primitives` A → S (light mode + HC palette + tokens documented).
- `terminal-effects` A → S (reduced-motion guard closes the last gap).
- `settings-panel` stays at A (the `reset-to-default` and `aria-invalid` polish items are P7).
- `notifications` and `native-menus` stay at A (their B→A lifts already covered the design tokens; light/HC are bonus for them).

---

## Open questions

1. **High-contrast colour values** — WCAG 7:1 contrast ratio target across every text/background pair. The palette derivation needs care; bad colours are worse than no HC mode.
2. **System theme detection on native** — Electrobun exposes `prefers-color-scheme` via the webview's matchMedia; no special bridge needed.
3. **Persist `dataset.theme` across reload** — applied at boot from `settings.theme` (loaded before any UI mounts).

---

## Exit criteria

- All three themes selectable via Settings.
- `audit:theming` passes.
- Terminal effects honours reduced-motion.
- `bun test` green; `bun run report:feature-grades:check` green.
- Visual baselines per theme: explicit P8 handoff documented.
