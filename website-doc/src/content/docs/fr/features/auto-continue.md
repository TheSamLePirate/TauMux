---
title: Auto-continue
description: Un moteur heuristique + LLM optionnel qui décide s'il faut envoyer `Continue` à un agent à chaque notification de fin de tour — avec dry-run, cooldown, protection contre l'emballement et un anneau d'audit complet.
sidebar:
  order: 13
---

Les agents longue durée — Claude Code, pi, shells personnalisés — produisent fréquemment une notification de fin de tour demandant à l'utilisateur de taper « Continue ». Quand l'utilisateur est attentif c'est très bien ; quand il ne l'est pas, l'agent se bloque. Auto-continue ferme cette boucle : à chaque notification de fin de tour, le moteur consulte le [plan publié](/fr/features/plan-panel/) de l'agent, les dernières lignes de la surface, et (optionnellement) un LLM rapide, puis décide s'il faut envoyer `Continue` automatiquement.

## Posture de sécurité

Trois couches de sécurité sont livrées par défaut — l'activation se fait en deux clics délibérés.

1. **Moteur désactivé par défaut.** Une installation neuve ne décide jamais de quoi que ce soit. Vous activez la fonctionnalité dans `Settings → Auto-continue → Engine`.
2. **Dry-run par défaut.** Même après activation, le moteur enregistre les décisions dans l'anneau d'audit sans envoyer de texte. Désactivez `Dry run` quand vous avez confiance en ce que vous voyez.
3. **Garde-fous par surface.** Un cooldown (par défaut 3 s) empêche le moteur de bavarder avec un agent rapide ; un compteur d'emballement (par défaut 5) met auto-continue en pause s'il se déclenche autant de fois sans saisie utilisateur intermédiaire.

## Modes du moteur

| Mode | Ce qui se passe |
|---|---|
| `off` | Le moteur ne décide jamais de rien. |
| `heuristic` | Arbre de décision pur. Aucun appel de modèle. Rapide, gratuit, déterministe. |
| `model` | Chaque fin de tour consulte le LLM configuré (Anthropic Haiku 4.5 par défaut). Bascule sur l'heuristique en cas d'échec réseau / parsing. |
| `hybrid` | Heuristique d'abord ; appelle le modèle uniquement quand l'heuristique retourne une attente ambiguë (pas de plan, pas d'erreur, pas de question). Économise des jetons par rapport à `model` toujours actif. |

## L'heuristique

Une fonction pure (`decideAutoContinue` dans `src/bun/auto-continue.ts`) qui retourne `{ action: "continue" | "wait", reason, instruction? }` :

1. **Garde d'erreur.** Le texte de notification ou la fin de la surface mentionne « error » / « failed » → wait.
2. **Garde de question.** La fin de la surface (5 dernières lignes non vides) se termine par un `?` → wait. L'agent demande quelque chose à l'utilisateur.
3. **Étape active ou en attente.** Le plan a une étape `active` → émet `Continue <activeStep.id>`. Sinon, la première étape `waiting`.
4. **Tout terminé / err uniquement.** Chaque étape `done` ou `err` → wait. L'agent a fini.
5. **Aucun plan publié.** Pas d'ancrage → wait. (En mode `hybrid` c'est ce cas qui escalade vers le modèle.)

L'heuristique ne lève jamais d'exception. Chaque raison est tronquée à ≤120 caractères pour que l'anneau d'audit reste lisible.

## Le modèle

Quand le moteur tourne en mode `model` ou `hybrid`, il appelle l'API Messages d'Anthropic avec un prompt structuré :

```
Decide whether to auto-continue an agent's multi-step plan.
Respond ONLY as JSON; do not explain.
Schema: { action: 'continue'|'wait', reason: string, instruction?: string }

Plan steps:
- [done]    M1: Explore
- [active]  M2: Implement
- [waiting] M3: Test

Turn-end notification: implement done — running tests next?

Last lines of agent surface:
> ✓ all checks passed
> next: M3
```

Le modèle retourne du JSON. Les fences markdown sont tolérées. Les chaînes de raison sont tronquées à 200 caractères ; les chaînes d'instruction à 240. Toute déviation du contrat fait basculer le moteur sur l'heuristique — l'utilisateur ne voit jamais une réponse de modèle à moitié parsée.

La clé d'API est lue depuis la variable d'environnement nommée dans `Settings → Auto-continue → API key env var` (par défaut `ANTHROPIC_API_KEY`). Jamais écrite dans `settings.json`.

## Paramètres

`Settings → Auto-continue` (entre Telegram et Advanced).

| Champ | Défaut | Notes |
|---|---|---|
| Engine | `off` | Le sélecteur de mode. |
| Dry run | `true` | Enregistre uniquement les décisions ; n'envoie jamais de texte. |
| Cooldown (ms) | `3000` | Écart minimum entre déclenchements automatiques sur la même surface. Borné 0–60000. |
| Max consecutive | `5` | Pause après autant de déclenchements sans saisie utilisateur. Borné 1–50. |
| Model name | `claude-haiku-4-5-20251001` | N'importe quel id de modèle Anthropic. |
| API key env var | `ANTHROPIC_API_KEY` | La variable d'environnement shell que le moteur lit au moment de la requête. |

