# HyperTerm Canvas: Live Process Metadata

HyperTerm watches every descendant of every shell it spawns and pushes that snapshot live into the UI and every attached client. No tmux, no shell integration, no node-pty — just `ps` and `lsof` run against pids the `PtyManager` already owns. This document covers what we track, how the pipeline is wired, how to extend it, how to consume it, and what to do when the numbers look wrong.

---

## 1. What we track

Each surface (pane) has a live `SurfaceMetadata` snapshot. The shape is defined in `src/shared/types.ts`:

```ts
interface ProcessNode {
  pid: number;           // process id
  ppid: number;          // parent pid
  command: string;       // full argv — "bun run dev", "python3 -m http.server 8765"
  cpu: number;           // instantaneous CPU% from `ps %cpu`
  rssKb: number;         // resident set size in KB from `ps rss`
}

interface ListeningPort {
  pid: number;
  port: number;
  proto: "tcp" | "tcp6";
  address: string;       // "*", "127.0.0.1", "::1", etc.
}

interface GitInfo {
  branch: string;        // "main"; "(detached)" when HEAD is detached
  head: string;          // abbrev commit hash, "" when repo has no commits yet
  upstream: string;      // "origin/main", "" when no tracking branch
  ahead: number;         // commits ahead of upstream
  behind: number;        // commits behind upstream
  staged: number;        // files with staged changes
  unstaged: number;      // files with unstaged changes
  untracked: number;     // new, non-ignored files
  conflicts: number;     // files with merge conflicts
  insertions: number;    // lines added in `git diff HEAD --shortstat`
  deletions: number;     // lines removed in `git diff HEAD --shortstat`
  detached: boolean;     // true when `# branch.head` is "(detached)"
}

interface SurfaceMetadata {
  pid: number;            // the shell's pid (same as PtyManager.pid)
  foregroundPid: number;  // foreground pgrp leader on the pane tty
  cwd: string;            // cwd of foregroundPid
  tree: ProcessNode[];    // pre-order, rooted at pid
  listeningPorts: ListeningPort[];
  git: GitInfo | null;    // null when cwd is not inside a git repo
  updatedAt: number;      // wall-clock ms
}
```

Nothing else — all derived fields (e.g. the foreground command string) are computed by consumers via `tree.find(n => n.pid === foregroundPid)?.command`.

---

## 2. Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│  SessionManager                                                     │
│    - maintains Surface[]                                            │
│    - each Surface has a PtyManager (which has a pid)                │
└────────────────┬────────────────────────────────────────────────────┘
                 │ getAllSurfaces()
                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SurfaceMetadataPoller  (src/bun/surface-metadata.ts)               │
│                                                                     │
│   setInterval(tick, intervalMs)                                     │
│     ├─ runPs()            — 1 subprocess, parsed once               │
│     ├─ for each surface:                                            │
│     │    walkTree(shellPid, psMap)                                  │
│     │    findForegroundPid(tree, psMap)                             │
│     │    collect pids                                               │
│     ├─ runListeningPorts([...treePids]) — 1 subprocess               │
│     ├─ runCwds([...fgPids])             — 1 subprocess               │
│     ├─ assemble SurfaceMetadata per surface                         │
│     └─ diff vs previous snapshot; if changed → onMetadata()         │
└────────────────┬────────────────────────────────────────────────────┘
                 │ onMetadata(surfaceId, metadata)
                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  src/bun/index.ts                                                   │
│    rpc.send("surfaceMetadata", { surfaceId, metadata })             │
│    webServer?.broadcast({ type:"surfaceMetadata", ... })            │
└────────────────┬────────────────────────────────────────────────────┘
                 │
   ┌─────────────┴─────────────┐
   ▼                           ▼
┌───────────┐          ┌─────────────────┐
│ Webview   │          │ Web mirror      │
│ (chips,   │          │ (WebSocket,     │
│ sidebar,  │          │ parallel chips) │
│ process   │          └─────────────────┘
│ manager)  │
└───────────┘
```

Three subprocesses per tick, total — all parsers are pure functions and exported from `surface-metadata.ts` for the test suite.

---

## 3. The poller

`src/bun/surface-metadata.ts` — the `SurfaceMetadataPoller` class.

### Constructor

```ts
new SurfaceMetadataPoller(sessions, intervalMs = 1000)
```

- `sessions` implements `{ getAllSurfaces(): { id, pty: { pid } }[] }` — structurally compatible with `SessionManager`.
- `intervalMs` is clamped to `≥ 250` at `setPollRate`.

