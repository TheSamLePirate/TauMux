---
title: Protocole v2
description: Enveloppes, numéros de séquence, reprise, tampon circulaire — le format de fil entre le serveur du miroir web et le client.
sidebar:
  order: 3
---

Le miroir web parle des enveloppes du **protocole v2**. Chaque trame, dans un sens comme dans l'autre, est un objet JSON avec un `type` et un `seq` (serveur → client uniquement).

## Connexion

Ouvrez un WebSocket vers `/ws` sur l'hôte du miroir. Ajoutez optionnellement `?t=<token>` pour l'authentification, et `?resume=<id>&seq=<n>` pour rejouer la sortie tamponnée d'une session précédente.

```
ws://<host>:3000/ws?t=<token>&resume=<id>&seq=<n>
```

## Première trame : hello

La première trame du serveur décrit la session :

```json
{
  "type": "hello",
  "sessionId": "f4a2…",
  "seq": 0,
  "version": 2,
  "settings": { "theme": "obsidian", "paneGap": 4, … },
  "snapshot": {
    "workspaces": [ … ],
    "panels": [ … ],
    "sidebar": { … }
  }
}
```

Le client stocke `sessionId` pour la reprise, configure xterm avec l'instantané, et commence à traiter les trames suivantes.

## Trames serveur → client

| `type` | Quand | Charge utile |
|---|---|---|
| `hello` | Première trame après l'upgrade. | id de session, réglages, instantané |
| `surfaceStdout` | Sortie PTY. | `surfaceId`, `bytes` (base64) |
| `surfaceMetadata` | Les métadonnées d'une surface ont changé. | `surfaceId`, `SurfaceMetadata` complet |
| `panelCreate` / `panelUpdate` / `panelClear` | Cycle de vie des panneaux sideband. | options de panneau ou id |
| `sidebarUpdate` | Changement de pastille de statut / progression / journal. | état partiel de la barre latérale |
| `notificationCreate` / `notificationDismiss` | Notifications. | enregistrement de notification / id |
| `pong` | Réponse à un `ping` du client. | heure du serveur |

Chacune porte un `seq` — un numéro de séquence par session incrémenté à chaque trame.

## Trames client → serveur

| `type` | Rôle | Charge utile |
|---|---|---|
| `surfaceStdin` | Frappe dans un terminal. | `surfaceId`, `bytes` (base64), plafonné à 64 KiB |
| `surfaceResizeRequest` | xterm rapporte de nouvelles dimensions. | `surfaceId`, `cols` (10–500), `rows` (4–500) |
| `surfaceFocus` | Le focus UI suit. | `surfaceId` |
| `panelInteract` | Clic / glisser / redimensionnement sur un panneau interactif. | id de panneau, événement |
| `ping` | Vérification de présence. | `nonce` |
| `cancel` | Annule une méthode en streaming (par exemple suivi de métadonnées). | `id` |

Les trames sont bornées à 256 KiB par enveloppe et limitées à 256/sec par connexion.

## Reprise

Pour reprendre après une déconnexion, reconnectez-vous avec `?resume=<sessionId>&seq=<lastSeqYouSaw>` :

- Le serveur vérifie son tampon circulaire (2 Mo par session) pour tout ce qui suit `seq`.
- Si trouvé : le serveur rejoue les trames manquées dans l'ordre, puis reprend le streaming en direct.
- Si absent ou expiré : le serveur émet un nouveau `hello` et le client reprend un instantané.

## Coalescing de stdout

La sortie PTY est coalescée à une granularité de 16 ms. De nombreuses petites écritures dans un même intervalle de trame sont vidées en une seule enveloppe `surfaceStdout`. Maintient la fréquence de trame à ≤ 60 Hz sans perdre la réactivité perceptuelle.

## Rejeu d'instantané

Pour les scénarios de reprise où le tampon circulaire est trop petit (par exemple plusieurs minutes de déconnexion), le serveur utilise `@xterm/headless` + `SerializeAddon` pour calculer un instantané « état actuel » du terminal en une seule trame — couleurs, position du curseur, écran alterné — et l'expédie au lieu de diffuser tout le flux d'octets historique.

## Source

- `src/bun/web/server.ts` — répartition des enveloppes.
- `src/bun/web/connection.ts` — `SessionBuffer` (tampon circulaire, seq, contre-pression).
- `src/web-client/transport.ts` — gestion des enveloppes côté client.
- `src/web-client/protocol-dispatcher.ts` — répartition message-serveur → action-store.

## Pour aller plus loin

- [Vue d'ensemble du miroir web](/fr/web-mirror/overview/)
- [Authentification et durcissement](/fr/web-mirror/auth-and-hardening/)
