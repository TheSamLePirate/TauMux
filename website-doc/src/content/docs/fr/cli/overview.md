---
title: ht — vue d'ensemble
description: Comment le CLI `ht` parle à τ-mux, les variables d'environnement, --json, et le ciblage --surface.
sidebar:
  order: 1
---

`ht` est le CLI de τ-mux. Il parle à une instance τ-mux en cours d'exécution via un socket Unix (`/tmp/hyperterm.sock`) en utilisant JSON-RPC.

## Installation

Dans une build de production, cliquez sur **τ-mux → Install 'ht' Command in PATH** depuis le menu — cela crée un lien symbolique du binaire fourni à `Contents/MacOS/ht` vers `/usr/local/bin/ht`. Voir [Installation](/fr/getting-started/installation/).

Pour le développement :

```bash
bun link              # exposes ./bin/ht as `ht`
```

Pour un binaire autonome sur un autre Mac :

```bash
bun run build:cli     # → ./build/ht-cli
```

## Vérifier

```bash
ht ping               # → PONG
ht version            # build version
ht identify           # focused surface + workspace
```

## Ciblage

La plupart des commandes opèrent sur une surface. Le CLI résout la cible dans cet ordre :

1. Option `--surface <id>` (par ex. `--surface surface:3`)
2. Variable d'env `HT_SURFACE` (auto-définie à l'intérieur des panneaux τ-mux)
3. La surface actuellement focalisée

Donc à l'intérieur d'un panneau τ-mux, `ht ps` « fonctionne tout simplement » — il lit depuis votre propre panneau. À l'extérieur de τ-mux, passez `--surface` explicitement.

Les commandes ciblant un espace de travail acceptent `--workspace <id>` (par ex. `--workspace ws:2`).

## Sortie JSON

Chaque commande prend en charge `--json` (ou `-j`) pour émettre du JSON brut :

```bash
ht metadata --json | jq .ports
ht ps --json | jq '.tree[0]'
```

Sans `--json`, la sortie est du texte lisible par un humain — des tableaux pour les listes, des lignes de résumé pour les appels de statut.

## Variables d'environnement

| Variable | Rôle |
|----------|---------|
| `HT_SOCKET_PATH` | Remplace `/tmp/hyperterm.sock` |
| `HT_SURFACE` | Auto-défini par shell créé (CLI par défaut pour `--surface` ; le serveur résout l'espace de travail propriétaire à partir de celui-ci pour les commandes scopées par espace de travail) |
| `HT_WORKSPACE_ID` | Remplacement optionnel pour `--workspace`. **Pas** auto-défini — exportez-le manuellement si vous voulez qu'un shell hors panneau utilise par défaut un espace de travail spécifique. |
| `HYPERTERM_WEB_PORT` | Remplace `webMirrorPort` et force le démarrage du miroir |
| `HYPERTERM_DEBUG` | Active les logs de debug dans les clients sideband Python / TS |

## Découvrabilité

```bash
ht capabilities --json    # full method catalogue
ht --help                 # top-level command list
ht <command> --help       # per-command help
```

## Groupes de commandes

- [System](/fr/cli/system/) — ping, version, identify, tree, capabilities
- [Workspaces](/fr/cli/workspaces/) — list, new, select, close, rename, next, prev
- [Surfaces & I/O](/fr/cli/surfaces-and-io/) — split, focus, close, send, send-key, read-screen, screenshot
- [Sidebar & status](/fr/cli/sidebar-and-status/) — set-status, set-progress, log
- [Notifications](/fr/cli/notifications/) — notify, list, clear
- [Process & ports](/fr/cli/process-and-ports/) — metadata, ps, cwd, git, ports, open, kill
- [Browser](/fr/cli/browser/) — plus de 40 commandes pour l'automatisation du navigateur intégré
- [Telegram](/fr/cli/telegram/) — status, chats, read, send
- [Ask-user](/fr/cli/ask-user/) — yesno, choice, text, confirm-command (bloque sur une question structurée)
- [Plan](/fr/cli/plan/) — set, update, complete, clear, list (publie des plans d'agent multi-étapes)
- [Auto-continue](/fr/cli/autocontinue/) — status, audit, set, fire, pause, resume (moteur qui envoie automatiquement `Continue` à la fin du tour)

## Compatibilité tmux

```bash
ht capture-pane --lines 50    # alias for read-screen
```

L'ensemble est intentionnellement réduit — uniquement les appels que les scripts supposent le plus couramment. Il n'y a pas de plan pour une compatibilité complète avec tmux.