### Lifecycle

```ts
poller.onMetadata = (surfaceId, metadata) => { /* ... */ };
poller.start();                     // fires immediately, then every intervalMs
poller.setPollRate(visible ? 1000 : 3000);
poller.stop();
poller.getSnapshot(surfaceId);      // cached — used by `ht` CLI queries
```

`inFlight` gates the tick — if a previous tick hasn't finished, the next timer firing is a no-op. This means bursty load (e.g. macOS `lsof` spiking to 200 ms) never stacks ticks.

### Diff

`metadataEqual(prev, next)` compares every field except `updatedAt`. Only on inequality does `onMetadata` fire. This keeps the RPC channel and the web mirror WebSocket quiet when nothing is changing.

### Focus-aware cadence

`src/views/terminal/index.ts` listens to `document.visibilitychange` and sends a `windowVisibility: { visible }` RPC to bun. The bun-side handler calls `poller.setPollRate(visible ? 1000 : 3000)`. You can drop this to 500 ms for buttery live feel, but the sweet spot is 1 Hz — ports and foreground commands perceive "instant", and CPU stays < 0.5 %.

---

## 4. Parsers

All parsers are **pure**. No filesystem, no subprocess — each one consumes a string and returns a `Map`. This is what lets the test suite lock behavior without running `ps` / `lsof`.

### `parsePs(output: string): Map<number, PsRow>`

Consumes `ps -axo pid,ppid,pgid,stat,%cpu,rss,args -ww` output. The ps invocation always runs with `LC_ALL=C, LANG=C` in the env so `%cpu` uses `.` as decimal separator; the parser also accepts `,` defensively (for users running against a pre-wrapped binary, or for bug-report fixtures).

Regex:

```
/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([\d.,]+)\s+(\d+)\s+(.*)$/
```

1. pid, 2. ppid, 3. pgid, 4. stat, 5. %cpu, 6. rss, 7. args (captured greedy, EOL).

Header lines don't match (first column is `"PID"`, not digits). Blank lines are skipped. `%cpu` values are normalized via `.replace(",", ".")` before `Number()`.

### `parseListeningPorts(output: string): Map<number, ListeningPort[]>`

Consumes `lsof -nP -iTCP -sTCP:LISTEN -F pn -w -a -p <pids>` output. `-F pn` requests only the pid and address fields; `-w` suppresses warnings; `-a` ANDs the pid list with the listener filter.

`lsof` emits one record per file descriptor, so a socket shared across a `fork()` surfaces twice. The parser **dedupes** by `(pid, port, address, proto)`:

```
p649
f8                    ← separator line (lsof always emits even if not requested)
n*:7000
f11
n*:7000               ← same socket, different fd → deduped
```

IPv6 is detected purely from the address format (bracketed address = IPv6; plain = IPv4). `lsof` doesn't surface a separate family flag for `-F pn`.

### `parseCwds(output: string): Map<number, string>`

Consumes `lsof -a -d cwd -F pn -w -p <pids>` output. Each pid block has exactly one `n<path>` line:

```
p12345
n/Users/olivier/work/proj
```

First `n` line per pid wins (should be the only one).

### `parseListenAddress(value: string)`

Handles all four shapes lsof emits:

| Input | `{ address, port }` |
|-------|---------------------|
| `*:8080` | `{ "*", 8080 }` |
| `127.0.0.1:3000` | `{ "127.0.0.1", 3000 }` |
| `[::]:8080` | `{ "::", 8080 }` |
| `[::1]:443` | `{ "::1", 443 }` |

Returns `null` for malformed input.

### `parseGitStatusV2(output: string): GitInfo | null`

Consumes `git status --porcelain=v2 -b` output. The porcelain v2 format is stable and designed for tooling — each line is prefixed by a single letter identifying the record kind:

| Prefix | Meaning | What we extract |
|--------|---------|-----------------|
| `# branch.oid <sha>` | HEAD commit SHA (or `(initial)` before the first commit) | 12-char abbrev → `head` |
| `# branch.head <name>` | Current branch, or `(detached)` | `branch`, `detached` |
| `# branch.upstream <name>` | Tracked upstream, missing when none | `upstream` |
| `# branch.ab +N -M` | Ahead/behind vs upstream | `ahead`, `behind` |
| `1 XY …` | Ordinary change (XY = index/worktree states, `.` = unchanged) | `staged` / `unstaged` counters |
| `2 XY …` | Renamed/copied change | `staged` / `unstaged` counters |
| `? <path>` | Untracked | `untracked` counter |
| `u XY …` | Unmerged (conflicts) | `conflicts` counter |
| `! <path>` | Ignored (only if `--ignored` requested) | *skipped* |

