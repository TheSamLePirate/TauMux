---
title: Panneau plan
description: Une vue typée, rendue dans la barre latérale, de chaque plan d'agent actif — maintenue en synchronisation avec les appels `ht plan` et exposée en direct dans l'UI native comme dans le miroir web.
sidebar:
  order: 12
---

Lorsqu'un agent (Claude Code, pi, un script personnalisé) maintient un plan multi-étapes — Explore → Implement → Test → Commit — τ-mux affiche ce plan dans un widget dédié de la barre latérale plutôt que de laisser chaque agent l'écrire dans la sortie de son terminal. Le widget est en lecture seule par conception : l'agent possède le plan, le panneau le montre.

## Ce qu'il fait

- **Une seule source de vérité.** Les plans vivent dans le `PlanStore` côté bun, indexés par `(workspaceId, agentId?)`. `ht plan set` / `update` / `complete` / `clear` les mutent ; le panneau écoute via le canal de push `restorePlans`.
- **États d'étape avec glyphes.** Chaque étape s'affiche comme `✓ done` · `● active` · `○ waiting` · `✗ err`. Les étapes actives sont animées pour que l'utilisateur voie la progression d'un coup d'œil.
- **Cliquer pour focaliser.** Cliquer sur une carte de plan bascule vers l'espace de travail d'origine.
- **Anneau d'audit.** Chaque décision d'[auto-continue](/fr/features/auto-continue/) (fired / dry-run / skipped / paused / resumed) apparaît sous le plan. Capacité 50 entrées en mémoire, debounced 100 ms sur le fil.
- **Parité avec le miroir web.** Le même panneau s'affiche dans le [miroir web](/fr/features/web-mirror/), lisant les enveloppes `plansSnapshot` et `autoContinueAudit` depuis le WebSocket.
- **Pont via clé de statut.** Les agents qui publient des checklists au format plan via `ht set-status <key-with-"plan"> '<json-array>'` allument le panneau **sans changer leur code de publication** — le rendu intelligent par clé dans la barre latérale continue aussi de fonctionner.

## Exemple rapide

```bash
# Inside a τ-mux pane HT_SURFACE is auto-set, so the workspace is
# resolved server-side — no --workspace flag needed.
ht plan set --agent claude:1 --json '[
  {"id":"M1","title":"Explore","state":"active"},
  {"id":"M2","title":"Implement","state":"waiting"},
  {"id":"M3","title":"Test","state":"waiting"},
  {"id":"M4","title":"Commit","state":"waiting"}
]'

# As work progresses:
ht plan update M1 --state done
ht plan update M2 --state active

# When done:
ht plan complete
ht plan clear

# From outside τ-mux, pass --workspace explicitly:
#   ht plan set --workspace ws:5 --json '[…]'
```

Le widget de la barre latérale affiche la carte dès que `set` arrive ; les mises à jour s'animent en 100 ms après chaque `update`.

## Anatomie d'une carte de plan

```
ws:5  claude:1                       ← header (workspace · agent)
0/3 done · 1 active                  ← progress summary
●  M1   Explore                      ← step rows
○  M2   Implement
○  M3   Test
AUTO-CONTINUE · LAST 3               ← audit ring header
fired      next plan step: M2
skipped    cooldown — 1842ms
dry-run    would continue: M2
```

Les plans vides sont masqués — quand rien n'est publié dans aucun espace de travail, le panneau se réduit à hauteur zéro.

## Comment fonctionne le pont

Le système intelligent de clé de statut (Plan #02) rend n'importe quelle valeur `ht set-status` avec un kind connu (`pct`, `lineGraph`, etc.). Plan #09 commit C ajoute un robinet sur ce pipeline :

1. `ht set-status build_plan '[…steps…]'` arrive dans le dispatch bun.
2. La diffusion intelligente par clé dans la barre latérale se déclenche inchangée.
3. Le `planStatusBridge` inspecte la même charge utile — si la clé contient « plan » et que la valeur se parse comme un tableau JSON d'objets `{id, title, state?}`, il appelle `PlanStore.set` avec `agentId: status:<surfaceId>`.
4. Le panneau plan se ré-affiche.

La correspondance est intentionnellement étroite (le nom de clé doit contenir « plan », la valeur doit être un tableau JSON-string). Tout ce qui sort de ce contrat passe en silence.

| Utilisez ceci si | … |
|---|---|
| Vous écrivez un nouvel agent | Appelez `ht plan set` directement — typé, conscient de l'attribution, supporte plusieurs agents par espace de travail. |
| Vous avez un agent qui émet déjà des clés de statut | Renommez la clé pour inclure « plan » et utilisez la bonne forme de charge utile — la barre latérale et le panneau s'allument tous deux. |

## Comment auto-continue utilise le plan

Le [moteur auto-continue](/fr/features/auto-continue/) lit le plan le plus récemment mis à jour dans l'espace de travail propriétaire de la surface à chaque notification de fin de tour. L'heuristique décide :

- Le plan a au moins une étape `waiting` ou `active` → continue (instruction de type `Continue M3`).
- Chaque étape `done` → wait (l'agent a fini).
- Aucun plan publié → wait (pas d'ancrage ; ambigu).

Une attente confiante bloque ; une attente ambiguë peut escalader vers le modèle en mode `hybrid`. L'anneau d'audit sur le panneau reflète chaque décision.

## Fichiers source

- `src/bun/plan-store.ts` — store en mémoire indexé ; `set` / `update` / `complete` / `clear` / `list` / `subscribe`.
- `src/bun/rpc-handlers/plan.ts` — gestionnaires JSON-RPC `plan.*`.
- `src/bun/plan-status-bridge.ts` — traducteur `plan_array`.
- `src/shared/plan-panel-render.ts` — helpers HTML purs partagés entre natif + miroir.
- `src/views/terminal/plan-panel.ts` — widget natif de la barre latérale.
- `src/web-client/plan-panel-mirror.ts` — rendu pour le miroir web.
- `bin/ht plan` — point d'entrée CLI.
- `tests/plan-store.test.ts`, `tests/plan-panel-renderer.test.ts`, `tests/auto-continue-bridge.test.ts` — couverture unitaire.

## Pour aller plus loin

- [Référence CLI `ht plan`](/fr/cli/plan/) — chaque sous-commande avec exemples.
- [Auto-continue](/fr/features/auto-continue/) — le moteur qui lit les plans et décide s'il faut envoyer `Continue`.
- [Référence CLI `ht autocontinue`](/fr/cli/autocontinue/) — pilote du moteur.
