---
title: Journal des modifications
description: Changements notables — les plus récents en haut.
sidebar:
  order: 1
---

Cette page résume les changements visibles par les utilisateurs. Le journal complet des commits est sur [GitHub](https://github.com/TheSamLePirate/TauMux/commits/main).

## Non publié

- Lancement du site de documentation (ce site).
- Ask-user (Plan #10) : protocole structuré agent → humain pour poser des questions, avec `ht ask {yesno|choice|text|confirm-command}`. Réponses via une fenêtre modale dans la webview de l'app, via la CLI sœur (`ht ask answer`) ou via les boutons inline / force-reply de Telegram. File FIFO par surface, puce d'attente dans la barre latérale, piste d'audit éditée en place dans Telegram.

## 0.2.x

- Pont Telegram : panneau de chat, service bot en long-poll, journal SQLite, CLI `ht telegram`, transfert optionnel des notifications.
- Sharebin : déposer-et-partager des fichiers servis par le miroir web.
- Améliorations du panneau navigateur : plus de 40 commandes `ht browser`, barre d'adresse avec détection d'URL intelligente, mode sombre forcé, interception des liens du terminal.
- Gestionnaire de processus : repli/déploiement par surface, puces de port à l'intérieur des lignes, en-tête récapitulatif.
- Métadonnées de processus en direct : état git (branche, ahead/behind, compteurs « dirty ») ajouté à la charge utile par surface, mis en cache avec TTL.
- Miroir web : enveloppes du protocole v2, reprise à la reconnexion via un buffer circulaire de 2 Mo, rejeu d'instantané `@xterm/headless`, comparaison des jetons en temps constant.
- Carte du `package.json` de l'espace de travail avec lancement de script en un clic et points d'état vert/rouge/gris.

## 0.1.x

- Première préversion publique.
- Espaces de travail, splits en mosaïque, séparateurs glissables.
- xterm.js + PTYs `Bun.spawn`.
- Protocole sideband (fd 3/4/5) avec clients Python + TypeScript.
- Panneaux canvas flottants.
- CLI `ht` pour le contrôle via socket.
- Miroir web v1.
