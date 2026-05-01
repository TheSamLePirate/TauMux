---
title: pane.*
description: list — introspection de l'arbre des panneaux.
sidebar:
  order: 6
---

Accès de plus bas niveau à l'arbre des panneaux. La plupart des cas d'usage emploient plutôt `system.tree`, qui agrège espaces de travail / panneaux / surfaces dans une structure unique.

| Méthode | Params | Résultat |
|---|---|---|
| `pane.list` | `{ workspaceId?: string }` | `{ panes: PaneNode[] }` |

`PaneNode` est la représentation en arbre binaire :

```ts
type PaneNode =
  | { kind: "leaf"; surfaceId: string; surfaceType: "terminal" | "browser" | "agent" | "telegram" }
  | { kind: "split"; direction: "horizontal" | "vertical"; ratio: number; children: [PaneNode, PaneNode] };
```

`workspaceId` vaut par défaut l'espace de travail courant.

## Quand utiliser `pane.list` plutôt que `system.tree`

- `system.tree` — la plupart des cas d'usage agent / scripting. Vous donne tout en un seul appel.
- `pane.list` — lorsque vous voulez spécifiquement la structure en arbre binaire pour un seul espace de travail (scénarios de rendu de mise en page).
