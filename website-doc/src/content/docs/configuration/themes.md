---
title: Themes
description: 10 built-in presets plus per-color overrides — the schema, the presets, and how to author your own.
sidebar:
  order: 3
---

τ-mux ships with 10 built-in theme presets and lets you override any color individually. Theme is global across all panes.

## Built-in presets

| Preset | Style |
|---|---|
| `obsidian` (default) | Dark, blue accents. |
| `catppuccin-mocha` | Dark, pastel. |
| `tokyo-night` | Dark, deep blue / purple. |
| `dracula` | Dark, vibrant pink / cyan. |
| `nord` | Dark, cool blue. |
| `rose-pine` | Dark, dusty rose. |
| `gruvbox-dark` | Dark, warm earth tones. |
| `solarized-dark` | Dark, balanced contrast. |
| `synthwave-84` | Dark, neon. |
| `everforest` | Dark, soft green. |

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

## Read more

- [Settings](/configuration/settings/)
- [Source: `src/shared/settings.ts`](https://github.com/TheSamLePirate/TauMux/blob/main/src/shared/settings.ts)
