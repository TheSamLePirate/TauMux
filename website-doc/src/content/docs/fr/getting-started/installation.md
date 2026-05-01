---
title: Installation
description: Compilez τ-mux depuis les sources ou installez l'application .app fournie, puis ajoutez `ht` à votre PATH.
sidebar:
  order: 2
---

τ-mux est actuellement disponible uniquement sur macOS. Vous avez besoin de [Bun](https://bun.sh) ≥ 1.3 pour compiler depuis les sources, mais le `.app` produit est autonome — aucun Bun n'est requis sur la machine cible.

## Depuis les sources (développement)

```bash
git clone https://github.com/TheSamLePirate/TauMux.git
cd TauMux
bun install
bun start                     # build de dev + lancement
```

## Build de production

```bash
bun run build:stable          # produit le .app + DMG avec le CLI `ht` intégré
```

Le `.app` produit embarque un binaire `ht` autonome compilé dans `Contents/MacOS/ht`. Après le lancement, cliquez sur **τ-mux → Install 'ht' Command in PATH** depuis la barre de menus pour créer un lien symbolique vers `/usr/local/bin/ht`. La première installation demande des privilèges administrateur. À partir de là, n'importe quel shell peut piloter τ-mux.

## CLI pour d'autres Macs

Pour utiliser `ht` contre une instance τ-mux sur un Mac qui n'a pas Bun installé, compilez le binaire autonome :

```bash
bun run build:cli            # produit ./build/ht-cli
```

Copiez `./build/ht-cli` n'importe où dans le `PATH` de la machine cible (renommez-le `ht` si vous préférez) et il communiquera avec le τ-mux en cours d'exécution via le socket Unix `/tmp/hyperterm.sock`.

## Vérification

Après installation :

```bash
ht ping                       # → PONG
ht version                    # version du build
ht identify                   # surface focalisée + espace de travail
```

Si `ht ping` se bloque, τ-mux n'est probablement pas en cours d'exécution, ou `HT_SOCKET_PATH` remplace l'emplacement du socket par défaut. Voir [Variables d'environnement](/fr/configuration/env-vars/).

## Désinstallation

- Glissez τ-mux hors de `/Applications` pour supprimer l'application.
- `sudo rm /usr/local/bin/ht` pour supprimer le lien symbolique du CLI.
- `rm -rf ~/Library/Application\ Support/hyperterm-canvas` pour effacer les paramètres, la base de données telegram et l'historique du navigateur.
- `rm -rf ~/Library/Logs/tau-mux` pour supprimer les logs.
