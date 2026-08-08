---
title: blocks.*
description: Blocs de commandes issus de l'intégration shell OSC 133 — ce qui a été exécuté, ce que ça a retourné, combien de temps ça a pris.
sidebar:
  order: 5
---

Les **blocs** de commandes apportent ce que le collecteur de métadonnées ne peut pas donner : des frontières. Le collecteur voit des processus apparaître et disparaître ; seul le shell sait qu'une commande a démarré ici, s'est terminée là, et a retourné `2`.

Ces méthodes sont donc **conditionnées à l'intégration optionnelle** — voir [`ht shell-integration`](/fr/cli/surfaces-and-io/#shell-integration). Chaque réponse porte `integration_detected` pour qu'un appelant distingue « aucune commande pour l'instant » de « ce shell ne rapporte rien ». Sans l'intégration, la liste est simplement toujours vide.

La base zéro-configuration de τ-mux n'est pas affectée : cwd, commande au premier plan, ports, CPU et mémoire continuent de fonctionner dans n'importe quel shell, que vous installiez ceci ou non.

## Méthodes

| Méthode | Paramètres | Résultat |
|---|---|---|
| `blocks.last` | `{ surface_id?: string, output?: boolean }` | `{ integration_detected, block }` |
| `blocks.list` | `{ surface_id?: string, limit?: number, output?: boolean }` | `{ integration_detected, blocks: [] }` |
| `blocks.current` | `{ surface_id?: string, output?: boolean }` | `{ integration_detected, block }` |

`surface_id` retombe sur la surface focalisée.

`output` contrôle l'attachement de la sortie stdout/stderr capturée. Il vaut **true** par défaut pour `blocks.last` (« est-ce que ça a réussi, et qu'est-ce que ça a affiché » est une seule question) et **false** pour `blocks.list` et `blocks.current` — une liste de 50 blocs avec leur sortie est une réponse de l'ordre du mégaoctet que personne n'a demandée.

## Forme d'un bloc

```json
{
  "id": 12,
  "command": "bun test",
  "exit_code": 1,
  "started_at": 1754650000000,
  "ended_at": 1754650004200,
  "duration_ms": 4200,
  "running": false,
  "output": "…",
  "output_truncated": false
}
```

`exit_code` vaut `null` pendant l'exécution, et également lorsque le shell a signalé la fin d'une commande sans indiquer son statut — ce n'est pas la même chose que `0` et ce n'est pas rapporté comme tel.

`blocks.current` renvoie le bloc en cours d'exécution, ou `null`. C'est distinct de la commande au premier plan de `surface.metadata` : il s'agit ici de ce que le shell dit avoir lancé, pas d'une inférence à partir de l'arbre de processus.

## Limites

Les blocs sont plafonnés à 50 par surface. La sortie capturée est plafonnée à 16 Ko par bloc et 64 Ko par surface au total, la plus ancienne étant abandonnée en premier — les métadonnées (commande, code de sortie, chronométrage) survivent, car c'est ce que la plupart des appelants veulent. `output_truncated` indique quand l'un des plafonds a joué.

Un terminal ouvert depuis une semaine ne doit pas retenir une semaine de logs de build.
