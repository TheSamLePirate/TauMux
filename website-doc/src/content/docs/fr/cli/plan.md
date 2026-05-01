---
title: Plan
description: ht plan — publiez, mettez à jour et inspectez les plans d'agent affichés dans le panneau plan de τ-mux.
sidebar:
  order: 11
---

`ht plan` est le côté agent du [panneau plan](/fr/features/plan-panel/). L'agent publie un plan étape par étape (Explore → Implement → Test → Commit), garde les états des étapes à jour, et le widget de la barre latérale τ-mux le rend en direct pour l'utilisateur. Chaque plan est indexé par `(workspaceId, agentId?)` pour que plusieurs agents dans le même espace de travail restent isolés.

## États des étapes

| État | Glyphe | Signification |
|---|---|---|
| `done` | `✓` | Étape terminée. |
| `active` | `●` | Étape en cours (une par plan, par convention). |
| `waiting` | `○` | Pas encore commencée. |
| `err` | `✗` | L'étape a échoué ; l'agent doit signaler. |

Le CLI affiche ces glyphes en couleur lorsque stdout est un TTY.

## plan list

```bash
ht plan list
ht plan list --json
```

Affiche chaque plan actif dans le `PlanStore` côté bun. Sans `--json`, chaque plan se rend ainsi :

```
ws:5  claude:1
  ✓  M1       Explore code
  ●  M2       Implement fix
  ○  M3       Run tests
  ○  M4       Commit
```

## plan set

```bash
ht plan set --workspace ws:5 --agent claude:1 --json '[
  {"id":"M1","title":"Explore","state":"done"},
  {"id":"M2","title":"Implement","state":"active"},
  {"id":"M3","title":"Test","state":"waiting"},
  {"id":"M4","title":"Commit","state":"waiting"}
]'
```

Remplace le plan pour `(workspaceId, agentId?)`. Les étapes arrivent comme un tableau JSON ; chaque entrée nécessite au minimum `id` et `title` (l'état vaut `waiting` par défaut). Réémettre `set` est la manière canonique de **réécrire** un plan — `update` ne corrige qu'une étape à la fois.

| Option | Rôle |
|---|---|
| `--workspace <id>` | Espace de travail cible. Optionnel à l'intérieur d'un panneau τ-mux (le serveur résout l'espace de travail à partir de `HT_SURFACE`) ; requis depuis un shell hors panneau, ou passez `HT_WORKSPACE_ID`. |
| `--agent <id>` | Optionnel. Permet à plusieurs agents dans le même espace de travail de posséder des plans séparés. |
| `--json '<steps>'` | Le tableau complet des étapes (requis). |

Le CLI parse votre JSON localement et le transmet tel quel — un JSON invalide sort avec un code non nul avec une erreur de parsing avant d'atteindre le socket.

## plan update

```bash
ht plan update M2 --workspace ws:5 --agent claude:1 --state done
ht plan update M2 --workspace ws:5 --title "Implement fix v2"
ht plan update M3 --workspace ws:5 --state active
```

Corrige une seule étape. `--state` accepte `done|active|waiting|err`. `--title` remplace le titre de l'étape. L'une ou l'autre, ou les deux, peuvent être passées.

Lorsque l'étape nommée n'existe pas, le CLI affiche `(no plan)` — pas une erreur, juste un signal que le patch a manqué. `update` contre un plan obsolète ne plante jamais.

## plan complete

```bash
ht plan complete --workspace ws:5 --agent claude:1
```

Marque chaque étape `done` en un seul appel. Utile comme signal « j'ai terminé » de l'agent — combiné avec `plan clear`, cela donne aux scripts un chemin propre de fin et de démontage :

```bash
trap 'ht plan complete' EXIT   # inside a τ-mux pane, no flags needed
```

## plan clear

```bash
ht plan clear --workspace ws:5 --agent claude:1
```

Supprime entièrement le plan. Renvoie :

- `ok (plan removed)` — le plan existait et a été supprimé.
- `(no plan to clear)` — rien n'était enregistré pour cette clé.

## Pont par clé de statut

Les clés `ht set-status` dont le nom contient « plan » et dont la valeur est un tableau JSON d'objets `{id, title, state}` sont **automatiquement reflétées** dans le `PlanStore` typé — les agents qui publient déjà des checklists via le [système intelligent de clés de statut](/fr/features/sidebar/) allument le panneau plan gratuitement, sans appel `ht plan` requis :

```bash
ht set-status build_plan '[{"id":"compile","title":"Compile","state":"active"}]'
# → both the sidebar smart-key renderer AND the plan panel update.
```

Le pont dérive l'`agentId` du plan à partir de la surface (`status:<surfaceId>`) pour que chaque surface obtienne sa propre carte de plan.

## Environnement

| Variable | Rôle |
|---|---|
| `HT_SURFACE` | Auto-défini dans les panneaux τ-mux. Le serveur résout l'espace de travail propriétaire à partir de celui-ci, donc `--workspace` est optionnel à l'intérieur d'un panneau. |
| `HT_WORKSPACE_ID` | Remplacement explicite optionnel. **Pas** auto-défini — exportez-le manuellement si vous voulez qu'un shell hors panneau utilise par défaut un espace de travail spécifique. |

## Pour aller plus loin

- [Vue d'ensemble du panneau plan](/fr/features/plan-panel/)
- [Moteur d'auto-continue](/fr/features/auto-continue/) — utilise le plan publié pour décider quand envoyer `Continue` automatiquement.
- [`ht autocontinue`](/fr/cli/autocontinue/) — pilote du moteur.
