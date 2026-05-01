---
title: Vue d'ensemble
description: Le protocole sideband fd 3/4/5 — framing, plan des canaux, validation, contre-pression.
sidebar:
  order: 1
---

τ-mux ouvre trois descripteurs de fichier supplémentaires pour chaque shell. Les scripts qui s'exécutent dans le terminal les utilisent pour rendre du contenu structuré (images, SVG, HTML, widgets interactifs) dans des canvas flottants — sans perturber le flux texte du terminal.

## Plan des canaux

Le plan des canaux est publié dans `HYPERTERM_CHANNELS` au format JSON, afin que les scripts puissent s'adapter s'il change un jour. Valeurs par défaut :

| fd | Direction | Rôle | Format |
|----|-----------|---------|--------|
| **3** | script → terminal | Métadonnées : définitions, mises à jour et effacements de panneaux | JSONL |
| **4** | script → terminal | Données binaires référencées depuis fd 3 | octets bruts, préfixés par longueur |
| **5** | terminal → script | Événements : clics, glissers, redimensionnements, erreurs système | JSONL |

La première lecture d'un script devrait être :

```bash
echo "$HYPERTERM_CHANNELS"
# {"meta":3,"data":4,"events":5}
```

Les bibliothèques client le font automatiquement.

## Détection

Pour savoir si un script s'exécute à l'intérieur de τ-mux :

```bash
[ -n "$HYPERTERM_PROTOCOL_VERSION" ] && echo "inside τ-mux"
```

`HYPERTERM_PROTOCOL_VERSION=1` est défini dans chaque shell créé dans une surface terminal. Les clients Python et TypeScript détectent cela et **deviennent silencieusement des no-op en dehors de τ-mux** — le même script s'exécute dans un terminal classique sans erreur.

## Framing

### fd 3 — métadonnées (JSONL)

Un objet JSON par ligne. Exemples :

```jsonl
{"id":"img1","type":"image","format":"png","x":100,"y":100,"byteLength":4096}
{"id":"chart","type":"svg","position":"float","width":400,"height":300,"byteLength":2048}
{"id":"widget","type":"html","interactive":true,"byteLength":512}
{"id":"img1","type":"update","x":200,"y":200}
{"id":"img1","type":"clear"}
```

Champs requis : `id`, `type`. L'`id` relie cette ligne de métadonnées à (a) toute charge utile binaire sur fd 4, (b) les futurs updates / clears, (c) les événements sur fd 5.

### fd 4 — données binaires

Lorsqu'une ligne de métadonnées contient `byteLength: N`, exactement N octets bruts suivent sur fd 4 — pas de framing, pas de préfixe de longueur au-delà du `byteLength` côté métadonnées. Le lecteur copie N octets depuis fd 4 et les associe à l'id du panneau.

Si plusieurs panneaux sont créés en succession rapide, leurs charges utiles fd 4 sont lues dans l'ordre d'émission des métadonnées.

### fd 5 — événements (JSONL)

```jsonl
{"id":"img1","event":"dragend","x":300,"y":400}
{"id":"img1","event":"resize","width":600,"height":400}
{"id":"widget","event":"click","x":42,"y":87}
{"id":"img1","event":"close"}
{"id":"__terminal__","event":"resize","cols":120,"rows":40}
{"id":"__system__","event":"error","code":"meta-validate","message":"Missing id"}
```

`__terminal__` et `__system__` sont des id virtuels réservés — événements de niveau terminal et erreurs de protocole.

## Validation

τ-mux valide chaque ligne fd 3 avant de créer un panneau :

- `id` doit être une chaîne non vide.
- `type` doit être un type de contenu connu ou une opération (`update`, `clear`).
- `byteLength` doit être un entier non négatif.
- `position`, `width`, `height`, `x`, `y` doivent être des nombres / des enums connus.

Les lignes invalides produisent un événement d'erreur `__system__` sur fd 5 — elles ne plantent pas le parseur et ne ferment pas le canal.

## Contre-pression

Les deux directions sont soumises à contre-pression au niveau du système d'exploitation. Si le script écrit sur fd 3 / 4 plus vite que τ-mux ne consomme, le script bloque sur sa prochaine `write`. Les bibliothèques client utilisent intentionnellement des écritures bloquantes — un `O_NONBLOCK` non bloquant abandonnerait silencieusement des trames.

## Pour aller plus loin

- [Métadonnées (fd 3)](/fr/sideband/metadata-fd3/) — référence complète des options de panneau
- [Données binaires (fd 4)](/fr/sideband/data-fd4/)
- [Événements (fd 5)](/fr/sideband/events-fd5/)
- [Client Python](/fr/sideband/python-client/)
- [Client TypeScript](/fr/sideband/typescript-client/)
- [Démos](/fr/sideband/demos/)
