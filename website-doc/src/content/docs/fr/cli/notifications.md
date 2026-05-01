---
title: Notifications
description: notify, list-notifications, clear-notifications.
sidebar:
  order: 6
---

Notifications natives. Optionnellement transférées vers Telegram (voir [Pont Telegram](/fr/features/telegram-bridge/)).

## notify

```bash
ht notify --title "Build" --body "Done"
ht notify --title "Tests failed" --body "5 failures in src/" --level error
ht notify --title "Done" --body "Tests passed" --sound finish
```

Publie une notification système. La notification apparaît également dans le journal de la barre latérale de τ-mux.

| Option | Rôle |
|---|---|
| `--title <s>` | Titre de la notification (requis). |
| `--body <s>` | Texte du corps. |
| `--level <s>` | `info` (par défaut), `success`, `warn`, `error`. |
| `--sound <s>` | `finish` joue le `audio/finish.mp3` fourni. Ajoutez des fichiers personnalisés via le chargeur d'assets. |
| `--surface <id>` | Remplace la surface qui possède la notification (par défaut celle qui a le focus). |

## list-notifications

```bash
ht list-notifications
ht list-notifications --json
```

Liste les notifications actives (celles qui sont encore dans la pile de la barre latérale). Inclut le titre, le corps, le niveau, l'âge, l'id de la surface.

## clear-notifications

```bash
ht clear-notifications
ht clear-notifications --surface surface:3
```

Efface toutes les notifications (ou celles de la surface ciblée). La bannière native se ferme automatiquement ; ceci n'affecte que la pile de la barre latérale.

## Avec le transfert Telegram

Lorsque **Settings → Telegram → Forward notifications** est activé, chaque appel `ht notify` est aussi envoyé au chat Telegram configuré. Utile pour les pings « build done » lorsque vous êtes loin du bureau.

## Pour aller plus loin

- [Méthodes JSON-RPC notification](/fr/api/notification/)
- [Pont Telegram](/fr/features/telegram-bridge/)
- [`ht log`](/fr/cli/sidebar-and-status/)
