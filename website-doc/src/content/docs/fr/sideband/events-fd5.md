---
title: Événements (fd 5)
description: Glisser, redimensionner, cliquer, erreurs système — JSONL sur fd 5.
sidebar:
  order: 4
---

fd 5 est le canal de retour : τ-mux écrit des événements JSONL vers votre script. Utilisez-le pour réagir aux positions de fin de glisser, aux validations de redimensionnement, aux clics sur les panneaux interactifs, aux événements de redimensionnement du terminal et aux erreurs de protocole.

## Lecture

Le script lit fd 5 ligne par ligne :

```python
import os
fd5 = os.fdopen(int(os.environ["HYPERTERM_CHANNELS"][...]), "r")  # use the client lib
for line in fd5:
    print("got:", line.strip())
```

Ou avec le client Python :

```python
from hyperterm import ht
for event in ht.events():
    print(event)
```

## Forme des événements

Les événements par panneau portent l'`id` du panneau :

```jsonl
{"id":"img1","event":"dragend","x":300,"y":400}
{"id":"img1","event":"resize","width":600,"height":400}
{"id":"widget","event":"click","x":42,"y":87,"button":"left"}
{"id":"img1","event":"close"}
```

Les coordonnées de clic sont relatives au panneau (par rapport au coin supérieur gauche du panneau). Les coordonnées de glisser sont relatives au panneau de session.

## ID virtuels réservés

| Id | Événements |
|---|---|
| `__terminal__` | `resize` (cols/rows changés), `focus`, `blur` |
| `__system__` | `error` (avec `code` et `message`) |

```jsonl
{"id":"__terminal__","event":"resize","cols":120,"rows":40}
{"id":"__terminal__","event":"focus"}
{"id":"__system__","event":"error","code":"meta-validate","message":"Missing id"}
```

## Codes d'erreur

| Code | Signification |
|---|---|
| `meta-validate` | Une ligne fd 3 a échoué à la validation (champ manquant, mauvais type). |
| `data-overflow` | Une lecture fd 4 a dépassé `byteLength` pour le panneau actif. |
| `unknown-id` | Un update / clear / event fait référence à un panneau qui n'existe pas. |
| `renderer-error` | Le moteur de rendu pour le `type` du panneau a échoué. |

Ces erreurs ne mettent pas fin au canal — votre script peut choisir de les ignorer, de les journaliser, ou de les utiliser pour interrompre le traitement.

## Filtrage

La plupart des scripts ne s'intéressent qu'à un sous-ensemble. Filtrez par `id` et `event` :

```ts
ht.onEvent((e) => {
  if (e.id === "btn" && e.event === "click") {
    handleClick(e.x, e.y);
  }
});
```

Les deux bibliothèques client fournissent des générateurs `onEvent` (TypeScript) / `events()` (Python) qui simplifient cela.

## Pour aller plus loin

- [Métadonnées (fd 3)](/fr/sideband/metadata-fd3/)
- [Vue d'ensemble du sideband](/fr/sideband/overview/)
- [Client Python](/fr/sideband/python-client/)
- [Client TypeScript](/fr/sideband/typescript-client/)
