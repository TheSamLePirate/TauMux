# Tracking — execution of `doc/full_analysis.md` action list

**Started:** 2026-04-28
**Source plan:** `doc/full_analysis.md` § Prioritized action list + Updated prioritized action list (addendum)
**Working tree at start:** branch `main`, on top of `169b719`. Several pre-existing uncommitted edits exist in `bin/ht`, `README.md`, multiple docs, and three RPC handlers — these are separate in-flight work and are **not** touched by this execution unless explicitly noted.

## Convention

Each step gets a heading with:
- **What** — the change
- **Files** — touched files with line refs
- **Verification** — the commands run and their result
- **Commit** — short SHA + message
- **Deviations / issues** — any place the plan needed to bend

Per `CLAUDE.md`, every functional commit is preceded by `bun run bump:patch` so the version reflects the change. Pure tracking-doc commits skip the bump and note why.

---

## Steps

### Step 1 — B4 + B5: socket collision (probe-before-unlink)

**What:** `SocketServer.start()` no longer blindly unlinks the socket inode. It first calls `existsSync` and, if a path exists, opens a 250 ms `Bun.connect` probe; if a peer answers, the new server refuses to bind and prints a clear remediation message ("Set `HT_CONFIG_DIR` or `HT_SOCKET_PATH` to a different path, e.g. `HT_CONFIG_DIR=/tmp/tau-mux-dev bun run dev`"). On stale paths the probe falls through and the inode is unlinked as before. `start()` is now `async`; a new `isBound()` getter lets the bootstrap code in `index.ts` flip the `socket` health row to `error` when the bind didn't take.

**Files:**
- `src/bun/socket-server.ts` — full rewrite of `start()`; added `bound` field, `isBound()` getter, `isPeerLive()` private probe.
- `src/bun/index.ts:2640` — `await socketServer.start();` and conditional health update.
- `tests/socket-server.test.ts` — `await server.start()` everywhere; new tests `refuses to overwrite a live peer` and `reclaims a stale socket path when no peer is alive`.

**Verification:**
- `bun run typecheck` — clean (top-level `await` already in use elsewhere in `index.ts`).
- `bun test tests/socket-server.test.ts` — 9 / 9 pass; the live-peer test demonstrates the refusal path explicitly.
- `bun test tests/` — 1501 / 1501 pass (was 1499; +2 for the new probe tests).

**Deviations / issues:**
- **Did not auto-pick a separate `configDir` for dev mode** (the original B4 second-half suggestion). Auto-detection of "am I running under `electrobun dev`?" is brittle (no canonical env signal across packaged/source/CI), and the probe-based refusal already prevents the silent data loss. Users get an explicit error pointing at the env-var override, which is more honest than magic. Listed as a deferred design choice.
- ESLint `no-require-imports` fired during the new test edit (forbade `require("fs")`); fixed by adding `writeFileSync` to the existing top-of-file `import { ... } from "fs"`. Unrelated to the bug fix.

**Commit:** filled in below after `bun run bump:patch`.
