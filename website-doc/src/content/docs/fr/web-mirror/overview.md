---
title: Vue d'ensemble
description: Ce qu'est le miroir web, à qui il s'adresse et comment il fonctionne.
sidebar:
  order: 1
---

Le miroir web est un endpoint HTTP + WebSocket servi par Bun qui diffuse l'intégralité de l'UI τ-mux vers tout ce qui se trouve sur le LAN. Texte du terminal, panneaux sideband, puces de métadonnées et notifications transitent tous par un unique WebSocket.

Ceci est une vue d'ensemble fonctionnelle — voir [Fonctionnalité miroir web](/fr/features/web-mirror/) pour le résumé orienté utilisateur, et [Protocole v2](/fr/web-mirror/protocol-v2/) pour les détails du format de fil.

## Ce qu'il fait

- Rend la même vue xterm.js que l'application native.
- Reflète les espaces de travail, la barre latérale, les panneaux sideband, les notifications.
- Fait l'aller-retour pour stdin (frappe dans le navigateur → PTY).
- Expose des puces de port qui ouvrent `http://<host>:<port>` depuis la machine du **visualiseur**.
- Reprend de manière transparente après les déconnexions via un tampon circulaire de 2 Mo par session.

## À qui il s'adresse

- Téléphone / iPad comme moniteur d'un coup d'œil lorsque vous êtes loin du bureau.
- Programmation en binôme sur un LAN sans partage d'écran.
- Terminaux à écran tactile.
- Accès distant léger sans SSH (lorsque le LAN est de confiance).

## Comment l'activer

Dans l'application τ-mux :

- **Réglages → Réseau → Démarrage automatique du miroir web** pour l'activer au lancement.
- **Réglages → Réseau → Jeton** pour exiger une authentification (recommandé pour tout bind non-loopback).
- Notez l'URL — `http://<your-laptop-ip>:3000` par défaut.

Ou par variable d'environnement (force le démarrage automatique indépendamment du réglage) :

```bash
HYPERTERM_WEB_PORT=3000 bun start
```

## Notes de performance

- Stdout coalescé à une granularité de 16 ms.
- Changements de métadonnées dédupliqués côté serveur — seuls les deltas passent sur le fil.
- La reprise utilise `@xterm/headless` + `SerializeAddon` pour un instantané de rattrapage en une seule trame.

## Fichiers source

- `src/bun/web/server.ts` — `Bun.serve`, enveloppes, reprise, authentification.
- `src/bun/web/connection.ts` — tampon circulaire par session + suivi de seq.
- `src/bun/web/state-store.ts` — cache côté serveur.
- `src/web-client/` — bundle client.

## Pour aller plus loin

- [Authentification et durcissement](/fr/web-mirror/auth-and-hardening/)
- [Protocole v2](/fr/web-mirror/protocol-v2/)
- [Page fonctionnalité miroir web](/fr/features/web-mirror/)