Line counts (`insertions`, `deletions`) stay at `0` — they come from `parseShortstat` on a separate `git diff HEAD --shortstat` call, merged into the same `GitInfo`.

Runs with `LC_ALL=C, LANG=C` in the subprocess env (same as `ps`) so Git's output uses the English keywords the regex depends on.

Returns `null` only when the input string is empty; a repo with zero changes still returns a fully-populated `GitInfo` with all counters at 0. The poller separately detects "not a git repo" via the subprocess exit code (≠ 0 → `null` snapshot cached).

### `parseShortstat(output: string)`

Matches `N insertion(s)(+)` and `N deletion(s)(-)` anywhere in the string — tolerates the variable phrasing Git uses (`"1 file changed, 1 insertion(+)"` vs `"3 files changed, 42 insertions(+), 15 deletions(-)"`). Returns `{ insertions: 0, deletions: 0 }` for empty input.

### Git TTL cache

`git status` is cheap on small repos but can take hundreds of ms on kernel-sized trees. The poller caches `GitInfo | null` per cwd for `gitTtlMs = 3000`, then refreshes only when a cwd's entry is stale. Stale entries whose cwd hasn't been seen in > 12 s are evicted. This means:

- **1 Hz tick** with unchanged cwd → **0** git calls.
- **User `cd`'s to a new dir** → up to 2 git calls on the next tick (status + diff).
- **Huge repos** → the first tick after a `cd` may emit snapshots ~200 ms late; subsequent ticks read from cache.

Both git calls run in parallel via `Promise.all` across stale cwds, so N surfaces in N different repos cost ~max(git latency) wall time, not N×.

### `walkTree(rootPid, psMap)`

Builds a ppid → children index once, then DFS pre-order from `rootPid`. Returns `ProcessNode[]`. Zombies (`Z` in STAT) are filtered out — they'd inflate CPU graphs with ghosts.

### `findForegroundPid(tree, psMap)`

Walks the tree looking for the pgrp leader (stat contains `+` AND `pid === pgid`). Falls back to any `+` process (for rare pipeline-member cases), then to the shell pid.

The POSIX foreground process group convention matches what `tmux` shows as `pane_current_command`, so the foreground chip in the UI lines up with user intuition.

---

## 5. Consumers

### Pane header chips

`src/views/terminal/surface-manager.ts` → `renderSurfaceChips(host, metadata)`:

- Command chip (amber) — shown when `foregroundPid !== pid` AND the node has a non-empty command. Truncated to 48 chars, full command on hover.
- CWD chip (muted mono) — `shortenCwd(cwd)`: keeps the last two path segments (`…/proj/src`), full path on hover.
- Port chips (green) — one per unique port; click or keyboard-activate to dispatch a `ht-open-external` CustomEvent → RPC → `Utils.openExternal`.

### Sidebar

`src/views/terminal/sidebar.ts` → `WorkspaceInfo.listeningPorts` + `focusedSurfaceCommand`:

- **Ports row** per workspace — aggregated across every pane, deduped by port number. Clickable.
- **Focused fg command** — shown as a monospace accent chip in the workspace meta row, replacing the stale "focused surface title" when the fg differs from the shell.
- Sidebar only re-renders when the visible projection (port set OR focused-surface fg pid) changes. cwd/tree churn is filtered out by `setSurfaceMetadata`.

### Process Manager

`src/views/terminal/process-manager.ts` — the `⌘⌥P` overlay.

- Summary line: total procs, aggregate CPU %, aggregate RSS.
- Per workspace: accent-colored header with process count.
- Per surface: collapsible row with cwd + port chips, then a table of every descendant with PID, command, CPU %, RSS, and a kill button.
- Foreground row highlighted with accent.
- Kill button sends SIGTERM; Shift+click sends SIGKILL.
- `refresh()` re-renders only when visible; the webview `surfaceMetadata` RPC handler calls it unconditionally (cheap no-op when hidden).

### Web mirror

