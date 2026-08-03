---
title: autocontinue.*
description: status, set, fire, pause, resume, audit — le moteur d'auto-continue.
---

Le moteur d'[auto-continue](/fr/features/auto-continue/) décide s'il faut
relancer un agent en pause. Chaque décision est enregistrée dans un anneau
d'audit.

| Méthode | Params | Résultat |
|---|---|---|
| `autocontinue.status` | `{}` | réglages + état du moteur |
| `autocontinue.set` | `{ engine?, dryRun?, cooldownMs?, maxConsecutive?, modelName?, modelApiKeyEnv? }` | `{ autoContinue: AutoContinueSettings }` |
| `autocontinue.fire` | `{ surface_id?, notification_text? }` | `{ outcome }` — une décision immédiate |
| `autocontinue.pause` | `{ reason? }` | état en pause |
| `autocontinue.resume` | `{}` | état repris |
| `autocontinue.audit` | `{ limit? }` | `{ audit: AutoContinueAuditEntry[] }` (limite 1–50, défaut 20) |

**Défauts sûrs.** `engine` vaut `"off"` et `dryRun` vaut `true` à
l'installation : rien n'est jamais tapé dans un panneau tant que vous ne
l'activez pas délibérément. Chaque champ est validé par son propre schéma ;
les valeurs inconnues ou mal typées sont ignorées.

Voir [`ht autocontinue`](/fr/cli/autocontinue/) et la
[référence des réglages](/fr/configuration/settings/).
