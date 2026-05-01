---
title: Auto-continue
description: ht autocontinue — pilotez le moteur d'auto-continue. Inspectez le statut, consultez le journal d'audit, configurez le mode du moteur, déclenchez / mettez en pause / reprenez par surface.
sidebar:
  order: 12
---

`ht autocontinue` contrôle le [moteur d'auto-continue](/fr/features/auto-continue/) — la pièce qui décide s'il faut envoyer automatiquement `Continue` à un agent à chaque notification de fin de tour. Le CLI expose tout ce que le panneau Settings expose, plus des contrôles par surface (déclenchement manuel, pause, reprise) que l'UI n'a pas.

## autocontinue status

```bash
ht autocontinue status
# engine          heuristic
# dryRun          false
# cooldownMs      3000
# maxConsecutive  5
# model           anthropic/claude-haiku-4-5-20251001
# apiKeyEnv       ANTHROPIC_API_KEY
# paused          (none)

ht autocontinue status --json
```

Prend un instantané de la configuration du moteur et de la liste actuelle des surfaces en pause. Peu coûteux ; pas d'I/O.

## autocontinue audit

```bash
ht autocontinue audit
# 14:02:11  fired      surface:1  next plan step: M3
# 14:02:18  skipped    surface:1  cooldown — 1842ms remaining
# 14:02:33  paused     surface:1  manual pause via ht/UI
# 14:02:55  resumed    surface:1  manual resume via ht/UI

ht autocontinue audit --limit 5
ht autocontinue audit --json
```

Affiche les décisions récentes provenant du tampon circulaire d'audit en mémoire (plafond 50). Par défaut 20 entrées ; `--limit N` (1–50) le resserre. Chaque ligne est `<time> <outcome> <surface> <reason>`. Le suffixe `(model)` marque les décisions où le LLM a été consulté.

| Outcome | Signification |
|---|---|
| `fired` | Le moteur a envoyé `Continue` (ou l'instruction du modèle) dans la surface. |
| `dry-run` | Le moteur *aurait* déclenché mais `dryRun` est activé — instruction journalisée, aucun texte envoyé. |
| `skipped` | L'heuristique / le cooldown / le garde-fou anti-emballement ont demandé d'attendre. La raison indique laquelle. |
| `paused` | Événement administratif provenant de `pause` (CLI ou UI). |
| `resumed` | Événement administratif provenant de `resume`. |

## autocontinue set

```bash
ht autocontinue set --engine heuristic
ht autocontinue set --engine hybrid --dry-run false --cooldown 5000
ht autocontinue set --max 10 --model claude-sonnet-4-6
ht autocontinue set --api-key-env MY_CLAUDE_KEY
```

Persiste une mise à jour partielle des paramètres. Au moins une option est requise :

| Option | Paramètre | Validation |
|---|---|---|
| `--engine <X>` | `engine` | `off` · `heuristic` · `model` · `hybrid` |
| `--dry-run <bool>` | `dryRun` | `true` / `false` / `1` / `0` / `yes` / `no` |
| `--cooldown <ms>` | `cooldownMs` | borné à 0–60000 |
| `--max <n>` | `maxConsecutive` | borné à 1–50 |
| `--model <name>` | `modelName` | toute chaîne non vide |
| `--api-key-env <var>` | `modelApiKeyEnv` | toute chaîne non vide |

Renvoie un écho d'une ligne du nouvel état :

```
ok — engine=hybrid dryRun=false cooldown=5000ms max=5
```

L'UI Settings se réaffiche à la prochaine ouverture ; le moteur relit sa config à chaque dispatch, donc les changements prennent effet immédiatement pour la prochaine fin de tour.

## autocontinue fire

```bash
ht autocontinue fire surface:1
# fired  next plan step: M3

ht autocontinue fire surface:2
# skipped  no plan published
```

Force un dispatch sur `<surface>` en utilisant le même pipeline de recherche utilisé pour les notifications de fin de tour (plan le plus récemment mis à jour dans l'espace de travail propriétaire, 12 dernières lignes du tail de la surface). Utile lorsque :

- Vous testez une décision heuristique / modèle sans attendre qu'un agent déclenche une vraie notification.
- Vous pilotez le moteur depuis un script qui sait que l'agent a terminé mais n'a pas émis de `ht notify`.

La sortie `<kind> <reason>` correspond à la forme du tampon circulaire d'audit pour que vous puissiez lire la décision en une ligne. Notez que `fire` respecte toujours chaque garde-fou : cooldown, anti-emballement, en pause, dry-run, engine=off s'appliquent tous.

## autocontinue pause

```bash
ht autocontinue pause surface:1
# ok — paused: surface:1
```

Arrête l'auto-continue pour une surface spécifique. Les dispatchs ultérieurs renvoient `paused` jusqu'à ce que vous fassiez `resume` (ou jusqu'à ce que l'utilisateur tape dans ce terminal — `notifyHumanInput` provenant d'une vraie frappe **n'efface pas** une pause manuelle). Utile pour :

- Épingler un agent qui est sur le point de faire quelque chose de destructeur.
- Mettre en pause une surface tout en laissant le reste de l'espace de travail réactif.

La pause est par surface ; le réglage du moteur (`engine: heuristic`) reste activé pour tout le reste.

## autocontinue resume

```bash
ht autocontinue resume surface:1
# ok — no surfaces paused
```

Efface la pause sur `<surface>`. Effet de bord : réinitialise aussi le compteur d'emballement pour cette surface, donc une surface qui était en pause après avoir atteint `maxConsecutive` peut redéclencher immédiatement.

## Recettes

### Activer en dry-run, puis passer en live

```bash
ht autocontinue set --engine heuristic --dry-run true
# … exercise some agent turns, watch `ht autocontinue audit` …
ht autocontinue set --dry-run false
```

### Mettre tout en pause durant un build long

```bash
for s in $(ht list-surfaces --json | jq -r '.[].id'); do
  ht autocontinue pause "$s"
done

# … long build …

for s in $(ht list-surfaces --json | jq -r '.[].id'); do
  ht autocontinue resume "$s"
done
```

### Observer le moteur réagir à un déclenchement forcé

```bash
ht autocontinue set --engine heuristic --dry-run true
ht autocontinue fire surface:1
ht autocontinue audit --limit 1
```

## Pour aller plus loin

- [Vue d'ensemble de la fonctionnalité auto-continue](/fr/features/auto-continue/) — modes du moteur, dry-run, fournisseur LLM, paramètres.
- [`ht plan`](/fr/cli/plan/) — publication du plan que le moteur lit.
- [Vue d'ensemble du panneau Plan](/fr/features/plan-panel/) — le widget de la barre latérale qui surface les plans + le tampon circulaire d'audit.
