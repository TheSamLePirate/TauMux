---
title: Claude Code
description: ht-bridge — hooks shell de Claude Code qui font apparaître des pastilles « actif » et publient des notifications de complétion.
sidebar:
  order: 1
---

`claude-integration/ht-bridge/` est un petit ensemble de hooks shell qui reflètent l'état de session de Claude Code dans τ-mux :

- Une **pastille active** dans la barre latérale pendant que Claude travaille.
- Un **téléscripteur persistant** qui montre ce que Claude est en train de faire.
- Une **notification de complétion** lorsque le tour se termine (transférée optionnellement vers Telegram).

## Installation

```bash
cd claude-integration
./install.sh         # symlinks ht-bridge into ~/.claude/scripts/
```

Ajoutez ensuite les blocs de hooks de `claude-integration/settings.snippet.jsonc` dans votre `~/.claude/settings.json` (le snippet montre les hooks d'événement exacts pour `UserPromptSubmit` / `Stop` / `Notification`).

## Ce qui s'affiche

| Événement Claude | Ce que fait ht-bridge |
|---|---|
| `UserPromptSubmit` | `ht set-status claude "working"` avec la couleur d'accentuation. Démarre le téléscripteur. |
| `Notification` (par ex. utilisation d'outil) | `ht set-status claude "<short summary>"` — met à jour la pastille sur place. |
| `Stop` | `ht clear-status claude` + `ht notify --title "Claude" --body "Done"`. |

Si τ-mux ne tourne pas ou que `ht` n'est pas dans le PATH, les hooks ne font rien gracieusement — Claude Code continue sans être affecté.

## Transfert vers Telegram

Lorsque **Settings → Telegram → Forward notifications** est activé dans τ-mux, la notification de complétion est aussi envoyée vers votre chat configuré. Pratique pour les pings « Claude a fini pendant que j'étais absent ».

## Personnalisation

Les scripts de hook sont du shell court — éditez `claude-integration/ht-bridge/*.sh` pour :

- Changer la couleur / l'icône de la pastille.
- Ajouter un son à la complétion (`ht notify --sound finish`).
- Supprimer les notifications pour les tours rapides (par ex. déclencher uniquement si le tour > 10 s).

## Source

- `claude-integration/ht-bridge/` — les scripts de hook.
- `claude-integration/install.sh` — installateur de symlink.
- `claude-integration/settings.snippet.jsonc` — configuration de hook clé en main.

## Pour aller plus loin

- [Extensions pi](/fr/integrations/pi/)
- [Canaux de notification](/fr/integrations/notification-channels/)
- [Pont Telegram](/fr/features/telegram-bridge/)
