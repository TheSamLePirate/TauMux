---
title: Terminal
description: xterm.js avec PTYs natifs Bun, support souris complet, recherche dans le tampon, contrôles de police, et pastilles de statut dans la barre latérale.
sidebar:
  order: 1
---

La couche terminal dans τ-mux est xterm.js 5.3 attaché à un PTY `Bun.spawn`. Elle se comporte comme un véritable terminal — couleurs, line editing, mouse reporting, applications TUI en alt-screen fonctionnent toutes.

## Ce que vous obtenez

- **Rendu de couleurs et police.** Famille / taille / hauteur de ligne configurables ; JetBrains Mono Nerd Font livrée empaquetée.
- **Support souris.** Click, drag, scroll. Le mouse reporting est transmis aux TUIs qui le demandent.
- **Recherche dans le tampon.** `⌘F` ouvre une barre de recherche avec bascule regex, bascule sensible à la casse, et navigation suivant/précédent.
- **Scrollback.** 10 000 lignes par défaut, configurable dans les paramètres.
- **Copier / coller.** `⌘C` / `⌘V`. La sélection se copie automatiquement si vous activez `Settings → Appearance → Copy on select`.
- **Taille de police en direct.** `⌘=` / `⌘-` / `⌘0` pour augmenter, réduire ou réinitialiser.
- **Thèmes.** 10 préréglages (Catppuccin, Tokyo Night, Dracula, Nord, Rosé Pine, Gruvbox, Solarized, Synthwave '84, Everforest, Obsidian) plus remplacements par couleur.
- **Effets.** Couche WebGL bloom optionnelle ; bascule dans **Settings → Effects**. Désactivée par défaut.

## Choses que le terminal NE fait PAS

- Il n'interprète pas les séquences OSC pour l'inlining d'images (sixel, kitty graphics protocol). Utilisez le [protocole sideband](/fr/sideband/overview/) à la place.
- Il n'a pas d'intégration shell. Il n'y a pas de hook zsh/bash/fish — les métadonnées de processus viennent de l'OS, pas du shell.
- Il ne multiplexe pas plusieurs shells sur un seul PTY. Chaque panneau a son propre PTY.

## Pastilles de statut et barres de progression

Tout ce qui est dans le terminal peut publier un statut en direct dans la barre latérale sans imprimer sur stdout, via le CLI `ht` :

```bash
ht set-status build "Building" --color "#7aa2f7" --icon hammer
ht set-progress 0.42 --label "Tests"
ht log --level success --source build "All tests green"
ht clear-status build
```

Les pastilles s'affichent sur la carte d'espace de travail dans la barre latérale. Elles survivent aux changements de focus de panneau et sont effacées à la fermeture de l'espace de travail. Voir [Barre latérale & statut](/fr/cli/sidebar-and-status/).

## Puces par panneau

L'en-tête du panneau affiche des puces en direct :

| Puce | Quoi |
|---|---|
| **Commande de premier plan** | argv complet du processus de premier plan. Cliquez pour focaliser. |
| **cwd** | Répertoire de travail courant (tronqué au home / racine git). |
| **Puces de port** | Une par port TCP en écoute. Cliquez pour ouvrir `http://localhost:<port>`. |

Toutes les puces sont pilotées par le [pipeline de métadonnées de processus en direct](/fr/features/live-process-metadata/), pas par des hooks shell.

## Fichiers source

- `src/views/terminal/surface-manager.ts` — instances de terminal, rendu des puces.
- `src/views/terminal/terminal-search.ts` — barre de recherche `⌘F`.
- `src/views/terminal/terminal-effects.ts` — bloom WebGL.
- `src/bun/pty-manager.ts` — un seul PTY : spawn, stdin/stdout, fds sideband.

## Pour aller plus loin

- [Modèle PTY](/fr/concepts/pty-model/)
- [Métadonnées de processus en direct](/fr/features/live-process-metadata/)
- [CLI Barre latérale & statut](/fr/cli/sidebar-and-status/)
- [Settings: Appearance / Theme / Effects](/fr/configuration/settings/)
