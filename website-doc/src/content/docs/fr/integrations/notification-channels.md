---
title: Canaux de notification
description: Comment `ht notify`, les entrées de journal de la barre latérale et le transfert Telegram s'empilent les uns sur les autres.
sidebar:
  order: 3
---

τ-mux possède trois surfaces de notification et un saut de transfert. Voici comment elles se relient.

## Les trois surfaces

1. **Notifications système** — `ht notify --title … --body …` déclenche une bannière de notification native macOS. L'utilisateur la voit même si τ-mux n'a pas le focus.
2. **Pile de la barre latérale** — chaque notification est aussi journalisée dans la barre latérale pour que vous puissiez voir l'historique sans quitter l'application.
3. **Entrées de journal de la barre latérale** — `ht log "…"` publie une entrée dans le journal de l'espace de travail. Même surface que les notifications mais plus légère — pas de bannière native, pas de transfert Telegram.

## Le saut Telegram

Lorsque **Settings → Telegram → Forward notifications** est activé, chaque appel `notification.create` (y compris `ht notify`) est aussi transféré vers le chat Telegram configuré.

```
ht notify ──┬─→ macOS notification banner
            ├─→ τ-mux sidebar pile
            └─→ Telegram chat (if forwarding on)
```

`ht log` ne déclenche PAS de transfert Telegram — c'est intentionnellement local uniquement.

## Quand utiliser quoi

| Scénario | Utiliser |
|---|---|
| « Les tests sont cassés, lâchez tout » | `ht notify --level error --title "Tests" --body "5 failed"` — bannière + transfert Telegram. |
| « Mise à jour de progression du build » | `ht set-progress 0.5 --label "Compiling"` + `ht set-status build "Compiling"` — silencieux, barre latérale uniquement. |
| « Entrée rapide de journal » | `ht log --level success --source build "compiled"` — pas de bannière, pas de Telegram, juste la barre latérale. |
| « Gros boulot terminé pendant que j'étais absent » | `ht notify --title "Done" --body "deploy succeeded" --sound finish` — bannière + son + Telegram. |

## Suppression durant le focus

Il n'y a pas encore de bascule « ne pas déranger » intégrée. Solutions de contournement :

- Utiliser `ht notify --silent` (planifié) pour sauter la bannière mais conserver l'entrée de la barre latérale.
- Utiliser `ht log` au lieu de `ht notify` pour les mises à jour non critiques.
- Désactiver le transfert Telegram dans les paramètres pendant un appairage ou un partage d'écran.

## Pour aller plus loin

- [`ht notify`](/fr/cli/notifications/)
- [`ht log` / `ht set-status` / `ht set-progress`](/fr/cli/sidebar-and-status/)
- [Pont Telegram](/fr/features/telegram-bridge/)
