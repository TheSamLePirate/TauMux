---
title: Pi (ht-bridge)
description: "pi-extensions/ht-bridge — τ = 2π : rendre pi-coding-agent visible, vérifiable et contrôlable via le panneau de plan, la modale ask-user, les outils et la barre latérale de τ-mux."
sidebar:
  order: 2
---

`pi-extensions/ht-bridge/` (renommé depuis `ht-notify-summary/` en 0.2.80) est le pont de première classe entre [pi-coding-agent](https://github.com/TheSamLePirate/pi-coding-agent) et τ-mux.

Cette relation est intentionnelle : **τ = 2π**, donc τ-mux est littéralement et conceptuellement « deux pi » — un multiplexeur de terminal pensé autour d'une paire humain + agent pi. L'extension rend pi visible, vérifiable et contrôlable depuis τ-mux au lieu de cacher la boucle d'agent dans un simple buffer de terminal.

Elle fait trois choses à la fois :

1. **Observe** chaque tour pi — pousse le label de tâche actif, le ticker de coût, le badge d'exécution d'outil, les propositions de plan et le log d'activité par tour dans la barre latérale τ-mux.
2. **Intercepte** les commandes bash dangereuses — fait apparaître une modale τ-mux (qui s'auto-mirrore vers Telegram) avant que `rm -rf`, `sudo`, force-push, etc. ne s'exécutent réellement.
3. **Enregistre des outils** — donne au LLM `ht_ask_user`, `ht_plan_set/_update/_complete`, `ht_browser_open/_navigate/_close`, `ht_notify`, `ht_screenshot` et `ht_run_in_split` (spawn d'un panneau frère pour les commandes longues) pour qu'il pilote τ-mux directement. Un primer dans le system-prompt apprend au modèle quand utiliser chacun, incluant **l'espace de travail + la surface + le cwd actuels** résolus au démarrage via `system.identify`.

Plus deux commandes slash (`/ht-plan`, `/ht-ask`) pour le contrôle humain, le replay des plans acceptés à la reprise de session, et une pastille « Compacting… » pendant que pi compacte une session en résumé.

Même idée que l'[intégration Claude Code](/fr/integrations/claude-code/), mais la surface d'événements plus riche de pi permet à ht-bridge d'intercepter les appels d'outils, d'injecter un primer d'orientation à chaque tour et d'ajouter des outils LLM-appelables — ce que le protocole shell-hook de Claude Code ne permet pas.

## Matrice de capacités

| Capacité | Défaut |
|---|---|
| Pastille label actif (`Pi : <task>` pendant l'exécution, `ht notify` à `agent_end`) | on |
| Ticker coût / fenêtre de contexte (`Pi · 34% · $0.012`) | on |
| Badge d'exécution d'outil (`pi_tool : bash <cmd>`) | on |
| Mirror plan-texte (sniffe les blocs JSON fenced de `{id,title,state}`), écrit `.pi/plans/*.md`, puis demande accepter / refuser / discuter avant publication | on |
| Log d'activité par espace de travail (`tool_call`, erreurs, résumés de tour) | on |
| Scanner K2000 / KITT installé comme indicateur de travail de pi (`░▒█──────` qui balaie d'avant en arrière pendant le stream de pi) | on |
| Pastille τ-mux : verte `● τ-mux ws:2 surface:7` quand connecté, rouge `● τ-mux (offline)` hors de τ-mux. Hors de τ-mux, c'est **la seule chose** que l'extension affiche — observateurs / outils / intercepteurs sont tous court-circuités. | on |
| Garde bash-safety (matche `rm -rf`/sudo/mkfs/force-push/…, bloque sur « non » utilisateur) | `confirmRisky` |
| Outils LLM `ht_ask_user`, `ht_plan_*`, `ht_browser_*`, `ht_notify`, `ht_screenshot` | on |
| Outil LLM `ht_run_in_split` — spawn un panneau frère et y lance une commande longue (serveur de dev, watcher, log tail) que l'utilisateur peut regarder en direct. Même garde bash-safety que l'outil `bash`. | on |
| Primer system-prompt (chaîne un bloc d'orientation τ-mux à chaque tour) | on |
| Commandes slash `/ht-plan` et `/ht-ask` | on |
| Pastille « Compacting… » sur `session_before_compact` / `_compact` | on |
| Replay du plan sur `session_start { reason: "resume" \| "fork" }` | on |

Chaque ligne est gardée par un flag indépendant dans `config.json` — désactiver l'une d'elles est un seul booléen.

## Workflow de planification

La planification est volontairement review-first. Quand le modèle veut démarrer une tâche multi-étapes, `ht_plan_set` doit fournir :

- `planName` — utilisé pour un nom de fichier Markdown stable.
- `detailedPlanMarkdown` — le plan complet lisible par l'humain.
- `steps` — les étapes concises de barre latérale dérivées du plan Markdown.

Avant que quoi que ce soit n'apparaisse dans la barre latérale, ht-bridge écrit le fichier détaillé dans :

```text
.pi/plans/<planName>.md
```

Puis τ-mux affiche une modale avec le chemin sauvegardé et trois choix :

- **Accepter** — publier le plan de barre latérale avec les `steps` concises.
- **Refuser** — garder le fichier Markdown pour référence, mais ne rien publier.
- **Discuter / réviser** — collecter le feedback pour l'agent ; aucun plan de barre latérale n'est publié tant que l'agent ne propose pas une version révisée.

Le mirror plan-texte suit la même règle de sécurité. Si pi émet un plan JSON fenced au lieu d'appeler `ht_plan_set` directement, ht-bridge écrit quand même un fichier Markdown généré et demande avant publication. La restauration sur reprise / fork ne rejoue que les plans réellement acceptés.

## Transport

Les chemins chauds (pastilles barre latérale, lignes de log, mises à jour de plan, notifications) passent par un client JSON-RPC direct sur Unix-socket (~1 ms/appel) au lieu de forker le CLI `ht` (50–100 ms). Les chemins froids et les fallbacks socket-manquant shellent vers `ht` de manière transparente. Les échecs de transport (connexion refusée, EPIPE) déclenchent le fallback ; les sorties au niveau protocole (le serveur a renvoyé `error`, requête timeout, AbortSignal aborté) se propagent telles quelles, donc on ne réessaie pas un « method not found » contre `ht`.

## Layout des modules

```
pi-extensions/ht-bridge/
├── config.json                (flags par défaut pour chaque capacité)
├── index.ts                   (factory ; câble les sous-modules conditionnellement)
├── lib/                       (config, ht-client, summarizer, surface-context)
├── observe/                   (active-label, cost-ticker, tool-badge, plan-mirror, activity-log)
├── intercept/                 (bash-safety + bash-safety-core)
├── tools/                     (ask-user, plan, browser, notify, screenshot, run-in-split)
├── system-prompt/             (primer)
├── commands/                  (plan-cmd, ask-cmd)
└── lifecycle/                 (compaction, resume)
```

## Installation

```bash
# Global (toutes les sessions)
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD/pi-extensions/ht-bridge" ~/.pi/agent/extensions/ht-bridge

# Ou projet-local
mkdir -p .pi/extensions
ln -s "$PWD/pi-extensions/ht-bridge" .pi/extensions/ht-bridge
```

Recharger dans pi : `/reload`. Test rapide sans installation : `pi -e ./pi-extensions/ht-bridge/index.ts`. Si vous aviez déjà installé `ht-notify-summary`, retirez d'abord ce symlink.

## Configuration

Éditez `pi-extensions/ht-bridge/config.json` ou surchargez les champs individuels avec des variables d'environnement. Le préfixe original `PI_HT_NOTIFY_*` est conservé pour la rétrocompatibilité ; tout ce qui est nouveau est sous `PI_HT_BRIDGE_*`. Tableau complet : voir le [README de l'extension](https://github.com/TheSamLePirate/TauMux/tree/main/pi-extensions/ht-bridge).

Surcharges courantes :

```bash
PI_HT_BRIDGE_BASH_SAFETY=confirmAll      # garder chaque appel bash (paranoïaque)
PI_HT_BRIDGE_BASH_SAFETY=off             # désactiver totalement la garde
PI_HT_BRIDGE_TOOLS=0                     # désactiver tous les outils ht_*
PI_HT_BRIDGE_SYSTEM_PROMPT_PRIMER=0      # ne pas modifier le system-prompt de pi
PI_HT_NOTIFY_MODEL=gpt-5-mini            # changer le modèle de résumé rapide
PI_HT_NOTIFY_DEBUG=1                     # logger les échecs de tout module sur stderr
```

## Comment fonctionnent les outils LLM-appelables

Chaque outil est enregistré via `pi.registerTool({ name, description, promptSnippet, promptGuidelines, parameters, execute })`. Le champ `promptGuidelines` est le levier — pi n'apprend à utiliser ces outils que parce que le system-prompt lui dit quand. Chaque guideline nomme l'outil explicitement (`Use ht_ask_user when …` plutôt que `Use this tool when …`) puisque pi les ajoute à plat dans la section Guidelines globale.

Le primer system-prompt ajoute, à chaque `before_agent_start`, un bloc d'orientation τ-mux : surface id, workspace id, cwd du panneau, outils enregistrés, nudges de comportement (`Don't ht_notify on every step — once or twice per task`), et un rappel bash-safety. Les outils désactivés n'apparaissent pas dans le primer, donc un utilisateur qui a coupé `ht_browser_*` ne voit pas de guidance contradictoire.

Pour la planification, le primer dit à pi d'écrire d'abord le Markdown détaillé et de traiter la barre latérale comme une vue de progression compacte, pas comme la source de vérité. Cela garde la surface de review humaine durable (`.pi/plans/*.md`) tout en laissant la barre latérale τ-mux lisible d'un coup d'œil.

## Pour aller plus loin

- [Intégration Claude Code](/fr/integrations/claude-code/) — pattern frère, hooks plus étroits (pas d'interception d'outils, pas d'enregistrement d'outils customs).
- [Canaux de notification](/fr/integrations/notification-channels/)
- [Panneau de plan](/fr/features/plan-panel/) — ce que `ht_plan_set` écrit.
- [Fonctionnalité ask-user](/fr/features/ask-user/) — ce que déclenche `ht_ask_user`.
