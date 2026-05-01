---
title: Raccourcis clavier
description: Tous les raccourcis — définis comme données dans src/views/terminal/keyboard-shortcuts.ts.
sidebar:
  order: 4
---

Les raccourcis clavier sont déclarés sous forme de tableau `Binding<KeyCtx>[]` dans `src/views/terminal/keyboard-shortcuts.ts`. Chaque entrée a un `id`, une `description`, une `category` et un matcher `keyMatch(...)`.

## Espace de travail + panneau

| Raccourci | Action |
|---|---|
| `⌘N` | Nouvel espace de travail |
| `⌘D` | Split à droite |
| `⌘⇧D` | Split en bas |
| `⌘W` | Fermer le panneau focalisé |
| `⌘⇧W` | Fermer l'espace de travail |
| `⌘B` | Basculer la barre latérale |
| `⌘⌥←↑→↓` | Focaliser le panneau voisin |
| `⌃⌘]` / `⌃⌘[` | Espace de travail suivant / précédent |
| `⌘1`…`⌘9` | Aller à l'espace de travail N |

## Superpositions

| Raccourci | Action |
|---|---|
| `⌘,` | Paramètres |
| `⌘⇧P` | Palette de commandes |
| `⌘⌥P` | Process Manager |
| `⌘I` | Pane Info — vue détaillée complète du panneau focalisé |
| `Esc` | Fermer la superposition active (paramètres, process manager, palette de commandes) |

## Terminal

| Raccourci | Action |
|---|---|
| `⌘F` | Rechercher dans le terminal |
| `⌘C` / `⌘V` | Copier / coller |
| `⌘=` / `⌘-` / `⌘0` | Augmenter / diminuer / réinitialiser la taille de la police |

## Navigateur

Ces raccourcis ne se déclenchent que lorsqu'un panneau navigateur a le focus.

| Raccourci | Action |
|---|---|
| `⌘⇧L` | Ouvrir le navigateur en split |
| `⌘L` | Focaliser la barre d'adresse du navigateur |
| `⌘[` / `⌘]` | Précédent / suivant dans le navigateur |
| `⌘R` | Recharger la page du navigateur |
| `⌥⌘I` | Basculer les DevTools du navigateur |
| `⌘F` | Rechercher dans la page |

## Personnalisation

Il n'y a pas encore d'éditeur graphique de raccourcis. Pour ajouter ou changer un raccourci clavier :

1. Éditez `src/views/terminal/keyboard-shortcuts.ts`.
2. Ajoutez une entrée `Binding<KeyCtx>` à `KEYBOARD_BINDINGS` (ou `HIGH_PRIORITY_BINDINGS` pour les raccourcis qui doivent se déclencher même quand la palette est visible).
3. Utilisez `keyMatch({ key, meta?, shift?, ctrl?, alt? })` pour le matcher.
4. Reconstruisez.

Les champs `id` / `description` / `category` sont utilisés par la palette de commandes pour que les utilisateurs puissent retrouver toutes les actions par recherche floue.

## Pour aller plus loin

- [Palette de commandes](/fr/features/command-palette/)
- [Source : `src/views/terminal/keyboard-shortcuts.ts`](https://github.com/TheSamLePirate/TauMux/blob/main/src/views/terminal/keyboard-shortcuts.ts)
