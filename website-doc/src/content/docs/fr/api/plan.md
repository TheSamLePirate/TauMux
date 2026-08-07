---
title: plan.*
description: set, update, complete, clear, list — le panneau de plan.
---

Plans multi-étapes rendus dans le [panneau de plan](/fr/features/plan-panel/).
Les plans sont indexés par `(workspace_id, agent_id)` : plusieurs agents
publient donc des plans indépendants dans le même espace. La liste de tâches
native de Claude Code y est reflétée automatiquement — voir
[l'intégration Claude Code](/fr/integrations/claude-code/).

| Méthode | Params | Résultat |
|---|---|---|
| `plan.set` | `{ workspace_id?, agent_id?, steps: PlanStep[] }` | le `Plan` stocké |
| `plan.update` | `{ workspace_id?, agent_id?, id: string, title?, state? }` | le `Plan` mis à jour, ou `null` si plan/étape inconnus |
| `plan.complete` | `{ workspace_id?, agent_id? }` | le `Plan` avec toutes les étapes `done` |
| `plan.clear` | `{ workspace_id?, agent_id? }` | `{ cleared: boolean }` |
| `plan.list` | `{}` | `{ plans: Plan[] }` |

**`PlanStep`**

```ts
{ id: string; title: string; state: "waiting" | "active" | "done" | "err";
  description?: string }
```

`description` est un contexte optionnel plus long, rendu en infobulle sur la
ligne d'étape (utilisé par le miroir de tâches Claude Code pour transporter
`task_description`).

**Résolution de l'espace** — `workspace_id` (ou `workspace`) prime ; sinon
l'espace propriétaire de `surface_id`. Dans un panneau τ-mux, `HT_SURFACE` est
exporté : le CLI le résout donc gratuitement. Un appel qui ne peut pas
résoudre d'espace échoue.

`plan.set` normalise l'entrée : un `state` inconnu devient `waiting`, les ids
d'étapes en double fusionnent (le dernier gagne) et les titres sont trimés.

Voir [`ht plan`](/fr/cli/plan/).