Le moteur relit sa configuration à chaque dispatch, donc une bascule dans Settings prend effet immédiatement pour la prochaine fin de tour. Aucun redémarrage nécessaire.

## Anneau d'audit

Chaque décision atterrit dans un anneau en mémoire (capacité 50 entrées) et est diffusée vers :

- La zone « AUTO-CONTINUE · LAST N » du panneau plan (debounced 100 ms).
- Le widget plan du miroir web sur la même enveloppe.
- `ht autocontinue audit` depuis le CLI.

Chaque entrée : `{ at, surfaceId, agentId?, outcome, reason, engine, modelConsulted }`. Les outcomes sont `fired`, `dry-run`, `skipped`, `paused`, `resumed`. L'audit n'existe qu'en mémoire — un redémarrage repart à zéro.

## Pause / reprise par surface

Au-delà du paramètre global du moteur, vous pouvez épingler une surface unique :

```bash
ht autocontinue pause surface:1   # this surface stops auto-continuing
ht autocontinue resume surface:1  # back on; runaway counter reset too
```

La pause est administrative — elle survit aux changements de mode du moteur. Une saisie utilisateur réelle sur la surface en pause ne l'efface **pas** (seul `resume` le fait), parce que taper un seul caractère ne devrait pas annuler une pause délibérée.

Le compteur d'emballement est séparé : quand un agent boucle, le moteur se met lui-même en pause avec une ligne d'audit `looped — N auto-continues without user input`. Cette auto-pause **est** effacée quand l'utilisateur tape dans la surface (`notifyHumanInput` est branché à chaque site `writeStdin` d'origine humaine).

## Ce qu'on entend par « saisie utilisateur réelle »

Le compteur d'emballement du moteur se réinitialise sur :

| Source de saisie | Réinitialise le compteur ? |
|---|---|
| Frappe webview (saisie dans le panneau τ-mux) | oui |
| Coller Cmd-V | oui |
| `ht surface send_text` / `send_key` depuis un shell voisin | oui (traité comme distant-mais-humain) |
| Frappe dans le miroir web (saisie dans un navigateur) | oui |
| Script de connexion / setup d'espace de travail (`runScript`) | non (origine système) |
| Le `sendText` propre au moteur | non (garde récursive) |

## Déclenchement manuel

```bash
ht autocontinue fire surface:1
```

Force un dispatch via le même pipeline de lookup que celui utilisé pour les notifications de fin de tour. Le moteur respecte toujours chaque garde — moteur off, en pause, cooldown, dry-run s'appliquent tous. Utile quand :

- On teste une décision heuristique / modèle sans attendre une vraie notification d'agent.
- On pilote le moteur depuis un script qui sait que l'agent a fini mais n'a pas déclenché `ht notify`.

## Comment une fin de tour devient une décision

```
agent (e.g. Claude Code Stop hook)
   │
   │  ht notify --title "implement done" --surface "$HT_SURFACE"
   ▼
notification.create RPC
   │
   │  hook fires onCreate(notification)
   ▼
autoContinueHost.dispatchForNotification(n)
   │  - lookupPlanForSurface(surfaceId)   → most-recent plan in workspace
   │  - lookupSurfaceTail(surfaceId)       → last 12 ANSI-stripped lines
   ▼
engine.dispatch({surfaceId, plan, surfaceTail, notificationText})
   │  1. engine === "off"          → skipped
   │  2. surface paused             → skipped
   │  3. heuristic                  → continue / wait
   │  4. (hybrid + ambiguous wait)  → call model, override decision
   │  5. cooldown / runaway gates   → skipped
   │  6. dry-run                    → audit-only, never sends
   │  7. fire: sessions.writeStdin(surfaceId, instruction + "\n")
   ▼
audit ring update → plan panel re-renders
```

## Fichiers source

- `src/bun/auto-continue.ts` — heuristique pure.
- `src/bun/auto-continue-engine.ts` — wrapper du moteur (paramètres, cooldown, emballement, audit, appel modèle).
- `src/bun/auto-continue-host.ts` — helpers hôte (lookup plan, fin de surface, dispatch, déclenchement manuel).
- `src/bun/rpc-handlers/auto-continue.ts` — gestionnaires JSON-RPC `autocontinue.*`.
- `src/views/terminal/plan-panel.ts` — zone d'audit dans la barre latérale (natif).
- `src/web-client/plan-panel-mirror.ts` — zone d'audit dans la barre latérale (miroir web).
- `bin/ht autocontinue` — point d'entrée CLI.
- `tests/auto-continue-engine.test.ts`, `auto-continue-pause.test.ts`, `auto-continue-rpc.test.ts` — couverture unitaire.

## Pour aller plus loin

- [Référence CLI `ht autocontinue`](/fr/cli/autocontinue/) — chaque sous-commande avec exemples.
- [Panneau plan](/fr/features/plan-panel/) — les données que le moteur lit, et la surface qui affiche l'anneau d'audit.
- [Settings](/fr/features/settings/) — vue d'ensemble de l'UI incluant la section Auto-continue.
