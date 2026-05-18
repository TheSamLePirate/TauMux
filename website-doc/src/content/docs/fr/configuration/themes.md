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

## Le vocabulaire de tokens de chrome `--ht-*`

Au-dessus du schéma de thème visible par l'utilisateur se trouve une seconde couche : ~200 propriétés CSS personnalisées (`--ht-*`) que chaque surface de chrome dans l'app lit au lieu d'inlinéner des littéraux de couleur. Le vocabulaire de tokens est la surface canonique pour le thèmage du chrome (chrome sidebar, barre de pane, panneau agent, panneau telegram, miroir web, …) — `audit:theming` garde le cluster honnête en faisant échouer la CI sur tout nouveau littéral de couleur en dur dans `src/views/terminal/index.css` ou `src/web-client/client.css`.

Le vocabulaire est défini dans `src/shared/web-theme-tokens.css` et groupé par famille :

| Famille | Rôle |
|---|---|
| `--ht-vnext-*` | Palette du redesign post-Phase-6 — échelle de texte (mute / muted / soft / bright / emph), chrome surface (surface-bg, surface-shadow, surface-bar-bg), couleurs de statut (port vert, peach close-btn), coquilles feuille/dialog, fg de segment-actif. |
| `--ht-agent-*` | Panneau pi-agent — toolbar, badges (extension / scope), dropdowns, états code/think/tool-call (rest / run / err / ok / inline), bulles de message (user-grad-top/-bot, system-bg), menu slash, dialogue de confirmation, barre d'entrée (attachment / kbd / focus), chips de statut (status / tool / streaming / queue). |
| `--ht-window-*` | Coquille du thème window — titlebar, sidebar, surface, surface-bar, overlay modal, toast, les solides de l'override t3. |
| `--ht-sidebar-v2-*` | Sidebar v2 — couleurs d'état des lignes de log (warning / info), ligne global-stats, halos des dots de script-btn workspace + bgs d'état, palette de statut des points serveur (halos online / starting / error / conflict + fg conflict), tint de hover dismiss. |
| `--ht-telegram-*` | Panneau telegram — toolbar, input, message in/out, accent, halo d'envoi, pastilles de statut, badge de message échoué. |
| `--ht-web-*` | Exclusif au miroir web — halos de points de statut (error / success / warning), gradient de surface-bar, chrome du tiroir sidebar, pulse violet de notification sidebar, palette WM overlay / card / close / flag / pill / kbd, extras telegram, trio de halos tau-meter. |
| `--ht-contrast-*` | Augmentations d'accessibilité sous `@media (prefers-contrast: more)` — alphas de bordures cyan plus brillants. |
| `--ht-sem-*` | Palette sémantique — `--ht-sem-success` (`#4ade80`), `--ht-sem-error` (`#f87171`), `--ht-sem-warning` (`#f59e0b`), plus les variantes `*-tint` par teinte. |
| `--ht-on-accent-fg` | Couleur de premier plan qui peint les labels au-dessus d'un fond `--accent-primary` (par exemple état « actif » de segmenté, prompt-btn-primary). |
| `--ht-badge-*`, `--ht-script-*`, `--ht-pm-*`, `--ht-palette-*`, `--ht-notify-*` | Palettes spécifiques au sous-système — badges, scripts, Process Manager, palette de commandes, notifications. |

La réutilisation inter-composants suit deux règles :

1. **Match RGB exact → réutiliser.** Une nouvelle région qui prend la même alpha + RGB qu'un token existant doit réutiliser plutôt que dupliquer. La plus forte démo en bloc unique du cluster (l'override window t3, 13 littéraux à zéro nouveau token) est une passe de pure réutilisation.
2. **Delta d'alpha ≤ 3 pp → harmoniser.** Une nouvelle région dans les 3 pp d'alpha d'un token existant réutilise avec une note. Cela colle intentionnellement les minuscules variations sur un même token pour qu'un swap de palette les repeigne de manière cohérente.

### Thèmage du chrome à l'exécution

Les thèmes overridd les tokens de couleur en définissant des valeurs `--ht-*` à l'intérieur de leur bloc de sélecteur. Les tokens par défaut vivent sous `:root` ; les media queries high-contrast et forced-colors overrident un sous-ensemble curé :

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

Les thèmes utilisateur personnalisés peuvent fournir leurs propres overrides `--ht-*` en injectant du CSS dans la webview, mais cette surface n'est pas encore câblée à travers Settings — pour l'instant, le changement de thème n'affecte que le schéma `ThemeColors` visible par l'utilisateur.

## Pour aller plus loin

- [Observabilité](/fr/development/observability/) — script `audit:theming` qui garde le vocabulaire de tokens.
- [Paramètres](/fr/configuration/settings/)
- [Source : `src/shared/settings.ts`](https://github.com/TheSamLePirate/TauMux/blob/main/src/shared/settings.ts)
- [Source : `src/shared/web-theme-tokens.css`](https://github.com/TheSamLePirate/TauMux/blob/main/src/shared/web-theme-tokens.css) — chaque token `--ht-*` avec commentaires inline de rationale.
