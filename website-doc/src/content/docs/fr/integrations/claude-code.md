---
title: Claude Code
description: Intégration en deux pièces — hooks shell d'exécution qui pilotent les pastilles de la barre latérale, plus une skill `tau-mux` qui apprend à Claude Code à utiliser les surfaces interactives de τ-mux.
sidebar:
  order: 1
---

L'intégration Claude Code livre **deux pièces** car Claude Code ne peut pas charger d'extension JS comme le fait pi. Les responsabilités de l'extension pi sont réparties entre :

- **`claude-integration/ht-bridge/`** — hooks shell d'exécution. Passif. Pilote la pastille label-actif, le téléscripteur coût / contexte, et la couleur de la pastille idle / permission depuis les hooks shell de Claude Code. Aucune intervention du LLM.
- **`claude-integration/skills/tau-mux/`** — skill Claude Code. Active. Apprend à Claude Code à préférer les surfaces interactives `ht` de τ-mux (`ht ask`, `ht plan`, `ht notify`, `ht new-split`, `ht browser`, `ht screenshot`, `ht set-status`) plutôt que la sortie terminale brute.

Côté pi, les deux sont fusionnées dans une seule extension JS (`pi-extensions/ht-bridge/`) ; côté Claude Code, les deux moitiés s'installent dans des emplacements différents sous `~/.claude/`.

## Installation

```bash
cd claude-integration
./install.sh         # symlinks ht-bridge → ~/.claude/scripts/ht-bridge
                     # ET skills/tau-mux → ~/.claude/skills/tau-mux
```

Drapeaux :

- `SKIP_HOOKS=1 ./install.sh` — installer uniquement la skill.
- `SKIP_SKILL=1 ./install.sh` — installer uniquement le pont de hooks d'exécution.
- `FORCE=1` — remplacer les cibles existantes sans demander.
- `COPY=1` — copier au lieu de symlinker (checkouts en lecture seule).

Ajoutez ensuite les blocs de hooks de `claude-integration/settings.snippet.jsonc` dans votre `~/.claude/settings.json` (le snippet montre les hooks d'événement exacts pour `UserPromptSubmit` / `Stop` / `Notification`). La skill se charge automatiquement — pas d'édition de settings.json nécessaire.

## Pont de hooks d'exécution — ce qui s'affiche

| Événement Claude | Ce que fait ht-bridge |
|---|---|
| `UserPromptSubmit` | Pose la pastille label actif `Claude : <task>`. Démarre le minuteur de session. |
| `Stop` | Efface le label, parse le JSONL de transcript pour les tokens / coût, déclenche `ht notify` avec prompt + durée + coût, rafraîchit le téléscripteur persistant `cc · turn N · …`. |
| `Notification` matcher `idle_prompt` | Pose la pastille label sur `Waiting for input` (orange). |
| `Notification` matcher `permission_prompt` | Pose la pastille label sur `Approval needed` (rouge) et déclenche une notification. |

Si τ-mux ne tourne pas ou que `ht` n'est pas dans le PATH, les hooks ne font rien gracieusement — Claude Code continue sans être affecté.

## Skill tau-mux — ce qu'elle enseigne

Quand une session Claude Code correspond à la description de la skill (plans multi-étapes, questions à l'utilisateur, processus longs, vérification navigateur, captures d'écran, signal de complétion, bash risqué), Claude Code charge `~/.claude/skills/tau-mux/SKILL.md`. La skill instruit le modèle à :

- **Workflow de planification.** Écrire le plan détaillé dans `.claude/plans/<name>.md` d'abord, gater la publication via `ht ask choice` (accepter / refuser / discuter), puis `ht plan set` uniquement sur acceptation. Mettre à jour les étapes avec `ht plan update <id> --state …` à mesure que le travail avance.
- **Questions structurées.** Utiliser `ht ask {yesno|choice|text|confirm-command}` pour les décisions que l'utilisateur possède — points de bifurcation, choix de framework, messages de commit, flux de connexion. Une modale apparaît dans τ-mux (avec transfert Telegram optionnel).
- **Notifications de jalon.** `ht notify --title … --body …`, avec parcimonie — une ou deux fois par tâche. Ne pas doublonner avec la notification du hook `Stop`.
- **Processus longs.** Utiliser `ht new-split` + `ht send --surface … "cmd\n"` pour les serveurs de dev, watchers et tail de logs — pas l'outil `bash` inline. L'utilisateur peut regarder en direct ; l'agent reste débloqué.
- **Vérification navigateur.** `ht browser open-split <url>`, puis piloter avec `ht browser browser:N {navigate|click|fill|wait|get|is|eval|console|errors|snapshot}`.
- **Captures d'écran.** `ht screenshot --out /tmp/…png` puis `Read` du fichier pour que l'agent voie ce que voit l'utilisateur.
- **Progression dans la barre latérale.** `ht set-status <key> "<value>" --icon … --color …` et `ht set-progress 0.42 --label "…"`. Choisir une clé qui n'est pas `Claude` ou `cc` (celles-ci appartiennent au hook d'exécution).
- **Sécurité bash.** Gater les commandes destructives (`rm -rf`, `git push --force`, `sudo`, `mkfs`, `dd`, `chown`/`chmod` en bulk) via `ht ask confirm-command --command "…" --reason "…"` avant exécution.

