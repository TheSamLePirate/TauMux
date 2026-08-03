---
title: panel.*
description: list — lire les panneaux canvas ouverts dans une surface.
---

Vue en lecture seule des [panneaux canvas](/fr/features/canvas-panels/) ouverts
dans une surface. Les panneaux sont créés par le
[protocole sideband](/fr/sideband/overview/), pas par RPC ; cette méthode
expose le miroir côté bun de cet état.

| Méthode | Params | Résultat |
|---|---|---|
| `panel.list` | `{ surface_id? }` | `Panel[]` — tableau vide si la surface n'en a aucun |

`surface_id` vaut par défaut la surface focalisée (ou `HT_SURFACE` depuis le CLI).

Voir [`ht list-panels`](/fr/cli/surfaces-and-io/).
