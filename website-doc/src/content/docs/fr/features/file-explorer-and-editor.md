---
title: Explorateur de fichiers + éditeur
description: Explorateur de fichiers CWD natif dans la sidebar et panneau d'éditeur CodeMirror.
sidebar:
  order: 11
---

τ-mux livre un explorateur de fichiers natif dans la sidebar et un panneau d'éditeur CodeMirror 6. Ensemble, ils vous laissent parcourir le CWD du workspace, ouvrir des fichiers dans un split, les éditer, et les sauvegarder — sans quitter le terminal. Les deux sont **natifs uniquement** aujourd'hui ; le protocole HTTP/WS du miroir web n'est pas encore câblé pour eux.

## Explorateur de fichiers CWD sidebar

Chaque carte workspace porte une ligne CWD en haut, même pour les workspaces mono-CWD et les états « métadonnées indisponibles ». Sous la ligne CWD se trouve un explorateur de fichiers pliable enraciné sur le CWD du workspace sélectionné.

### Comportement

- **Listing paresseux.** Les répertoires sont lus à l'expansion, pas au lancement de l'app.
- **Dossiers ignorés par défaut.** `.git`, `node_modules`, `.next`, `.nuxt`, `.svelte-kit`, `dist`, `build`, `coverage`, `.turbo`, `.cache` sont filtrés par défaut (le compte est remonté sous `ignored`).
- **Dotfiles** sont cachés par défaut ; toggle dans Settings → General → Show dotfiles.
- **Max d'entrées** par répertoire est plafonné (par défaut 250, configurable dans Settings). Quand le plafond est atteint le listing reporte `truncated: true` pour que l'UI puisse afficher une indication « +N de plus ».
- **Ordre de tri.** Répertoires → liens symboliques → fichiers, puis alphanumérique naturel.
- **Refresh** reconstruit le listing pour le répertoire focalisé.
- **Sémantique accessible.** L'arbre utilise `role="tree"` / `role="treeitem"`, supporte la navigation clavier, a de forts anneaux de focus.

### Protection contre les boucles de liens symboliques (0.3.148)

Chaque entrée `kind: "symlink"` porte désormais deux champs supplémentaires :

- **`linkTarget: string | null`** — le realpath résolu du lien, ou `null` pour les liens cassés.
- **`cycle: true`** — positionné quand le realpath est égal au répertoire listé lui-même ou à un de ses ancêtres.

La webview peut refuser la navigation dans une entrée `cycle: true` avec une indication claire « ceci créerait une boucle », au lieu de laisser l'utilisateur s'enfoncer dans la boucle. Le helper de détection `isAncestorOrSelf(candidate, root)` s'ancre correctement sur le séparateur de chemin pour que `/foo` ne soit PAS traité comme ancêtre de `/foobar`.

### Action Nouveau fichier

L'en-tête de l'explorateur a un bouton **Nouveau fichier** qui ouvre un split CodeMirror en mode création. Sauvegarder (`⌘S`) écrit le fichier au chemin tapé ; annuler (`Escape`) ferme le split vide sans laisser de fichier orphelin.

### Source

- `src/bun/sidebar-file-explorer.ts` — fonction pure `listSidebarFileExplorerDirectory(request)`.
- `src/shared/types.ts` — types `SidebarFileExplorerEntry` et `SidebarFileExplorerListing`.

## Panneau d'éditeur CodeMirror

La surface d'éditeur (`editor:*`) est un pane natif uniquement webview adossé à CodeMirror 6.

### Ouvrir des fichiers

- **Depuis la sidebar.** Cliquez sur n'importe quel fichier dans l'explorateur pour l'ouvrir dans un nouveau split (ou focaliser le pane d'éditeur existant s'il est déjà ouvert).
- **Depuis la CLI.** `ht edit /path/to/file.ts` ou `ht editor open /path/to/file.ts` — les deux ouvrent le fichier dans un pane split dans le workspace focalisé.
- **Nouveau fichier.** Le bouton Nouveau fichier de l'explorateur (ou `ht editor new`) ouvre un éditeur vide avec un prompt de chemin.

### Édition

- **Sauvegarder** avec `⌘S` (écrit atomiquement ; voir « Détection de conflit » ci-dessous).
- **Recharger** abandonne les éditions locales et relit depuis le disque.
- **Fermer** le pane sans sauvegarder — les changements non sauvegardés sont perdus (pas de prompt en v1 ; suivi comme un manque de polissage).
- **Persistance de layout.** Les panes d'éditeur survivent à un redémarrage τ-mux — ils sont stockés dans `layout.json` avec le chemin de fichier et se ré-ouvrent au lancement.

### Détection de conflit

Le RPC d'éditeur transporte le `mtime` du fichier depuis l'ouverture. À la sauvegarde, le côté bun compare le `mtime` sur disque à celui que l'éditeur connaissait. S'ils diffèrent (autre chose a écrit le fichier entre-temps), la sauvegarde renvoie une erreur `conflict` au lieu d'écraser silencieusement. La surface d'éditeur présente un affordance « forcer la sauvegarde » pour overrider.

### Garde-fous binaire / gros fichier

Le RPC `editor.read` côté bun refuse de charger les fichiers qui :

- Contiennent un octet null dans les 8 premiers Kio (heuristique binaire).
- Dépassent une limite de taille configurable (par défaut 5 Mio).

Les deux refus reviennent comme erreur structurée pour que le pane d'éditeur puisse rendre un placeholder explicatif.

### Là où l'éditeur ne va pas (encore)

- **Miroir web.** Le pane d'éditeur est natif uniquement. Le protocole HTTP/WS ne transporte pas le contenu d'éditeur pour l'instant.
- **Multi-curseur / find-and-replace.** La fonctionnalité CodeMirror standard est activée mais les affordances UI au-delà des keymaps intégrés de l'éditeur sont minimales.
- **Language servers / complétions.** Pas d'intégration LSP. La coloration syntaxique intégrée de CodeMirror est active ; tout le reste est au clavier.

### Source

- `src/bun/webview-handlers/editor.ts` — les handlers RPC côté bun.
- `src/views/terminal/editor-pane.ts` — la surface d'éditeur webview.
- `src/bun/rpc-handlers/editor.ts` — RPC d'éditeur côté socket (utilisé par `ht edit`).

## Pour aller plus loin

- [`ht edit` / `ht editor`](/fr/cli/surfaces-and-io/) — commandes CLI pour ouvrir des fichiers.
- [Paramètres](/fr/configuration/settings/) — toggles d'explorateur (dotfiles, max-entries, default-collapsed).