La skill est autonome — pas de fichier de config, pas de variables d'env. Éditez `claude-integration/skills/tau-mux/SKILL.md` pour réajuster le comportement ; les changements sont pris en compte en direct (Claude Code relit la skill à chaque session).

## Comment elle reflète pi-extensions

| Capacité de `pi-extensions/ht-bridge`                     | Analogue Claude Code                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `before_agent_start` → pastille « Thinking… »             | Hook `UserPromptSubmit` → pastille label actif (pont de hooks d'exécution)            |
| `agent_end` → résumé `ht notify`                          | Hook `Stop` → `ht notify` avec prompt + durée + coût (pont de hooks d'exécution)      |
| `turn_end` → téléscripteur `ctx · %`                      | Hook `Stop` → téléscripteur `cc · turn N · cost` (pont de hooks d'exécution)          |
| Outil LLM `ht_ask_user`                                   | Skill `tau-mux` — instruit le modèle à appeler `ht ask {yesno\|choice\|text\|confirm-command}` |
| Outils LLM `ht_plan_*` (review-first `.pi/plans/*.md`)    | Skill `tau-mux` — `.claude/plans/<name>.md` → gate `ht ask choice` accept → `ht plan set` |
| Outil LLM `ht_notify`                                     | Skill `tau-mux` — `ht notify` aux jalons, avec parcimonie                             |
| Outils LLM `ht_browser_*`                                 | Skill `tau-mux` — `ht browser open-split` + `ht browser browser:N …`                  |
| Outil LLM `ht_screenshot`                                 | Skill `tau-mux` — `ht screenshot --out`                                               |
| Outil LLM `ht_run_in_split`                               | Skill `tau-mux` — `ht new-split` + `ht send`                                          |
| Garde bash-safety (`before_tool_call`)                    | Skill `tau-mux` — `ht ask confirm-command` avant bash destructif                      |
| Primer system-prompt à chaque tour                        | Skill `tau-mux` — Claude Code charge le corps de la skill quand sa `description` matche |

## Transfert vers Telegram

Lorsque **Settings → Telegram → Forward notifications** est activé dans τ-mux, chaque appel `ht notify` (qu'il vienne du hook d'exécution sur `Stop` ou de la skill sur un jalon) est aussi transféré vers votre chat configuré. Pratique pour les pings « Claude a fini pendant que j'étais absent », et pour les modales `ht ask` qui apparaissent comme boutons inline-keyboard dans le chat.

## Personnalisation

- **Pont de hooks d'exécution.** Éditez `claude-integration/ht-bridge/src/index.ts`. Surcharges par utilisateur via `claude-integration/ht-bridge/config.json` (couleurs, clés, tables de prix, téléscripteur on/off, notification idle on/off). Surcharges d'env sous `HT_CLAUDE_*`. Bun relit le fichier à chaque invocation de hook ; pas d'étape de rebuild.
- **Skill tau-mux.** Éditez `claude-integration/skills/tau-mux/SKILL.md`. Le champ frontmatter `description` contrôle quand la skill se charge — ajustez-le pour élargir ou restreindre la surface de déclenchement.

## Source

- `claude-integration/ht-bridge/src/index.ts` — le runner de hooks (TypeScript, exécuté via Bun).
- `claude-integration/ht-bridge/config.json` — surcharges d'exécution par utilisateur.
- `claude-integration/skills/tau-mux/SKILL.md` — le corps de la skill.
- `claude-integration/skills/tau-mux/README.md` — notes d'install et de portée de la skill.
- `claude-integration/install.sh` — symlinke les deux pièces dans `~/.claude/`.
- `claude-integration/settings.snippet.jsonc` — configuration de hook clé en main.

## Pour aller plus loin

- [Extensions pi](/fr/integrations/pi/)
- [Canaux de notification](/fr/integrations/notification-channels/)
- [Pont Telegram](/fr/features/telegram-bridge/)