Same shape as the native pane header, rendered in plain JS inside `buildHtmlPage()` in `src/bun/web-server.ts`. `case "surfaceMetadata":` caches the snapshot keyed by surfaceId and calls `renderPaneChips(chipsEl, meta)`. Port chips open `http://${location.hostname}:${port}` so LAN clients (your phone) hit the laptop's IP automatically.

### `ht` CLI

`bin/ht` has five metadata-backed commands, all routed through the `surface.metadata` socket method and formatted client-side:

```bash
ht metadata                          # summary: pid / fg / cwd / counts
ht cwd                               # just cwd
ht ps                                # PID PPID COMMAND with * on fg
ht ports                             # PORT PROTO ADDR PID COMMAND
ht open [PORT]                       # open http://localhost:PORT
ht kill PORT [--signal SIG]          # signal the pid bound to PORT
```

Without `--surface`, all five default to `HT_SURFACE` (auto-set per spawned shell) and finally to the focused surface.

---

## 6. Socket RPC methods

Defined in `src/bun/rpc-handler.ts`:

### `surface.metadata`

```json
// → Request
{"id":"1","method":"surface.metadata","params":{"surface_id":"surface:2"}}

// ← Response
{"id":"1","result":{
  "pid": 12345,
  "foregroundPid": 12346,
  "cwd": "/Users/olivier/work",
  "tree": [
    {"pid":12345,"ppid":1,"command":"zsh","cpu":0.1,"rssKb":2048},
    {"pid":12346,"ppid":12345,"command":"bun run dev","cpu":12.4,"rssKb":45312}
  ],
  "listeningPorts": [
    {"pid":12346,"port":3000,"proto":"tcp","address":"*"}
  ],
  "updatedAt": 1728766122123
}}
```

Returns `null` if the surface hasn't been polled yet (very first second after spawn) or the id is unknown.

### `surface.open_port`

```json
// → With explicit port
{"method":"surface.open_port","params":{"surface_id":"surface:2","port":3000}}

// → Without (resolves from metadata)
{"method":"surface.open_port","params":{"surface_id":"surface:2"}}
```

Calls `Utils.openExternal("http://localhost:<port>")`. Throws if no listening port, multiple ports (errors lists them), or metadata not ready.

### `surface.kill_port`

```json
{"method":"surface.kill_port","params":{"port":3000,"signal":"SIGTERM"}}
```

Resolves pid from metadata, calls `process.kill(pid, signal)`. Default signal is SIGTERM. Signal names accept `SIGTERM` or `TERM` forms.

### `surface.kill_pid`

```json
{"method":"surface.kill_pid","params":{"pid":12346,"signal":"SIGKILL"}}
```

Kills any pid directly; the webview Process Manager uses this via the `killPid` webview→bun RPC message.

---

## 7. Extending

### Adding a new metadata field

