---
title: Thèmes
description: 10 préréglages intégrés plus surcharges par couleur — le schéma, les préréglages et comment créer le vôtre.
sidebar:
  order: 3
---

τ-mux est livré avec 10 préréglages de thème intégrés et permet de surcharger n'importe quelle couleur individuellement. Le thème est global à tous les panneaux.

## Préréglages intégrés

| Préréglage | Style |
|---|---|
| `obsidian` (défaut) | Sombre, accents bleus. |
| `catppuccin-mocha` | Sombre, pastel. |
| `tokyo-night` | Sombre, bleu profond / violet. |
| `dracula` | Sombre, rose / cyan vibrant. |
| `nord` | Sombre, bleu froid. |
| `rose-pine` | Sombre, rose poussiéreux. |
| `gruvbox-dark` | Sombre, tons terreux chauds. |
| `solarized-dark` | Sombre, contraste équilibré. |
| `synthwave-84` | Sombre, néon. |
| `everforest` | Sombre, vert doux. |

Changez via **Settings → Theme**. Le changement s'applique en direct à tous les panneaux.

## Schéma

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

Toutes les valeurs sont en hexadécimal sur 6 ou 8 caractères (`"#RRGGBB"` ou `"#RRGGBBAA"`).

## Surcharges

`themeOverrides` est un `ThemeColors` partiel fusionné par-dessus le préréglage :

```json
{
  "themePreset": "obsidian",
  "themeOverrides": {
    "accent": "#a6e3a1",
    "background": "#0a0c12"
  }
}
```

Tout ce que vous ne surchargez pas retombe sur le préréglage.

## Surcharges rapides

Le panneau de paramètres expose trois champs de premier niveau en dehors de `themeOverrides` pour la commodité :

- `accentColor` — accentuation primaire (curseur, sélection, bordure de puce focalisée).
- `secondaryColor` — accentuation secondaire.
- `foregroundColor` — texte du terminal.

Ces valeurs ont préséance sur celles du préréglage mais ne survivent pas à un changement de préréglage — changer de préréglage fait perdre la surcharge.

## Opacité de l'arrière-plan

`backgroundOpacity` (0.0–1.0) vous permet de rendre l'arrière-plan du terminal semi-transparent. La fenêtre Electrobun elle-même a un fond noir uni en dessous, donc l'opacité se mélange vers le noir plutôt que vers le fond d'écran du bureau.

## Création d'un nouveau préréglage

Il n'y a pas encore de fonctionnalité « enregistrer en tant que préréglage » intégrée. Pour en ajouter un dans la source :

1. Ajoutez une nouvelle entrée à `THEME_PRESETS` dans `src/shared/settings.ts`.
2. Ajoutez un libellé à la liste déroulante dans `src/views/terminal/settings-panel.ts`.
3. Redémarrez.

Nous acceptons les PR qui suivent la convention de nommage établie (`<famille>-<saveur>`).

## Pour aller plus loin

- [Paramètres](/fr/configuration/settings/)
- [Source : `src/shared/settings.ts`](https://github.com/TheSamLePirate/TauMux/blob/main/src/shared/settings.ts)
