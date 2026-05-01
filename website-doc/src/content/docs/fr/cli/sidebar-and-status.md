---
title: Barre latérale et statut
description: set-status, clear-status, set-progress, clear-progress, log.
sidebar:
  order: 5
---

Poussez du statut en direct dans la barre latérale τ-mux sans imprimer sur stdout. Conçu pour les scripts de build, les watchers, les agents et toute tâche longue qui veut afficher la progression sans polluer le terminal.

## set-status

```bash
ht set-status build "Building"
ht set-status build "ok" --color "#a6e3a1" --icon bolt
ht set-status tests "12/30 passed" --color "#7aa2f7"
```

Publie une pastille de statut dans l'espace de travail de la surface focalisée. Les pastilles sont indexées par le premier argument (`build`, `tests`, …) — appeler à nouveau avec la même clé met à jour sur place.

| Option | Rôle |
|---|---|
| `--color <hex>` | Arrière-plan de la pastille. Utilisez la palette du projet pour la cohérence. |
| `--icon <name>` | ID de l'icône (sous-ensemble de [Lucide](https://lucide.dev) — `bolt`, `hammer`, `check`, `x`, `loader`, …). |
| `--surface <id>` | Remplace la surface cible. |

## clear-status

```bash
ht clear-status build
```

Supprime la pastille indexée. Appeler avec une clé inexistante est sans effet.

## set-progress / clear-progress

```bash
ht set-progress 0.42 --label "Tests"
ht clear-progress
```

Une barre de progression — une seule par surface. La valeur est `0.0`–`1.0`. Utilisez les libellés pour ce qui se passe (`"Building"`, `"Linting"`, `"Tests 12/30"`).

## log

```bash
ht log "Tests passed"
ht log --level success --source build "All green"
ht log --level error --source eslint "5 issues"
```

Ajoute une entrée de journal à la section de logs de la barre latérale. Niveaux : `info` (par défaut), `success`, `warn`, `error`. Le champ `--source` regroupe les entrées liées. Les logs persistent pendant toute la durée de vie de l'espace de travail.

## Motifs courants

### Scripts de build

```bash
#!/bin/bash
ht set-status build "Building" --color "#7aa2f7" --icon hammer

if bun run build; then
  ht set-status build "OK" --color "#a6e3a1" --icon check
  ht log --level success --source build "Build green"
else
  ht set-status build "FAIL" --color "#f7768e" --icon x
  ht log --level error --source build "Build broke"
fi
```

### Watchers

```bash
fswatch ./src | while read change; do
  ht set-progress 0.0 --label "Tests"
  ht set-progress 0.5 --label "Tests (running)"
  bun test
  ht clear-progress
done
```

## Pour aller plus loin

- [Méthodes JSON-RPC sidebar](/fr/api/sidebar/)
- [`ht notify`](/fr/cli/notifications/)
