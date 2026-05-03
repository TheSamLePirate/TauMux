---
title: Process & ports
description: metadata, ps, cwd, git, ports, open, kill — fed by the 1 Hz process observer.
sidebar:
  order: 7
---

These commands query the [live process metadata pipeline](/features/live-process-metadata/) and act on the results. They all observe the targeted surface's descendant tree and listening ports — never the user's full process table.

## metadata

```bash
ht metadata
ht metadata --json
ht metadata --surface surface:3
```

Summary of everything the poller knows about the surface:

```
surface:1  pid=11234  fg=bun run dev (12345)
cwd:    ~/code/foo
ports:  3000 (tcp/0.0.0.0)
git:    main  ↑2  +12/-3  staged=1 unstaged=4
processes: 4  cpu=4.2%  rss=180M
```

`--json` returns the raw `SurfaceMetadata` object. See [JSON-RPC `surface.metadata`](/api/surface/).

## cwd

```bash
ht cwd
# /Users/me/code/foo
```

Print the foreground process's cwd. One-line, ideal for `cd "$(ht cwd)"` from another pane.

## ps

```bash
ht ps
# PID    PPID   CPU%   RSS    COMMAND
# 11234  ──     0.0%   8M     zsh
# 12345 *11234  4.2%  180M    bun run dev
# 12346  12345  0.8%   42M    esbuild --watch …
```

Process tree. The `*` marker tags the foreground process group leader. `--json` returns the tree.

## ports

```bash
ht ports
# PORT  PROTO  ADDR             PID    COMMAND
# 3000  tcp    0.0.0.0          12345  bun run dev
# 8080  tcp    127.0.0.1        12346  esbuild
```

Listening TCP ports for the surface's process tree.

## git

```bash
ht git
# branch: main
# upstream: origin/main
# ahead: 2  behind: 0
# staged: 1  unstaged: 4  untracked: 0  conflicts: 0
# insertions: 12  deletions: 3
```

Git state of `cwd`. TTL-cached for 3 s — calling repeatedly doesn't spawn new git processes.

## open

```bash
ht open                       # opens the unique listening port
ht open 3000                  # opens http://localhost:3000
ht open 3000 --browser        # forces the built-in browser even if external is configured
```

Resolves a port to a URL and opens it. Without an arg, requires that the surface have exactly one listening port.

If the targeted surface was just spawned and the 1 Hz metadata poller hasn't produced a snapshot yet, `ht open` and `ht kill` now wait up to 2 s for it before erroring out — no more `no metadata yet — try again in a second` on first-tick race. After 2 s with no snapshot the error becomes `surface metadata unavailable after 2000ms — pane may have crashed`. Use [`ht wait-ready`](/cli/surfaces-and-io/#wait-ready) if you'd rather pin the moment explicitly.

## kill

```bash
ht kill 3000                              # SIGTERM the pid bound to :3000
ht kill 3000 --signal SIGKILL
ht kill --pid 12345                       # by pid instead of port
```

Sends a signal to a process. With a numeric arg, treats it as a port (find the pid via `lsof -iTCP:<port> -sTCP:LISTEN`). Use `--pid` to address by pid directly.

## Read more

- [Live process metadata](/features/live-process-metadata/)
- [Process Manager](/features/process-manager/)
- [JSON-RPC surface methods](/api/surface/)
