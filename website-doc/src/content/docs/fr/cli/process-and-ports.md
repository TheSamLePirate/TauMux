---
title: Processus et ports
description: metadata, ps, cwd, git, ports, open, kill — alimentés par l'observateur de processus à 1 Hz.
sidebar:
  order: 7
---

Ces commandes interrogent le [pipeline de métadonnées de processus en direct](/fr/features/live-process-metadata/) et agissent sur les résultats. Elles observent toutes l'arbre des descendants de la surface ciblée et les ports en écoute — jamais la table de processus complète de l'utilisateur.

## metadata

```bash
ht metadata
ht metadata --json
ht metadata --surface surface:3
```

Résumé de tout ce que le poller sait sur la surface :

```
surface:1  pid=11234  fg=bun run dev (12345)
cwd:    ~/code/foo
ports:  3000 (tcp/0.0.0.0)
git:    main  ↑2  +12/-3  staged=1 unstaged=4
processes: 4  cpu=4.2%  rss=180M
```

`--json` renvoie l'objet `SurfaceMetadata` brut. Voir [JSON-RPC `surface.metadata`](/fr/api/surface/).

## cwd

```bash
ht cwd
# /Users/me/code/foo
```

Affiche le cwd du processus de premier plan. Une ligne, idéal pour `cd "$(ht cwd)"` depuis un autre panneau.

## ps

```bash
ht ps
# PID    PPID   CPU%   RSS    COMMAND
# 11234  ──     0.0%   8M     zsh
# 12345 *11234  4.2%  180M    bun run dev
# 12346  12345  0.8%   42M    esbuild --watch …
```

Arbre des processus. Le marqueur `*` étiquette le leader du groupe de processus de premier plan. `--json` renvoie l'arbre.

## ports

```bash
ht ports
# PORT  PROTO  ADDR             PID    COMMAND
# 3000  tcp    0.0.0.0          12345  bun run dev
# 8080  tcp    127.0.0.1        12346  esbuild
```

Ports TCP en écoute pour l'arbre de processus de la surface.

## git

```bash
ht git
# branch: main
# upstream: origin/main
# ahead: 2  behind: 0
# staged: 1  unstaged: 4  untracked: 0  conflicts: 0
# insertions: 12  deletions: 3
```

État git du `cwd`. Mis en cache avec un TTL de 3 s — appeler de manière répétée ne lance pas de nouveaux processus git.

## open

```bash
ht open                       # opens the unique listening port
ht open 3000                  # opens http://localhost:3000
ht open 3000 --browser        # forces the built-in browser even if external is configured
```

Résout un port en URL et l'ouvre. Sans argument, exige que la surface ait exactement un port en écoute.

Si la surface ciblée vient d'être spawnée et que le poller de métadonnées 1 Hz n'a pas encore produit de snapshot, `ht open` et `ht kill` attendent désormais jusqu'à 2 s avant d'échouer — fini le `no metadata yet — try again in a second` au race du premier tick. Après 2 s sans snapshot, l'erreur devient `surface metadata unavailable after 2000ms — pane may have crashed`. Utilisez [`ht wait-ready`](/fr/cli/surfaces-and-io/#wait-ready) si vous préférez fixer le moment explicitement.

## kill

```bash
ht kill 3000                              # SIGTERM the pid bound to :3000
ht kill 3000 --signal SIGKILL
ht kill --pid 12345                       # by pid instead of port
```

Envoie un signal à un processus. Avec un argument numérique, le traite comme un port (trouve le pid via `lsof -iTCP:<port> -sTCP:LISTEN`). Utilisez `--pid` pour adresser directement par pid.

## Pour aller plus loin

- [Métadonnées de processus en direct](/fr/features/live-process-metadata/)
- [Process Manager](/fr/features/process-manager/)
- [Méthodes JSON-RPC surface](/fr/api/surface/)
