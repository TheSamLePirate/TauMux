---
title: agent.*
description: ask_user, ask_pending, ask_answer, ask_cancel — la surface JSON-RPC pour le protocole agent → humain « ask-user ».
sidebar:
  order: 10
---

Les agents appellent `agent.ask_user` lorsqu'ils ont besoin d'une réponse humaine structurée (oui/non, choix multiple, texte libre ou « confirmer cette commande »). La file d'attente côté bun conserve la requête jusqu'à ce que la [modale du webview](/fr/features/ask-user/), une CLI sœur ou [Telegram](/fr/features/telegram-bridge/) la résolve. L'appel `agent.ask_user` lui-même est **long-pending** — il retourne la réponse en un seul aller-retour, sans polling requis.

| Méthode | Params | Résultat |
|---|---|---|
| `agent.ask_user` | `{ surface_id: string, kind: "yesno"\|"choice"\|"text"\|"confirm-command", title: string, body?: string, agent_id?: string, choices?: Array<{ id: string, label?: string }>, default?: string, timeout_ms?: number, unsafe?: boolean }` | `{ request_id: string, action: "ok"\|"cancel"\|"timeout", value?: string, reason?: string }` |
| `agent.ask_pending` | `{ surface_id?: string }` | `{ pending: AskUserRequest[] }` |
| `agent.ask_answer` | `{ request_id: string, value: string }` | `{ resolved: boolean }` |
| `agent.ask_cancel` | `{ request_id: string, reason?: string }` | `{ resolved: boolean }` |

## agent.ask_user

L'appel de demande. Valide `params` strictement, dépose une requête dans la file d'attente et **ne répond pas tant que la requête n'est pas résolue** (répondue, annulée ou expirée).

| Param | Requis | Notes |
|---|---|---|
| `surface_id` | oui | Surface d'origine — pilote l'ancrage de la modale et l'attribution Telegram. |
| `kind` | oui | Une valeur parmi `yesno` / `choice` / `text` / `confirm-command`. |
| `title` | oui | Invite sur une ligne. |
| `body` | non | Corps multi-lignes (texte brut ; le markdown est réservé à un futur polish du panneau). |
| `agent_id` | non | Étiquette d'attribution (ex. `claude:1`) — affichée dans l'en-tête de la modale. |
| `choices` | pour `kind=choice` | Tableau non vide. Chaque entrée nécessite un `id` ; `label` vaut par défaut `id`. |
| `default` | non | Valeur pré-remplie / pré-sélectionnée (interprétée selon le kind). |
| `timeout_ms` | non | Se résout automatiquement avec `action: "timeout"` après ce nombre de ms. |
| `unsafe` | non | Indice de rendu pour `confirm-command` — pilote le traitement destructif dans la modale et Telegram. Le drapeau wire est préservé de bout en bout. |

Sémantique de `value` dans la réponse, par kind :

| Kind | `value` lors de `action: "ok"` |
|---|---|
| `yesno` | `"yes"` ou `"no"` |
| `choice` | l'id du choix sélectionné |
| `text` | la chaîne saisie |
| `confirm-command` | `"run"` (uniquement après le filtre en deux étapes ack → run) |

`action: "cancel"` et `action: "timeout"` ne portent aucune `value`. `action: "cancel"` peut porter `reason`.

## agent.ask_pending

Instantané des requêtes en attente. Utile pour un webview / panneau qui vient juste de s'attacher et a besoin d'amorcer son état local, ou pour une CLI sœur qui veut afficher ce qui est ouvert.

```json
{ "id": "1", "method": "agent.ask_pending", "params": { "surface_id": "surface:3" } }
// { "pending": [
//   { "request_id": "req:1", "surface_id": "surface:3", "kind": "yesno", "title": "Run install?", "created_at": 1714280000000 }
// ]}
```

`surface_id` filtre ; omettez-le pour la file complète.

## agent.ask_answer

Résoudre une requête comme étant la réponse de l'utilisateur. L'appel long-pending d'origine `agent.ask_user` retourne avec `action: "ok"` et la `value` fournie.

```json
{ "id": "2", "method": "agent.ask_answer", "params": { "request_id": "req:1", "value": "yes" } }
// { "resolved": true }
```

`{ "resolved": false }` signifie que l'id ne correspondait pas — déjà résolu (timeout, annulation, ou un autre chemin vous a précédé) ou n'a jamais existé. Idempotent sur les ids inconnus.

## agent.ask_cancel

Résoudre une requête comme annulée. L'appel `agent.ask_user` d'origine retourne `action: "cancel"` avec la `reason` optionnelle sur `stderr` de l'invocation `ht ask` appelante.

```json
{ "id": "3", "method": "agent.ask_cancel", "params": { "request_id": "req:1", "reason": "user is afk" } }
// { "resolved": true }
```

## Événements push

Le webview et le miroir web reçoivent également ces messages comme push sur les canaux bun → client :

| Push | Quand | Charge utile |
|---|---|---|
| `askUserEvent: kind="shown"` | Une nouvelle requête arrive dans la file. | `{ request: AskUserRequest }` |
| `askUserEvent: kind="resolved"` | Une requête se résout (réponse/annulation/timeout). | `{ request_id, response: AskUserResponse }` |
| `askUserEvent: kind="snapshot"` | Réponse à un ping `askUserRequestSnapshot` du webview. | `{ pending: AskUserRequest[] }` |

La modale du webview les utilise pour effectuer son rendu en temps réel sans polling.

## Équivalents CLI

| Méthode | CLI |
|---|---|
| `agent.ask_user` (kind=yesno) | `ht ask yesno --title "..." --body "..."` |
| `agent.ask_user` (kind=choice) | `ht ask choice --title "..." --choices a,b,c` |
| `agent.ask_user` (kind=text) | `ht ask text --title "..." --default "..."` |
| `agent.ask_user` (kind=confirm-command) | `ht ask confirm-command --title "..." --body "..." --unsafe` |
| `agent.ask_pending` | `ht ask pending` |
| `agent.ask_answer` | `ht ask answer <id> <value>` |
| `agent.ask_cancel` | `ht ask cancel <id>` |

## Pour aller plus loin

- [Vue d'ensemble de la fonctionnalité ask-user](/fr/features/ask-user/)
- [Référence CLI `ht ask`](/fr/cli/ask-user/)
- [Pont Telegram](/fr/features/telegram-bridge/) — routage côté Telegram pour le chemin de réponse
