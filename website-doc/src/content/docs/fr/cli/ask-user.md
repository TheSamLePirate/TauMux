---
title: Ask-user
description: ht ask — bloque sur une question structurée ; ask pending / answer / cancel pour le côté qui répond.
sidebar:
  order: 10
---

`ht ask` est le côté agent du [protocole ask-user](/fr/features/ask-user/). L'agent invoque l'un des quatre kinds et **bloque** sur stdout jusqu'à ce que vous répondiez, annuliez, ou que le `--timeout` optionnel s'écoule. Les sous-commandes sœurs (`pending`, `answer`, `cancel`) sont destinées aux scripts ou aux chemins de réponse à distance.

## Codes de sortie

| Code | Signification |
|---|---|
| `0` | Répondu. Stdout porte la réponse (`yes` / `no` / id du choix / texte saisi / `run`). |
| `2` | Délai dépassé. |
| `3` | Annulé (Esc, bouton Cancel, sous-commande sœur `ht ask cancel`, `/cancel` dans Telegram). |

## ask yesno

```bash
ht ask yesno --title "Run install?" --body "Lockfile changed"
# Modal pops; user clicks Yes → prints `yes` and exits 0.
```

| Option | Rôle |
|---|---|
| `--title <s>` | Invite d'une ligne (requis). |
| `--body <s>` | Corps multi-lignes, texte brut. |
| `--agent-id <s>` | Attribution affichée dans l'en-tête de la modale (par ex. `claude:1`). |
| `--surface <id>` | Remplace la surface d'origine (par défaut `HT_SURFACE`). |
| `--timeout <ms>` | Annule automatiquement après ce nombre de ms ; sortie 2. |

Stdout : `yes` ou `no` à l'acceptation, vide en cas d'annulation/délai dépassé.

## ask choice

```bash
ht ask choice --title "Branch" --choices main,dev,feature/x
# Returns the selected choice id on stdout.

ht ask choice --title "Branch" --choices "main:Main,dev:Develop"
# Use id:label syntax for friendly labels.
```

| Option | Rôle |
|---|---|
| `--choices <list>` | Séparée par des virgules. Chaque entrée est `id` ou `id:label`. (requis, ≥1) |
| Toutes les options de `yesno` ci-dessus | (mêmes sémantiques) |

Stdout : l'id du choix sélectionné à l'acceptation.

## ask text

```bash
ht ask text --title "Commit message" --default "wip"
# User types into the input; Enter submits.
```

| Option | Rôle |
|---|---|
| `--default <s>` | Pré-remplit l'entrée. |
| Toutes les options de `yesno` ci-dessus | (mêmes sémantiques) |

Une soumission vide est refusée (l'entrée tremble). Stdout : la valeur saisie à l'acceptation.

## ask confirm-command

```bash
ht ask confirm-command \
  --title "Run command" \
  --body "rm -rf ./build" \
  --unsafe
# Two-step gate: [I understand] → [Run].
```

| Option | Rôle |
|---|---|
| `--unsafe` | Affiche le traitement destructeur (bannière rouge + `[Run]` en rouge). L'option du fil est préservée de bout en bout pour que la modale et Telegram mettent tous deux en évidence le risque. |
| Toutes les options de `yesno` ci-dessus | (mêmes sémantiques) |

Deux clics délibérés sont nécessaires pour accepter ; Entrée ne soumet intentionnellement pas. Stdout : `run` à l'acceptation.

## ask pending

```bash
ht ask pending
# id      surface       kind             title
# req:1   surface:1     yesno            Run install?
# req:2   surface:3     confirm-command  rm -rf ./build

ht ask pending --surface surface:1 --json
```

Liste les requêtes ouvertes. Utilisez ceci depuis un shell sœur lorsque vous voulez piloter le côté qui répond via `ht ask answer` ou `ht ask cancel` plutôt que la modale / Telegram.

## ask answer

```bash
ht ask answer req:1 yes
# resolves request req:1 with the answer "yes" — the agent's blocking
# `ht ask yesno` invocation in the other shell unblocks and exits 0.

ht ask answer req:1 yes --json
# {"resolved": true}
```

| Argument | Rôle |
|---|---|
| `<request_id>` | L'id provenant de `ht ask pending`. |
| `<value>` | La réponse selon le kind (`yes` / `no` / id du choix / texte saisi / `run`). |

Renvoie `{ "resolved": true }` lorsque l'id correspond. `{ "resolved": false }` lorsque l'id était inconnu (déjà résolu ou n'a jamais existé) — sortie 0 dans les deux cas ; le booléen est le signal significatif.

## ask cancel

```bash
ht ask cancel req:1
ht ask cancel req:1 --reason "user is afk"
```

Même forme que `ask answer` ; l'invocation `ht ask` de l'agent sort avec le code 3 avec une raison optionnelle sur stderr.

## Environnement

| Variable | Rôle |
|---|---|
| `HT_SURFACE` | `surface_id` par défaut pour le processus qui demande. Défini automatiquement lorsque `ht ask` est lancé depuis un panneau τ-mux ; passez `--surface` explicitement lors d'un appel depuis l'extérieur. |

## Pour aller plus loin

- [Vue d'ensemble de la fonctionnalité ask-user](/fr/features/ask-user/)
- [Méthodes JSON-RPC `agent.*`](/fr/api/agent/)
- [Pont Telegram](/fr/features/telegram-bridge/) — routage côté chat pour le chemin de réponse
