---
title: Atlas
description: ht atlas — épingler, annoter et marquer le graphe de topologie Atlas depuis un agent ou un script.
sidebar:
  order: 12
---

Tout ce que le [graphe Atlas](/fr/features/layout-variants/#atlas) dessine est *observé* : le CPU lu par le collecteur, les octets émis par le PTY, les phases rapportées par les hooks de Claude Code. `ht atlas` est le seul canal en sens inverse — celui où ce qui fait le travail dit quelque chose qu'aucune observation ne révélerait.

Quatre verbes, délibérément peu nombreux :

| Verbe | Dit |
|---|---|
| `pin` | ce nœud compte en ce moment ; garde-le visible |
| `note` | une ligne de contexte — ce qui le bloque réellement |
| `meter` | une mesure nommée 0…1 — où il en est dans un travail |
| `mark` | un jalon horodaté sur la rivière d'activité |

## Cible

Chaque verbe sauf `mark` agit sur un **nœud**, c'est-à-dire une surface ou un espace de travail — les identifiants que le graphe utilise déjà :

```bash
ht atlas pin                      # ce panneau (HT_SURFACE), ou le panneau focalisé
ht atlas pin --surface surface:3
ht atlas pin --workspace ws:2
```

Dans un panneau τ-mux, `HT_SURFACE` est déjà exporté : un agent annote donc son propre nœud sans le moindre argument.

## pin / unpin

```bash
ht atlas pin
ht atlas unpin
```

Un nœud épinglé gagne un badge `pinned` et le graphe déplie le chemin qui y mène — une épingle laissant le nœud replié dans un espace de travail fermé n'aurait rien fait. À utiliser quand vous allez travailler là où l'utilisateur ne regarde pas.

## note

```bash
ht atlas note "en attente de la CI"
ht atlas note "conflit de rebase dans pane-layout.ts" --tone err
```

La note devient le sous-titre du nœud et la première ligne de son inspecteur. Elle **prime** sur le sous-titre dérivé : ce que l'agent dit faire l'emporte sur ce que τ-mux a déduit d'`argv`.

`--tone info|ok|warn|err` colore la ligne d'inspecteur. Plafonné à 200 caractères — une ligne, pas un journal.

## meter

```bash
ht atlas meter build 0.62
ht atlas meter build 62            # 0–100 est lu comme un pourcentage
ht atlas meter tests 0.4 --label "142/350 fichiers"
```

Une mesure nommée 0…1, affichée en badge et en arc extérieur du nœud. La première mesure publiée prend l'arc ; les suivantes restent des badges. Quatre par nœud, la plus ancienne étant évincée.

Les valeurs hors de 0…1 sont bornées plutôt que refusées : un appelant qui rapporte `1.4` veut dire « terminé ».

```bash
ht atlas clear --surface surface:3   # supprimer les annotations de ce nœud
```

## mark

```bash
ht atlas mark "migration appliquée"
ht atlas mark "déploiement échoué" --tone err
```

Un repère horodaté sur la [rivière d'activité](/fr/features/layout-variants/#la-riviere-dactivite). La rivière montre déjà *à quel point* chaque espace de travail a été bruyant ; un repère dit *et voilà quand la chose qui vous intéressait s'est produite*.

Les repères expirent après 10 minutes et sont plafonnés à 50 — ils annotent le passé récent, pas un historique.

## clear / state

```bash
ht atlas clear                # ce nœud
ht atlas clear --all          # tout, repères compris
ht atlas state                # relire ce qui est annoté
```

## Durée de vie

Les annotations vivent en mémoire et ne sont **pas persistées**. Elles décrivent un travail en cours : une note sur ce qui bloquait une session il y a une heure serait pire que pas de note, car elle survivrait à sa vérité sans moyen de le savoir.

## Pour aller plus loin

- [Variantes de disposition → Atlas](/fr/features/layout-variants/) — ce que le graphe dessine et comment le lire
- [JSON-RPC `atlas.*`](/fr/api/atlas/)
- [`ht plan`](/fr/cli/plan/) — pour les plans par étapes, que le graphe affiche également
