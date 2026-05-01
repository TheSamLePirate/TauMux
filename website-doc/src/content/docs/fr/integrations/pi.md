---
title: Extensions pi
description: ht-notify-summary — fait apparaître les tours de l'agent de codage pi dans la barre latérale τ-mux.
sidebar:
  order: 2
---

`pi-extensions/ht-notify-summary/` est une extension pi (un agent de codage IA) qui reflète le cycle de vie des tours de pi dans la barre latérale τ-mux — même idée que l'[intégration Claude Code](/fr/integrations/claude-code/).

## Ce qu'elle fait

- Publie une pastille de statut dans la barre latérale pendant que pi travaille.
- Met à jour la pastille avec chaque résumé d'appel d'outil.
- Publie une notification de complétion avec `ht notify` lorsque le tour se termine.

## Installation

L'extension est un unique `index.ts` plus un `config.json`. Déposez le dossier dans le répertoire d'extensions de pi, redémarrez pi, et elle se chargera automatiquement.

```
pi-extensions/
└── ht-notify-summary/
    ├── config.json    # extension metadata + hooks
    ├── index.ts       # the extension code
    └── README.md
```

## Comportement

L'extension utilise le CLI `ht` de τ-mux sous le capot — de la même manière que l'intégration Claude. Si τ-mux ne tourne pas, le runtime de pi avale le code de sortie non-zéro et continue ; rien ne casse.

## Personnalisation

Éditez `index.ts` pour changer :

- La clé de la pastille (`ht set-status pi …`).
- Le format du résumé.
- Si une notification de complétion doit être publiée ou non.

## Pour aller plus loin

- [Intégration Claude Code](/fr/integrations/claude-code/)
- [Canaux de notification](/fr/integrations/notification-channels/)
