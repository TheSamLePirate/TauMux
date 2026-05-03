---
title: Authentification et durcissement
description: Comparaison de jetons, contrôle d'origine, plafonds de taille, limites de débit — ce que fait le miroir pour rester plus sûr sur un LAN.
sidebar:
  order: 2
---

Le miroir web est conçu pour des réseaux de confiance. Le durcissement ci-dessous réduit la surface mais ne remplace pas les contrôles réseau — bindez sur `127.0.0.1` ou définissez un jeton avant de l'exposer à quoi que ce soit que vous ne contrôliez pas pleinement.

## Authentification par jeton

Définissez `webMirrorAuthToken` dans **Réglages → Réseau → Jeton**. Une fois défini, chaque requête doit le présenter :

- Chaîne de requête : `?t=<token>` — le plus simple pour les liens `<a href>`.
- En-tête : `Authorization: Bearer <token>` — préféré pour les clients programmatiques.

La comparaison est en **temps constant** via `timingSafeEqualStr`. Le jeton ne peut pas être attaqué par force brute octet par octet via du sondage de latence.

Si le jeton est incorrect :

- Les requêtes HTTP reçoivent un `401 Unauthorized` sans corps.
- Les upgrades WebSocket sont rejetés avant la fin du handshake.

### `?t=…` est nettoyé de l'URL après la première authentification

Quand la page charge depuis un lien `?t=<token>`, le navigateur capture le jeton au chargement du module puis **le retire de `window.location` via `history.replaceState`** dès que la première ouverture WebSocket réussit. Les reconnexions continuent à s'authentifier parce que le jeton survit dans la portée du module — seule l'URL est nettoyée. Effet net : le jeton ne peut pas fuir via partage d'écran, la pile back/forward, le copier-coller de l'URL, ou les en-têtes `Referer` des liens sortants.

Si la connexion initiale échoue (401, erreur réseau), l'URL est laissée intacte intentionnellement pour que l'échec reste débuggable — vous voyez encore le jeton fourni dans la barre d'adresse et pouvez le copier/éditer.

## Contrôle d'origine

Les upgrades WebSocket sont rejetés lorsque l'en-tête `Origin` est défini et ne correspond pas à `Host`. Cela empêche les navigateurs sur un autre site de détourner la connexion via une requête WS forgée.

Les clients natifs qui omettent `Origin` (par exemple `curl`, `ht`, des clients WebSocket personnalisés) se connectent toujours — seules les requêtes provenant d'un navigateur portent `Origin`, et un navigateur ne peut pas le falsifier.

## Plafonds de taille par trame

Chaque trame client → serveur est plafonnée en taille :

- 256 KiB par enveloppe (le wrapper JSON).
- 64 KiB par charge utile `stdin` (après dépaquetage de l'enveloppe).

Les trames trop volumineuses sont silencieusement abandonnées ; la connexion reste ouverte.

## Limitation de débit

Un token bucket limite chaque connexion à 256 trames par seconde. Les trames en excès sont silencieusement abandonnées. Suffisamment généreux pour que la frappe normale et les rafales de redimensionnement passent ; suffisamment serré pour qu'un client mal intentionné ne puisse pas inonder le serveur.

## Bornage des redimensionnements

Les enveloppes `surfaceResizeRequest` sont validées :

- `cols` borné à `[10, 500]`.
- `rows` borné à `[4, 500]`.
- Les valeurs non analysables sont entièrement rejetées (pas de valeur par défaut de repli).

## ID de session

Les jetons de reprise sont des chaînes hexadécimales 128 bits issues de `crypto.getRandomValues`. Aucune structure prévisible — deviner un id de reprise valide revient à attaquer par force brute 128 bits d'entropie.

## Adresse de bind

Le bind par défaut est `0.0.0.0` (toutes les interfaces). Réglez `webMirrorBind` sur `127.0.0.1` pour rendre le miroir joignable uniquement depuis le portable lui-même — utile lorsque vous voulez l'URL mais pas l'exposer sur le LAN.

## Modèle de menace — ce qui n'est PAS couvert

- **L'écoute réseau.** Le fil utilise un WebSocket en clair, pas TLS. Quiconque sur le LAN avec une capture de paquets voit stdout. Utilisez un VPN ou tenez-vous-en à la loopback pour les flux sensibles.
- **L'élévation de privilèges à l'intérieur de τ-mux.** Un miroir authentifié dispose d'un accès PTY complet — comme s'il était assis devant le portable. Le jeton est la barrière.
- **Les exploits de navigateur.** Le miroir sert l'`innerHTML` provenant des panneaux HTML sideband. Si vous rendez du HTML contrôlé par un attaquant, vous êtes exposé.

## Source

- `src/bun/web/server.ts` — logique d'authentification, d'origine, de limitation de débit et de plafonnage de taille.

## Pour aller plus loin

- [Vue d'ensemble du miroir web](/fr/web-mirror/overview/)
- [Protocole v2](/fr/web-mirror/protocol-v2/)
- [Réglages : Réseau](/fr/configuration/settings/)
