---
title: Palette de commandes
description: ⌘⇧P — recherche floue de toutes les actions, incluant les mêmes raccourcis clavier et commandes CLI.
sidebar:
  order: 9
---

`⌘⇧P` ouvre une palette de commandes à recherche floue listant toutes les actions — raccourcis, bascules de paramètres, commandes navigateur, opérations sur les espaces de travail.

## Pourquoi elle existe

La palette est l'unique source de vérité pour « que peut faire τ-mux dès maintenant ». Les raccourcis clavier ne vous mènent que jusqu'à un certain point quand vous ne vous souvenez pas de la combinaison ; la palette vous laisse épeler le nom de l'action.

C'est aussi le bon endroit pour ajouter des **commandes sans raccourci** — au lieu d'inventer une nouvelle combinaison, déposez une entrée `PaletteCommand` et laissez l'utilisateur la trouver en recherche floue.

## Comment elle est branchée

Les commandes sont déclarées dans `src/views/terminal/index.ts` via `buildPaletteCommands()`. Chaque entrée est :

```ts
{
  id: "browser.open-split",
  label: "Open browser in split",
  category: "Browser",
  icon: "browser",
  shortcut: "⌘⇧L",          // optional
  run: async () => { … },
}
```

Ajouter une commande consiste à ajouter une entrée au tableau — aucun autre enregistrement nécessaire.

## Les entrées couvrent

- Actions sur les espaces de travail — nouveau, fermer, renommer, basculer.
- Actions sur les panneaux — splits, focaliser le voisin, fermer.
- Actions sur le navigateur — ouvrir une URL, focaliser la barre d'adresse, devtools.
- Bascules de paramètres — bloom, miroir web, mode sombre forcé, copy-on-select.
- Actions Telegram — ouvrir la conversation, rafraîchir.
- Actions de l'app — paramètres, installer le CLI `ht`, à propos.

## Fichiers source

- `src/views/terminal/command-palette.ts` — superposition + correspondance floue.
- `src/views/terminal/index.ts` — entrées `buildPaletteCommands()`.

## Pour aller plus loin

- [Raccourcis clavier](/fr/configuration/keyboard-shortcuts/)
