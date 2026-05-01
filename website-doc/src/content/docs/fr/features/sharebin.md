---
title: Sharebin
description: Déposez un fichier ou collez du texte, obtenez une URL courte servie depuis le miroir web local. Pour partager des captures d'écran, des logs ou des extraits ponctuels entre machines.
sidebar:
  order: 8
---

Sharebin est une petite boîte aux lettres de style pastebin servie depuis le miroir web de τ-mux. Elle vous permet de déposer un fichier (image, log, extrait de code) dans un emplacement de la barre latérale et d'obtenir immédiatement une URL courte comme `http://<your-ip>:3000/share/abc123` que n'importe qui sur le LAN (ou n'importe qui avec un jeton d'auth valide) peut récupérer.

## À quoi ça sert

- « Hé, c'est quoi cette erreur sur ton écran ? » — `ht share screenshot.png`, collez l'URL.
- Transférer un log de build à un coéquipier sans le faire passer par Slack.
- Partager la sortie d'une commande longue entre deux instances τ-mux sur le même réseau.

## Comment ça marche

- Les fichiers vivent sous `~/Library/Application Support/hyperterm-canvas/sharebin/`, indexés par des ids courts aléatoires.
- Le miroir web sert `/share/<id>` pour chaque entrée, en appliquant les mêmes contrôles d'auth que le reste du miroir.
- Un panneau de la barre latérale liste les entrées actuelles avec taille / date de création / suppression en un clic.
- Les entrées ne sont pas auto-expirées — nettoyez-les explicitement (bouton UI ou `ht share clear`).

## Ajouter des entrées

- **Glisser-déposer** un fichier sur le panneau sharebin de la barre latérale.
- **Coller du texte** avec `⌘V` quand le panneau est focalisé — le texte devient une entrée `.txt`.
- Depuis un script : écrivez un fichier dans le dossier sharebin et postez une ligne de métadonnées via le canal standard (prévu).

## Durcissement

Mêmes protections que le reste du [miroir web](/fr/web-mirror/auth-and-hardening/) :

- L'auth par jeton s'applique — `Authorization: Bearer <token>` ou `?t=<token>` sur l'URL.
- Les vérifications d'origine / taille / rate-limit s'appliquent aussi aux GET.
- Les entrées sharebin sont en lecture seule via HTTP. Le miroir web ne peut pas téléverser — les entrées ne peuvent être créées que depuis l'hôte.

## Fichiers source

- `src/bun/sharebin.ts` — registre des entrées, métadonnées, lookup des fichiers.
- `src/bun/web/server.ts` — route `/share/:id`.
- `src/views/terminal/sidebar.ts` — panneau sharebin de la barre latérale.

## Pour aller plus loin

- [Vue d'ensemble du miroir web](/fr/web-mirror/overview/)
- [Auth et durcissement](/fr/web-mirror/auth-and-hardening/)
