---
title: Espaces de travail
description: list, new, select, close, rename, next, previous.
sidebar:
  order: 3
---

Commandes au niveau espace de travail. Un espace de travail est une disposition indépendante de panneaux ; basculez entre eux avec `⌘1…9` ou ces commandes.

## list-workspaces

```bash
ht list-workspaces
# ws:0  build       (current)
# ws:1  docs
# ws:2  scratch
```

Liste les espaces de travail avec leur id, libellé, et un marqueur `(current)` sur celui qui a le focus. `--json` renvoie la forme structurée.

## current-workspace

```bash
ht current-workspace
# ws:0
```

## new-workspace

```bash
ht new-workspace --name proj --cwd ~/code
```

Crée un nouvel espace de travail. Les deux options sont optionnelles — sans `--name` l'espace de travail reçoit un libellé auto-généré ; sans `--cwd` il hérite du répertoire personnel de l'utilisateur.

## select-workspace

```bash
ht select-workspace --workspace ws:2
```

## close-workspace

```bash
ht close-workspace --workspace ws:2
```

Ferme l'espace de travail et toutes ses surfaces. Les shells reçoivent SIGHUP ; le poller de métadonnées les vide au tick suivant.

## rename-workspace

```bash
ht rename-workspace "my new name"
ht rename-workspace --workspace ws:2 "build"
```

Sans `--workspace`, renomme l'espace de travail courant.

## next-workspace / previous-workspace

```bash
ht next-workspace
ht previous-workspace
```

Équivalent à `⌃⌘]` / `⌃⌘[`.

## Pour aller plus loin

- [Espaces de travail et panneaux](/fr/concepts/workspaces-and-panes/)
- [Méthodes JSON-RPC workspace](/fr/api/workspace/)
