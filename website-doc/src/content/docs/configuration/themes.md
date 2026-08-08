---
title: Themes
description: 12 built-in presets plus per-color overrides — the schema, the presets, and how to author your own.
sidebar:
  order: 3
---

τ-mux ships with 12 built-in theme presets and lets you override any color individually. Theme is global across all panes.

## Built-in presets

The `id` column is the value stored in the `themePreset` setting.

| Preset id | Name | Style |
|---|---|---|
| `tau` (default) | τ-mux | Dark, cyan accents — the house theme. |
| `graphite` | Graphite | Dark, neutral grey. |
| `obsidian` | Obsidian | Dark, blue accents. |
| `catppuccin-mocha` | Catppuccin Mocha | Dark, pastel. |
| `tokyo-night` | Tokyo Night | Dark, deep blue / purple. |
| `dracula` | Dracula | Dark, vibrant pink / cyan. |
| `nord` | Nord | Dark, cool blue. |
| `rose-pine` | Rosé Pine | Dark, dusty rose. |
| `gruvbox` | Gruvbox Dark | Dark, warm earth tones. |
| `solarized` | Solarized Dark | Dark, balanced contrast. |
| `synthwave` | Synthwave '84 | Dark, neon. |
| `everforest` | Everforest | Dark, soft green. |

Switch via **Settings → Theme**. The change applies live across all panes.

## Schema

```ts
interface ThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  accent: string;
  secondary: string;
  // ANSI 16
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}
```

All values are 6- or 8-character hex (`"#RRGGBB"` or `"#RRGGBBAA"`).

## Overrides

`themeOverrides` is a partial `ThemeColors` merged on top of the preset:

```json
{
  "themePreset": "obsidian",
  "themeOverrides": {
    "accent": "#a6e3a1",
    "background": "#0a0c12"
  }
}
```

Anything you don't override falls back to the preset.

## Quick overrides

The settings panel exposes three top-level fields outside `themeOverrides` for convenience:

- `accentColor` — primary accent (cursor, selection, focused chip border).
- `secondaryColor` — secondary accent.
- `foregroundColor` — terminal text.

These take precedence over the preset's own values but don't survive a preset change — switch presets, lose the override.

## Background opacity

`backgroundOpacity` (0.0–1.0) lets you make the terminal background semi-transparent. The Electrobun window itself has a solid black underlay, so opacity blends towards black rather than the desktop wallpaper.

## Authoring a new preset

There's no built-in "save preset as" yet. To add one in source:

1. Add a new entry to `THEME_PRESETS` in `src/shared/settings.ts`.
2. Add a label to the dropdown in `src/views/terminal/settings-panel.ts`.
3. Restart.

We accept PRs that follow the established naming convention (`<family>-<flavor>`).

## The `--ht-*` chrome token vocabulary

Above the user-facing theme schema sits a second layer: ~200 CSS custom properties (`--ht-*`) that every chrome surface in the app reads instead of inlining colour literals. The token vocabulary is the canonical surface for theming chrome (sidebar chrome, pane bar, agent panel, telegram pane, web mirror, …) — `audit:theming` keeps the cluster honest by failing CI on any new hard-coded colour literal in `src/views/terminal/index.css` or `src/web-client/client.css`.

The vocabulary is defined in `src/shared/web-theme-tokens.css` and grouped by family:

| Family | Purpose |
|---|---|
| `--ht-vnext-*` | Post-Phase-6 redesign palette — text scale (mute / muted / soft / bright / emph), surface chrome (surface-bg, surface-shadow, surface-bar-bg), status colours (port green, close-btn peach), sheet/dialog shells, segment-active fg. |
| `--ht-agent-*` | pi-agent panel — toolbar, badges (extension / scope), dropdowns, code/think/tool-call states (rest / run / err / ok / inline), msg bubbles (user-grad-top/-bot, system-bg), slash menu, confirm dialog, input bar (attachment / kbd / focus), status chips (status / tool / streaming / queue). |
| `--ht-window-*` | Window-theme shell — titlebar, sidebar, surface, surface-bar, modal overlay, toast, the t3 override solids. |
| `--ht-sidebar-v2-*` | Sidebar v2 — log row state colours (warning / info), global-stats row, workspace script-btn dot glows + state bgs, server-dot status palette (online / starting / error / conflict glows + conflict fg), dismiss hover tint. |
| `--ht-telegram-*` | Telegram pane — toolbar, input, message in/out, accent, send glow, status pills, failed-msg badge. |
| `--ht-web-*` | Web mirror exclusive — status dot glows (error / success / warning), surface-bar gradient, sidebar drawer chrome, sidebar-notification purple-pulse, WM overlay / card / close / flag / pill / kbd palette, telegram extras, tau-meter glow trio. |
| `--ht-contrast-*` | `@media (prefers-contrast: more)` accessibility bumps — brighter cyan border alphas. |
| `--ht-sem-*` | Semantic palette — `--ht-sem-success` (`#4ade80`), `--ht-sem-error` (`#f87171`), `--ht-sem-warning` (`#f59e0b`), plus per-tint `*-tint` variants. |
| `--ht-on-accent-fg` | Foreground colour that paints labels on top of an `--accent-primary` fill (e.g. segmented "active" state, prompt-btn-primary). |
| `--ht-badge-*`, `--ht-script-*`, `--ht-pm-*`, `--ht-palette-*`, `--ht-notify-*` | Subsystem-specific palettes for badges, scripts, the Process Manager, the command palette, and notifications. |

Cross-component reuse follows two rules:

1. **Exact RGB match → reuse.** A new region picking the same alpha + RGB as an existing token must reuse rather than mint a duplicate. The cluster's strongest single-block demo (the t3 window override, 13 literals to zero new tokens) is a pure-reuse pass.
2. **≤ 3 percentage-point alpha delta → harmonise.** A new region within 3pp alpha of an existing token reuses with a note. This intentionally collapses tiny variations onto a single token so a palette swap repaints them coherently.

### Theming chrome at runtime

Themes override colour tokens by defining `--ht-*` values inside their selector block. The default tokens live under `:root`; high-contrast and forced-colors media queries override a curated subset:

```css
@media (prefers-contrast: more) {
  :root {
    --tau-border:        var(--ht-contrast-border-cyan);
    --tau-border-strong: var(--ht-contrast-border-cyan-strong);
  }
}

@media (forced-colors: active) {
  :root {
    --tau-cyan:        Highlight;
    --tau-text-strong: ButtonText;
    --tau-text-mute:   GrayText;
    --tau-ok:          Highlight;
  }
}
```

Custom user themes can supply their own `--ht-*` overrides by injecting CSS into the webview, but this surface is not yet wired through Settings — for now, theme switching only affects the user-facing `ThemeColors` schema.

## Read more

- [Observability](/development/observability/) — `audit:theming` script that guards the token vocabulary.
- [Settings](/configuration/settings/)
- [Source: `src/shared/settings.ts`](https://github.com/TheSamLePirate/TauMux/blob/main/src/shared/settings.ts)
- [Source: `src/shared/web-theme-tokens.css`](https://github.com/TheSamLePirate/TauMux/blob/main/src/shared/web-theme-tokens.css) — every `--ht-*` token with inline rationale comments.
