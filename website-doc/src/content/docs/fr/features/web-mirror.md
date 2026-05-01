---
title: Miroir web
description: L'UI native complète diffusée via WebSocket. Auth par jeton, contrôles d'origine, reprise à la reconnexion.
sidebar:
  order: 6
---

Le miroir web est un serveur Bun HTTP + WebSocket optionnel qui diffuse la totalité de l'UI τ-mux vers tout appareil sur le LAN. Sortie du terminal, panneaux sideband, puces de métadonnées et notifications transitent toutes par un seul WebSocket.

## Démarrage rapide

1. **Settings → Network → Auto-start Web Mirror**.
2. Notez l'URL — par défaut `http://<your-laptop-ip>:3000`.
3. Ouvrez-la depuis n'importe quel appareil sur le LAN (téléphone, iPad, autre laptop).

Ou démarrez-la à chaque lancement en définissant `HYPERTERM_WEB_PORT` dans l'environnement de votre shell — voir [Variables d'environnement](/fr/configuration/env-vars/).

## Ce qui est mirroré

| Surface | Comportement dans le miroir |
|---|---|
| Texte du terminal | Rendu xterm.js complet avec le même thème. Le stdin (la frappe) fait l'aller-retour. |
| Puces de panneau | cwd / commande de premier plan / puces de port en direct. Cliquez sur une puce de port pour l'ouvrir sur l'appareil miroir. |
| Barre latérale | Espaces de travail, pastilles de statut, entrées de log. |
| Panneaux sideband | Les quatre types de contenu sont rendus. Glisser/redimensionner reroute vers l'hôte. |
| Notifications | Mirroirées. |
| Process Manager | En lecture seule dans le miroir (pas de bouton kill — pour l'instant). |

## Auth et durcissement

Le miroir est conçu pour des réseaux de confiance mais la surface est délibérément réduite :

- **Auth par jeton.** Définissez `webMirrorAuthToken` pour exiger `?t=<token>` (ou `Authorization: Bearer <token>`) sur chaque requête. La comparaison est à **temps constant** via `timingSafeEqualStr` afin que le jeton ne puisse pas être brute-forcé un octet à la fois par sondage de latence.
- **Application de l'origine.** Les upgrades WebSocket sont rejetés quand l'en-tête `Origin` est défini et ne correspond pas à `Host`. Les navigateurs sur un autre site ne peuvent pas détourner la connexion. Les clients natifs qui omettent `Origin` (par ex. `curl`, `ht`) se connectent quand même.
- **Cap de taille par frame.** 256 Kio par enveloppe, 64 Kio par charge utile `stdin`.
- **Limite de débit par connexion.** 256 frames/sec via un token bucket — les frames trop grosses ou trop rapides sont silencieusement abandonnées.
- **Borne du resize.** `surfaceResizeRequest` borne cols à `[10, 500]` et rows à `[4, 500]`. Les valeurs non parseables sont rejetées plutôt que transmises.
- **IDs de session aléatoires.** 128 bits hex depuis `crypto.getRandomValues` — pas de structure prédictible pour deviner un id de reprise.

## Reprise à la reconnexion

Chaque session a un tampon circulaire de 2 Mo de stdout. À la reconnexion (avec `?resume=<id>&seq=<n>`), le serveur rejoue tout depuis `seq` afin que xterm rende exactement le bon état. Si l'id de reprise est inconnu, le serveur retombe sur une enveloppe `hello` fraîche.

Le rejeu correct de l'état du terminal utilise `@xterm/headless` + `SerializeAddon` côté serveur, afin que les clients qui se reconnectent rattrapent via un seul instantané sérialisé plutôt que par streaming d'heures d'octets historiques.

## Performance

- Le stdout est coalescé à une granularité de 16 ms (une frame par repaint navigateur).
- Les changements de métadonnées sont dédupliqués — le serveur n'envoie que ce qui a changé.
- Le format de fil est **les enveloppes du protocole v2** — voir [Protocole v2 du miroir web](/fr/web-mirror/protocol-v2/).

## Paramètres

| Paramètre | Défaut | Effet |
|---|---|---|
| `webMirrorPort` | `3000` | Port d'écoute. Redémarre un miroir en cours d'exécution lors du changement. |
| `webMirrorBind` | `0.0.0.0` | Adresse de bind. Mettez `127.0.0.1` pour le garder local. |
| `webMirrorAuthToken` | `""` (off) | Si défini, chaque requête doit présenter le jeton. |
| `autoStartWebMirror` | `false` | Si le miroir démarre au lancement de l'app. |

La variable d'environnement `HYPERTERM_WEB_PORT` remplace `webMirrorPort` et force l'auto-démarrage indépendamment du paramètre.

## Fichiers source

- `src/bun/web/server.ts` — `Bun.serve`, protocole d'enveloppe, reprise, auth.
- `src/bun/web/connection.ts` — tampon circulaire par session, suivi de seq, backpressure.
- `src/bun/web/state-store.ts` — cache côté serveur des métadonnées / panneaux / barre latérale.
- `src/web-client/` — le bundle client (transport, store, vues).

## Pour aller plus loin

- [Auth et durcissement](/fr/web-mirror/auth-and-hardening/)
- [Protocole v2](/fr/web-mirror/protocol-v2/)
- [Settings: Network](/fr/configuration/settings/)
