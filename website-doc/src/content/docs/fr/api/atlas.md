---
title: atlas.*
description: pin, note, meter, mark — annotations d'agent sur le graphe de topologie Atlas.
---

Le côté écriture du [graphe Atlas](/fr/features/layout-variants/#atlas). Tout le reste de
ce que le graphe dessine est observé ; ces méthodes portent ce que dit la
chose qui fait le travail. Surface CLI : [`ht atlas`](/fr/cli/atlas/).

| Méthode | Paramètres | Résultat |
|---|---|---|
| `atlas.pin` | `{ surface?, workspace?, off? }` | `"OK"` |
| `atlas.unpin` | `{ surface?, workspace? }` | `"OK"` |
| `atlas.note` | `{ surface?, workspace?, text, tone? }` | `"OK"` |
| `atlas.meter` | `{ surface?, workspace?, key, value, label? }` | `"OK"` |
| `atlas.clear_meter` | `{ surface?, workspace?, key }` | `"OK"` |
| `atlas.mark` | `{ text, surface?, workspace?, tone? }` | `{ ok, id, at }` |
| `atlas.clear` | `{ surface?, workspace?, all? }` | `"OK"` |
| `atlas.state` | `{}` | `{ annotations, marks }` |

## Résolution de la cible

Un `workspace` explicite l'emporte sur une `surface` explicite, qui l'emporte
sur le panneau appelant (`HT_SURFACE`, exporté dans le shell de chaque
panneau), qui l'emporte sur la surface focalisée. Un agent tournant dans un
panneau annote donc son propre nœud sans aucun paramètre.

Les cibles sont des identifiants ordinaires de surface / espace de travail —
ceux que renvoient [`workspace.list`](/fr/api/workspace/) et
[`surface.list`](/fr/api/surface/), et ceux que le graphe utilise comme
identifiants de nœud.

## Valeurs

`atlas.meter` borne à 0…1 et accepte 0–100 comme pourcentage : `62` et `0.62`
veulent donc dire la même chose. `tone` vaut `info | ok | warn | err` ; toute
autre valeur est ignorée plutôt que rejetée.

Les notes sont plafonnées à 200 caractères, les mesures à 4 par nœud (la plus
ancienne évincée), les repères à 50 avec une expiration de 10 minutes.

## Durée de vie

En mémoire uniquement, jamais persisté. Ces données décrivent un travail en
cours — une note sur ce qui bloquait une session il y a une heure survivrait
à sa vérité.

## Canal de push

Chaque mutation diffuse (avec debounce) une enveloppe `atlasAnnotations` vers
la webview, si bien que le graphe se repeint sans polling.
