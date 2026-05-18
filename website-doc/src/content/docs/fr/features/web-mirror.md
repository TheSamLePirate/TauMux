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

Le plan M11–M17 (0.2.85 → 0.3.0) a amené le miroir web à **parité fonctionnelle avec la sidebar native**. La série M18 (0.3.1–0.3.3) a poursuivi la queue de dimensionnement multi-pane jusqu'à zéro dérive.

| Surface | Comportement dans le miroir |
|---|---|
| Texte du terminal | Rendu xterm.js complet avec le même thème. Le stdin (la frappe) fait l'aller-retour. `fit()` par pane fait correspondre chaque xterm à son propre conteneur — les layouts multi-pane se dimensionnent correctement (M18). |
| Chips de pane | Même DOM que le natif (`.surface-bar`, `.surface-chip*`) — `renderSurfaceChips` partagé (M16). Chips cwd / commande fg / git / port, avec ouverture-au-clic sur l'appareil miroir. |
| Diffusion thème + settings | Les nouvelles envelopes `settingsSnapshot` et `htKeysSeen` (M11) poussent preset de thème, palette ANSI, police, densité, `paneGap`, ordre des clés de barre de statut, flags d'overlay de notifications. Les changements de thème s'appliquent sans rechargement. Les champs sensibles (token d'auth, token bot telegram, ids autorisés) sont dropés côté serveur. |
| Barre de statut inférieure | Même barre data-driven de 26 px que le natif (M12) — trois zones (identité / jauges / focus). |
| Cartes workspace sidebar | Cartes riches qui matchent le natif : bande colorée, point + nom + badge de compte de panes, chips commande + ports d'écoute (+N de débordement après 3), sparkline CPU + RAM, ligne de chips de CWD épinglés, liste de panes pliable, progression OSC 9;4 (M13). Épinglage de CWD par workspace via l'envelope `selectWorkspaceCwd`. |
| Cartes manifest | Cartes `package.json` et `Cargo.toml` (M14) — même `renderManifestCard` partagé. Cargo dérive automatiquement `build`/`run`/`test`/`check`/`clippy`/`fmt`. Les clics de script-run déclenchent une Web Notification en v1 ; le vrai spawn de surface est reporté à v1.1. |
| Notifications flottantes | Pile de cartes par surface ancrée en haut-droite dans chaque conteneur de pane (M15) — même DOM + auto-dismiss + pause au survol + pastille de débordement +N qu'en natif. Piloté par `notificationOverlayEnabled` / `notificationOverlayMs` depuis la diffusion settings. |
| Panneau de plan | Une quatrième zone persistante de sidebar au-dessus des notifications (M17). Plans, étapes, éditions, audit auto-continue — tout est routé à travers les envelopes `plansSnapshot` + `autoContinueAudit`. La bande d'audit se cache quand `autoContinueEngine` est désactivé. |
| Zone de logs | Lignes polies : badge de niveau coloré + timestamp `HH:MM:SS` + libellé de source + corps. Cliquez n'importe où sur la ligne pour copier `[HH:MM:SS] [source] [level] message`. L'en-tête montre `Logs (count) (showing 10)`. |
| Panneaux sideband | Les quatre types de contenu sont rendus. Glisser/redimensionner reroute vers l'hôte. |
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
