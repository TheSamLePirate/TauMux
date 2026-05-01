---
title: Métadonnées de processus en direct
description: Un observateur à 1 Hz qui surveille tous les descendants de chaque shell — cwd, ports, CPU, RSS, état git.
sidebar:
  order: 4
---

Un seul `SurfaceMetadataPoller` tourne dans le processus Bun et observe en continu chaque descendant de chaque shell. Sa sortie alimente les puces de l'en-tête de panneau, la barre latérale, le Process Manager, le miroir web et le CLI `ht` depuis une seule source de vérité.

## Ce qui est observé

Par surface, à chaque tick :

- **`pid`** — l'id du processus shell.
- **`foregroundPid`** — le leader de groupe du processus de premier plan du tty.
- **`cwd`** — répertoire de travail courant du processus de premier plan.
- **Arbre des descendants** — chaque enfant / petit-enfant / … avec argv complet, CPU%, RSS Ko.
- **Ports TCP en écoute** — dédupliqués par `(pid, port, address)`.
- **État git** — quand `cwd` est dans un git work tree : `branch`, `head`, `upstream`, `ahead` / `behind`, comptes de fichiers `staged` / `unstaged` / `untracked` / `conflicts`, comptes de lignes `insertions` / `deletions`.

## Comment

Par tick (1 Hz quand la fenêtre est focalisée, ~3 Hz quand elle est masquée) :

- **Un** appel `ps -axo pid,ppid,pgid,stat,%cpu,rss,args -ww`.
- **Un** appel combiné `lsof -iTCP -sTCP:LISTEN` sur l'union de tous les pids des arbres.
- **Un** appel combiné `lsof -d cwd` sur les pids de premier plan.
- Les appels git sont mis en cache TTL par cwd (3 s) pour que les panneaux inactifs ne sollicitent pas git en boucle.

Les instantanés sont diffés contre le tick précédent. `onMetadata(surfaceId, metadata)` ne se déclenche que sur changement réel. Les émissions sont diffusées vers le RPC Electrobun, le miroir web WebSocket, et le cache du CLI `ht`.

## Robustesse

- Le poller exécute `ps` / `lsof` sous l'utilisateur — seuls ses propres processus sont visibles.
- La sortie des sous-processus est parsée de manière robuste face aux locales : `LC_ALL=C, LANG=C` est défini pour que les séparateurs décimaux restent `.`.
- Les processus zombie (`Z` dans STAT) sont exclus de l'arbre.
- Les surfaces mortes sont vidées : quand `SessionManager.onSurfaceClosed` se déclenche, le cache est purgé au tick suivant.
- Tous les runners de sous-processus retournent des maps vides en cas d'échec — le poller ne fait jamais planter le processus principal.

## Où cela apparaît

| Consommateur | Ce qu'il affiche |
|---|---|
| Puces d'en-tête de panneau | commande de premier plan, cwd, puces de port |
| Barre latérale | carte package.json par espace de travail avec scripts en cours, commande de premier plan, ports |
| Process Manager (`⌘⌥P`) | chaque processus à travers les espaces de travail avec boutons de kill |
| CLI `ht` | `ht metadata`, `ht ps`, `ht ports`, `ht git`, `ht cwd`, `ht open`, `ht kill` |
| Miroir web | mêmes puces et barre latérale, mirroirées via WebSocket |
| Pane Info (`⌘I`) | vue détaillée complète pour le panneau focalisé |

## Accès CLI

```bash
ht metadata                          # JSON summary: pid / fg / cwd / git / counts
ht cwd                               # print cwd
ht ps                                # process tree with * marker on fg
ht ports                             # PORT PROTO ADDR PID COMMAND
ht git                               # branch, upstream, ahead/behind, dirty, +/-
ht open 3000                         # open http://localhost:3000
ht open                              # resolves the unique listening port
ht kill 3000                         # SIGTERM the pid on :3000
ht kill 3000 --signal SIGKILL
```

Référence complète : [`ht` processus & ports](/fr/cli/process-and-ports/).

## Source

- `src/bun/surface-metadata.ts` — poller + parsers + diff + émission.
- `src/shared/types.ts` — types `SurfaceMetadata`, `ProcessNode`.

## Pour aller plus loin

- [Process Manager](/fr/features/process-manager/)
- [`ht` processus & ports](/fr/cli/process-and-ports/)
- [Architecture](/fr/concepts/architecture/)
