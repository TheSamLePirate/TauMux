---
title: Ask-user (agent → humain)
description: Un protocole typé permettant à un agent de poser à l'utilisateur une question oui/non, à choix multiples, en texte libre, ou « confirmer cette commande » — répondue depuis la fenêtre modale τ-mux, un shell voisin ou Telegram.
sidebar:
  order: 11
---

Lorsqu'un agent (un script CLI, un agent de codage, une automatisation longue durée) a besoin d'une saisie humaine, il ne devrait pas écrire une question dans le flux du terminal en espérant que vous la remarquiez. τ-mux livre un protocole structuré — `ht ask` côté agent, une fenêtre modale dans la webview côté utilisateur — qui fait remonter chaque question avec son attribution et achemine la réponse de manière déterministe.

## Ce qu'il fait

- **Quatre types de questions.** `yesno`, `choice`, `text`, et `confirm-command` (une porte à deux étapes ack → run pour les commandes destructives).
- **Fenêtre modale dans la webview.** Lorsqu'une requête arrive pour la surface focalisée, une feuille centrée apparaît avec le titre, le corps, l'attribution (espace de travail · panneau · agent), et des contrôles adaptés au type.
- **FIFO par surface.** Plusieurs requêtes simultanées sur différentes surfaces sont isolées ; une même surface les met en file d'attente dans l'ordre d'arrivée.
- **Pastille en attente dans la barre latérale.** Lorsqu'une question est ouverte sur un espace de travail qui n'est pas focalisé, une pastille cyan `N ?` apparaît sur la carte de cet espace de travail. Cliquez sur l'espace de travail, la fenêtre modale s'ouvre.
- **Routage Telegram.** Optionnel. Chaque question en file d'attente est diffusée vers les conversations Telegram autorisées avec des boutons adaptés au type (`Yes`/`No`, un bouton par choix, force-reply pour le texte, confirmation à deux étapes). À la résolution, le message d'origine est édité sur place avec un titre barré et un pied de page comme `✓ answered: yes` afin que la conversation se lise comme un journal d'audit propre.
- **Instantané au démarrage.** Si la webview est rechargée ou se rattache pendant qu'une question est en cours, elle récupère la liste des questions en attente actuelle depuis bun et réaffiche la fenêtre modale. Aucune requête orpheline.

## Exemple rapide

Depuis n'importe quel shell voisin :

```bash
ht ask yesno --title "Run install?" --body "Lockfile changed"
# Modal pops in the active τ-mux pane.
# Click Yes → CLI prints "yes" and exits 0.
# Click No  → CLI prints "no"  and exits 0.
# Esc/Cancel → exits 3.
# Timeout    → exits 2.
```

```bash
ht ask choice --title "Branch" --choices main,dev,feature/x
# One button per choice; first choice auto-focused.
# Returns the selected id on stdout.
```

```bash
ht ask text --title "Commit message" --default "wip"
# Text input pre-filled with "wip".
# Enter submits; empty submit shakes (refuses).
```

```bash
ht ask confirm-command --title "Run command" --body "rm -rf ./build" --unsafe
# Step 1: red "This will execute on your machine" banner +
#         [I understand] / [Cancel] buttons.
# Step 2 (after ack): [Run] (red) / [Back] / [Cancel].
# Two deliberate clicks, never one. Enter intentionally does not submit.
```

L'invocation `ht ask` de l'agent bloque jusqu'à ce que vous répondiez, annuliez, ou que le `--timeout` optionnel expire.

## Résumé du comportement

| Type | Corps de la modale | Boutons | Entrée | Sortie CLI |
|---|---|---|---|---|
| `yesno` | titre + corps | `Yes` (principal) · `No` · `Cancel` | soumet « yes » | 0 avec `yes` / `no` ; 3 à l'annulation |
| `choice` | titre + corps | un par choix + `Cancel` | soumet le premier choix | 0 avec `<choice id>` ; 3 à l'annulation |
| `text` | titre + corps + champ (utilise `--default`) | `Submit` · `Cancel` | soumet la valeur saisie (vide secoue) | 0 avec la chaîne saisie ; 3 à l'annulation |
| `confirm-command` | titre + corps + bloc de code | étape 1 : `I understand` / `Cancel` ; étape 2 : `Run` / `Back` / `Cancel` | ne soumet **pas** (clics délibérés) | 0 avec `run` ; 3 à l'annulation |

Un drapeau `--timeout <ms>` sur `ht ask` résout automatiquement la requête comme `timeout` (code de sortie 2) si aucune réponse n'arrive à temps.

## Comment les réponses sont acheminées

Trois chemins de réponse partagent une seule source de vérité (la file d'attente côté bun) :

1. **La fenêtre modale dans la webview** de τ-mux — les clics envoient `askUserAnswer` / `askUserCancel` via le pont Electrobun.
2. **CLI voisin** — `ht ask answer <id> <value>` et `ht ask cancel <id>` depuis un autre shell. Utile pour scripter des tests ou piloter depuis un shell distant.
3. **Telegram** — taps sur les boutons inline (ou une réponse `force_reply` pour le type `text`). Le premier tap gagne ; les taps ultérieurs d'autres utilisateurs autorisés voient « (no such id — already resolved) ».

Quel que soit le chemin qui résout une requête, la file d'attente bun émet un seul événement `resolved` que la fenêtre modale capte (pour se fermer), que Telegram capte (pour le pied de page édité sur place), et que l'invocation `ht ask` de l'agent capte (stdout + sortie).

## Trace d'audit Telegram

Lorsque `Settings → Telegram → Route ht ask to Telegram` est activé, l'historique de la conversation devient un journal auto-documenté de chaque question et de sa réponse :

```
[bot]  Run install?
       Lockfile changed
       [Yes] [No] [Cancel]

[you]  → tap Yes

[bot]  ~~Run install?~~
       Lockfile changed
       ✓ answered: yes
```

Faites défiler la conversation — chaque invite a sa résolution apposée dessus.

## Cas d'une surface en arrière-plan

Lorsqu'un agent déclenche `ht ask` sur une surface qui n'est **pas** actuellement focalisée :

- La fenêtre modale **ne vole pas** le focus de votre surface active.
- La carte de la barre latérale de l'espace de travail d'origine affiche une pastille cyan `1 ?`.
- Cliquez sur l'espace de travail → la fenêtre modale s'ouvre avec la requête en tête pour la surface active.
- Revenir à une surface sans question en attente masque la fenêtre modale mais **n'annule pas** — la requête reste ouverte jusqu'à ce que vous répondiez, annuliez ou expiriez.

## Fichiers source

- `src/bun/ask-user-queue.ts` — la file d'attente (FIFO + timeouts + abonnés).
- `src/bun/rpc-handlers/ask-user.ts` — `agent.ask_user` / `agent.ask_pending` / `agent.ask_answer` / `agent.ask_cancel`.
- `src/bun/ask-user-telegram.ts` — diffusion Telegram + helpers d'édition sur place.
- `src/views/terminal/ask-user-state.ts` — miroir FIFO par surface côté webview.
- `src/views/terminal/ask-user-modal.ts` — la fenêtre modale (quatre variantes par type, porte de confirmation à deux étapes).
- `bin/ht ask` — point d'entrée CLI.

## Pour aller plus loin

- [Référence CLI `ht ask`](/fr/cli/ask-user/)
- [Méthodes JSON-RPC `agent.*`](/fr/api/agent/)
- [Pont Telegram](/fr/features/telegram-bridge/) — la couche de routage pour la diffusion des questions