1. Extend `ProcessNode` or `SurfaceMetadata` in `src/shared/types.ts`.
2. Update `parsePs` / `walkTree` to populate it (or add a new subprocess + parser).
3. Update the `metadataEqual` diff.
4. Update `findForegroundPid` only if the new field changes the fg heuristic (it usually won't).
5. Update tests under `tests/surface-metadata.test.ts` — fixture + assertions.
6. Consumers (pane chips, sidebar, process manager, web mirror) opt in — they all read `SurfaceMetadata` by property, so no breakage, just newly-available data.

Example: adding `nice` (priority).

```diff
# ps args
- ["ps", "-axo", "pid,ppid,pgid,stat,%cpu,rss,args", "-ww"]
+ ["ps", "-axo", "pid,ppid,pgid,stat,%cpu,rss,nice,args", "-ww"]

# regex (extra numeric col before args)
- /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([\d.,]+)\s+(\d+)\s+(.*)$/
+ /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([\d.,]+)\s+(\d+)\s+(-?\d+)\s+(.*)$/
```

### Adding a new renderer

All renderers receive the full `SurfaceMetadata` on every change. The only wiring you need is a handler in the appropriate surface:

- **Webview renderer.** Call `surfaceManager.setSurfaceMetadata` (already wired in `src/views/terminal/index.ts`) and listen via your own CustomEvent or by extending `SurfaceManager`. Avoid re-entering RPC.
- **Web mirror.** Add a `case "surfaceMetadata":` arm in `buildHtmlPage`'s WebSocket handler.
- **External script.** Read from the Unix socket:

  ```bash
  printf '{"id":"x","method":"surface.metadata","params":{}}\n' \
    | nc -U /tmp/hyperterm.sock
  ```

  or via the `ht` CLI → `ht metadata --json`.

---

## 8. Performance characteristics

Measured on an Apple Silicon MacBook Pro with ~900 processes in `ps -axo`, 4 active shells, 2 dev servers listening:

| Step | Cold | Warm |
|------|------|------|
| `ps -axo …` spawn + read + parse | ~18 ms | ~12 ms |
| `lsof -iTCP` combined (pid list = 22) | ~85 ms | ~60 ms |
| `lsof -d cwd` combined (pid list = 4) | ~20 ms | ~15 ms |
| Diff + emit | < 1 ms | < 1 ms |
| Webview render (chips + sidebar) | ~2 ms | ~1 ms |
| **Total tick** | ~125 ms | ~90 ms |

At 1 Hz that's ~0.1 CPU-seconds per wall-second used by metadata — well under a single core's capacity. When the window is hidden, the rate drops to ~3.3 s, so idle background cost is negligible. Most of the wall time is `lsof`; if we ever need more headroom, swapping to `netstat -anv` or `launchctl list` for port discovery would cut ~70 ms.

---

## 9. Troubleshooting

### Empty chips / `"waiting for metadata…"`

- Usual cause: the first tick hasn't fired yet (up to ~1 s after app start).
- If persistent: check bun logs. `console.error("[metadata] tick failed:", err)` is the sentinel.
- Locale bug: `ps` may emit `0,4` instead of `0.4` for CPU on non-English systems. The parser tolerates both *and* the subprocess runs with `LC_ALL=C`, but if you're piping a canned fixture in tests, remember either separator is valid.

### `Error: no metadata yet — try again in a second`

From `ht open` / `ht kill` when the cached snapshot is still `null`. Wait a tick and retry, or pass `--surface` explicitly if the default resolver is hitting a surface that hasn't been polled yet.

### Ports appear / disappear flickery

If a dev server rapidly opens and closes a probe socket (common for hot-reload handshakes), the chip will blink. That's accurate behavior, not a bug. You can reduce sensitivity by increasing the poll interval (`poller.setPollRate(2000)`).

### CPU column shows 0.0 for something obviously busy

`ps`'s `%cpu` is an instantaneous snapshot since the process started (on macOS) or since the last `ps` invocation (on Linux). For short-lived or newly spawned children, a few ticks of warm-up are expected before the number settles. If you need per-interval CPU, this data pipeline isn't the right primitive — run `top -l 1` or `ps -p <pid> -o %cpu` yourself with explicit sampling.

### Process Manager shows ghost zombie rows

They shouldn't — `walkTree` explicitly filters `stat` containing `Z`. If you see one, please file a bug with the raw `ps` fixture; it's likely a stat-column format we haven't seen.

### `lsof: command not found`

Rare, but possible on minimal containers. The poller handles this gracefully (subprocess failure returns an empty map, metadata snapshots without ports / cwds). Install lsof (`brew install lsof` / `apt install lsof`) to recover.

### Why not just use `/proc`?

macOS doesn't have `/proc`. Linux does, but `lsof` is faster at scanning listening sockets than parsing `/proc/net/tcp` + `/proc/<pid>/fd`, and it gives us uniform behavior across macOS and Linux. If a future platform requires `/proc`-based implementation, swap out just the `runPs` / `runListeningPorts` / `runCwds` functions — the rest of the pipeline is platform-agnostic.

---

## 10. Files

- `src/bun/surface-metadata.ts` — poller, parsers, diff
- `src/bun/rpc-handler.ts` — `surface.metadata`, `surface.open_port`, `surface.kill_port`, `surface.kill_pid`
- `src/bun/index.ts` — wiring (construct poller, forward emissions to RPC + web mirror, handle `killPid` + `openExternal` + `windowVisibility` RPC from webview)
- `src/shared/types.ts` — `ProcessNode`, `ListeningPort`, `SurfaceMetadata`, RPC message shapes
- `src/views/terminal/surface-manager.ts` — pane chips + sidebar aggregation
- `src/views/terminal/process-manager.ts` — `⌘⌥P` overlay
- `src/views/terminal/sidebar.ts` — workspace port chips + fg command
- `src/bun/web-server.ts` — web-mirror chip parity
- `bin/ht` — CLI commands (`metadata`, `cwd`, `ps`, `ports`, `open`, `kill`)
- `tests/surface-metadata.test.ts` — parser + tree + fg detection + diff tests
