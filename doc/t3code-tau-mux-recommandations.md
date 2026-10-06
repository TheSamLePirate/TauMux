# t3code → τ-mux: what's worth adopting

**Date:** 2026-08-23 · **Analyzed:** `../t3code` @ `e11fb6e77` (~110k LOC TS, 109 test files, 1,075 commits, very active Feb–Mar 2026) · **Method:** deep parallel read of t3code's orchestration, checkpointing, provider, transport, testing/release, and web-UI layers, cross-checked against τ-mux v0.23.x current state (verified in source, not assumed).

t3code is T3's web/desktop GUI for coding agents (Codex-first, Claude via the Agent SDK): a Node WebSocket server wrapping provider runtimes, an event-sourced orchestration core on SQLite (Effect-TS), git checkpointing per agent turn, a React web app, and an Electron shell. It is a *harness of harnesses* like τ-mux, but organized around **threads + durable state + git**, where τ-mux is organized around **panes + live PTYs + overlays**. The two projects are complementary more than competing — and several of t3code's best ideas port cleanly to Bun/vanilla-TS.

---

## 0. Executive summary

| # | Recommendation | Value | Effort | Tier |
|---|---|---|---|---|
| R1 | **Per-turn git checkpoints + turn diffs + revert** | ★★★★★ | Medium (~200-400 lines core) | 1 |
| R2 | **Claude pane session continuity across restarts** | ★★★★★ | Small | 1 |
| R3 | **Web-mirror transport hardening** (validation, gap-resync, readiness) | ★★★★ | Small–Medium | 1 |
| R4 | **User-configurable keybindings** (`keybindings.json` + `when` expressions) | ★★★★ | Small–Medium | 1 |
| R5 | **Deterministic tests**: `drain()`, receipts, shared `waitFor` — kill the 91 sleeps | ★★★★ | Medium (incremental) | 1 |
| R6 | Diff rendering in Claude-pane tool cards + transcript DOM cap | ★★★★ | Small | 2 |
| R7 | "Add to chat": terminal selection → agent context block | ★★★★ | Small | 2 |
| R8 | Worktree-per-agent-session | ★★★★ | Medium | 2 |
| R9 | Canonical agent-event vocabulary + scripted fake adapter | ★★★ | Medium | 2 |
| R10 | Release engineering: signing, auto-update, release-smoke CI, dev isolation | ★★★★ | Medium | 2 |
| R11 | Project scripts (persisted per-cwd commands, keybindable, typed into PTY) | ★★★ | Small | 2 |
| R12 | SQLite state store + event-log-lite (receipts, caps) — *selectively* | ★★ | Medium | 3 |
| R13 | UI polish inventory (status ladder, multi-select, approval-in-composer…) | ★★ | Small each | 3 |
| R14 | Tooling: oxlint/oxfmt, strict tsconfig flags, mise pin, CI output asserts | ★★ | Small | 3 |

Where τ-mux is **already ahead** (don't regress, don't import t3code's weaker versions): web-mirror resume is true delta replay with a bounded ring (t3code re-fetches full snapshots and its `replayEvents` API is dead code); auth uses timing-safe compare + origin checks + rate limiting (t3code's is `!==` on a query param and its browser client can't even send the token); backpressure/coalescing/rate-limiting on the mirror; Telegram fan-out for approvals and asks; auto-continue; process metadata via FFI; cost/context meters in the Claude pane (t3code normalizes token usage server-side then **never displays it**); notification sounds and persistence; the docs-coverage CI gate (t3code has nothing comparable — its own docs drift, e.g. `T3CODE_STATE_DIR` vs the real `T3CODE_HOME`).

---

## 1. Tier 1 — adopt now

### R1. Per-turn git checkpoints, turn diffs, and revert ⭐ flagship

**What t3code does.** Every agent turn snapshots the workspace as an **orphan commit under a hidden ref** — `refs/t3/checkpoints/<base64url(threadId)>/turn/<N>` — captured with pure plumbing in a **temp index** so the user's history, branches, index, and stash are never touched:

```
GIT_INDEX_FILE=<tmp> git read-tree HEAD     # seed from HEAD (handles unborn HEAD)
GIT_INDEX_FILE=<tmp> git add -A -- .        # captures dirty + untracked (respects .gitignore)
git write-tree → git commit-tree <tree> -m "checkpoint"   # orphan commit, no hooks
git update-ref refs/t3/checkpoints/.../turn/N <commit>
```

(`apps/server/src/checkpointing/Layers/CheckpointStore.ts:89-176`, `Utils.ts:4-10`.) Turn 0 is the baseline; `turn/N` doubles as "end of turn N" and "start of turn N+1". `diff(N-1, N)` = that turn's work; `diff(0, N)` = the whole session. Diffs come from `git diff --patch --minimal <from> <to>`, parsed by `@pierre/diffs` into per-file +/− counts pushed with the summary, with the full patch fetched on demand. Revert = `git restore --source <oid> --worktree --staged -- . && git clean -fd -- . && git reset -- .`, then conversation rollback and deletion of refs above the target.

**What this buys τ-mux.** The single biggest UX gap between τ-mux and every serious agent harness: *"what did the agent change this turn, and can I undo it?"* — per-turn changed-files chips in the Claude pane, a diff view, and one-click revert-to-before-this-prompt. It also unlocks safe auto-continue (auto-approve becomes far less scary when every turn is undoable).

**Integration points in τ-mux.**
- Turn boundaries: for terminal `claude` sessions, the ht-bridge already receives `UserPromptSubmit` / `Stop` hooks — capture on both. For the native Claude pane, `claude-agent-manager` sees the SDK stream directly (user message = turn start, `result` = turn end). This is *simpler and more reliable* than t3code's setup — their `CheckpointReactor.ts:707-711` admits runtime `turn.completed` events don't reliably arrive and they need belt-and-braces duplicate paths.
- Storage key: session id (Claude session or pane surface id) instead of threadId; keep a monotonic per-session turn counter; guard capture-once-per-turn (idempotency matters — t3code needed it too).
- Surfacing: changed-files summary as a tool-card footer / pane chip; diff panel (see R6); `ht checkpoint list|diff|revert` in the CLI; Telegram "revert last turn?" is a natural extension of the existing approval fan-out.

**Fixes to make in the port** (t3code bugs/limits found in the analysis — don't copy them):
1. **Capture is O(entire worktree)**: seeding a fresh temp index via `read-tree HEAD` zeroes the stat cache, so `add -A` re-hashes every tracked file each turn. Instead `cp .git/index <tmp>` (inherit the stat cache) or keep a persistent side-index per session. Mandatory for monorepos.
2. **Repo detection**: t3code uses `existsSync(cwd + "/.git")`, which fails in any *subdirectory* of a repo — the common case for a terminal. Use `git rev-parse --show-toplevel` and snapshot from the toplevel.
3. **Non-git dirs**: t3code silently disables the feature. τ-mux can do better with a shadow repo: `git --git-dir=~/.tau-mux/shadow/<hash> --work-tree=<cwd>` gives the same machinery in unversioned directories — arguably the highest-value divergence available.
4. **Diff hardening**: add `--no-ext-diff --no-textconv --binary --find-renames -c core.quotepath=false` (t3code omits all of these; a user `diff.external` breaks their parser silently), and don't hard-fail on big output (t3code caps subprocess stdout at 1 MB and *errors*, so lockfile churn kills the diff — stream to a file, gate on `--numstat` first).
5. **Env hygiene**: explicitly unset `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` from the inherited env (very plausible inside a terminal multiplexer) and set `GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 LC_ALL=C` (matches τ-mux's existing locale rule).
6. **Pre-revert safety snapshot**: capture a checkpoint *before* restoring so revert is itself undoable — closes t3code's biggest hole (their revert destroys any manual edit made after the last capture, unrecoverably, behind a single confirm dialog). Also refuse to revert while a turn is running or a user `git` process holds the index lock.
7. **Ref cleanup**: t3code never deletes `refs/t3/checkpoints/*` on thread delete — unbounded object growth. Sweep `refs/tau/…` when a session is closed and on startup.
8. Submodules (gitlink-only capture — warn on `.gitmodules`) and LFS (`GIT_LFS_SKIP_SMUDGE=1` on restore) are known holes; document them.

The core is ~4 shell-outs with zero framework dependency; `CheckpointStore.ts` + `Utils.ts` port almost verbatim to `Bun.spawn`. Metadata (turn refs, summaries) fits either a JSON sidecar or R12's SQLite store.

### R2. Claude pane session continuity across restarts

**Verified gap:** on layout restore, a `claude` pane remounts as a **fresh** session (`claudePaneHost.manager.create({})` in `src/bun/index.ts:3011`); the last session id is not in `PersistedLayout`, the transcript is DOM-only, and the user must manually re-pick from the Sessions dropdown. Meanwhile *everything needed already exists*: the SDK's on-disk sessions, `listSessions()`/`getSessionMessages()` (`src/bun/claude-pane-host.ts:153-176`), a working resume/fork UI, and `claude-sessions.json` persistence for hook-tracked metadata.

**Adopt t3code's model:** persist a per-surface resume cursor — `{sessionId, cwd, model, permissionMode, turnCount}` — written on session start and on every turn (t3code: `ProviderSessionDirectory`, sqlite-backed, updated in `ProviderService` on start/sendTurn/shutdown). On layout restore, auto-resume with the persisted cursor and replay the transcript via `getSessionMessages` (the resume path already renders replayed transcripts with a divider). Recovery should be **lazy** (on first use of the pane), as t3code does — not a boot-time storm of SDK processes.

Two t3code recovery bugs to *not* replicate: they lose the model on recovery (persisted but never read back) and they default a missing runtime mode to **full-access** — a silent permission escalation. Persist and restore both; default to the *safest* mode on ambiguity. Also persist sidebar logs while at it (`WebStateStore.logs` is memory-only today; notifications already persist), and switch `layout.json` to the atomic tmp+rename write every other τ-mux persister already uses (`src/bun/index.ts:2900` is a bare `writeFileSync`).

### R3. Web-mirror transport hardening

τ-mux's transport core (per-session monotonic seq, 2 MB resume ring, delta replay, auth, backpressure) is *better* than t3code's. What t3code demonstrates — partly by doing it, partly by the bugs it has from not doing it — is the boundary discipline:

1. **Two-stage decode: envelope first, then payload — always echo the id.** t3code validates the whole request in one pass; on failure it replies with `id: "unknown"`, the client's pending map misses, and the caller's promise hangs for the full 60 s timeout. Decode `{v, seq, type}` / `{id}` first so every error can be addressed to its request. τ-mux today does neither stage as *validation* — `handleClientMessage` (`src/bun/web/server.ts:1188`) is hand-rolled `typeof` checks with `as` casts, `isEnvelope` falls back to accepting bare v1-style objects, and `v` is never enforced.
2. **Per-message runtime validation with structured diagnostics.** One validator per message type (a discriminated union keyed on `type`), applied server-side on every inbound client message and client-side in `protocol-dispatcher.ts` (which currently casts `rawPayload as …` unchecked). No need for a schema library: ~30 small hand-rolled validator functions in `src/shared/web-protocol.ts` keep the zero-dep rule and give better errors than Effect's union messages (whose failures read as "expected the last union member"). Structure the diagnostic — `{stage: "json"|"envelope"|"payload", type?, seq?, issues: [{path, message}], rawPreview}` — keep a bounded ring of the last N, count drops per channel, and surface them in the sidebar log. Drop-and-continue, never kill the socket.
3. **Sequence-gap detection → targeted resync.** τ-mux is uniquely positioned here: the seq is already **per-session** (t3code's is process-global, making gaps undetectable by construction — their agent-verified welcome arrives as `sequence: 2`). But the client store currently only *drops* out-of-order frames (`src/web-client/store.ts:225-229`); a lost frame is silently absorbed until the next reconnect. Add: `seq > expected + 1` → proactively re-run the resume handshake (`?resume=<sid>&seq=<last>`), falling back to snapshot. ~20 lines; converts silent divergence into self-healing.
4. **Readiness barrier + welcome-before-enroll.** t3code's cleanest 36 lines (`wsServer/readiness.ts`): named one-shot latches (`httpListening`, `pushBusReady`, per-subsystem subscriptions), `await ready` inside the connection handler, and — the invariant worth copying verbatim — *send the welcome first and only add the socket to the broadcast set once the welcome is confirmed delivered*. In τ-mux, `webServer.start()` runs at boot before `tryRestoreLayout` (triggered later by the webview viewport handler), so an early client gets an empty snapshot. A `layoutRestored` latch + plain `Promise.all` fixes it. Unlike t3code, *do something* when welcome delivery fails (they leave the client connected-but-unenrolled forever).
5. **Secure-by-default posture.** Today: `webMirrorBind: "0.0.0.0"` + `webMirrorAuthToken: ""` defaults. Adopt the t3code desktop stance (per-launch random token on loopback): default bind to `127.0.0.1`, or auto-generate a token on first enable of the mirror. The enforcement machinery (timing-safe compare, throttle, origin check) already exists — only the defaults are soft.

### R4. User-configurable keybindings

**Verified gap:** τ-mux's `Binding` registry (`id`/`description`/`category`/`when`/`match`) was explicitly built for a remapper that was never built (`src/views/terminal/keyboard-shortcuts.ts:4-5`); bindings are hardcoded arrays, nothing is persisted, no settings field exists.

t3code's system is replication-grade and its parser is ~130 lines of dependency-free plain TS (`apps/server/src/keybindings.ts:86-282`), directly copy-pasteable:

- `keybindings.json` under the config dir: JSON array of `{key, command, when?}`; atomic tmp+rename writes; capped rule count.
- Key syntax `mod+shift+p` (`mod` = ⌘/Ctrl resolved at *evaluation* time, preserved as its own flag), aliases (`esc`, `space`), exactly one non-modifier token.
- `when` is parsed by a real recursive-descent parser (`!`, `&&`, `||`, parens, precedence, depth caps) into a **serializable AST**; the evaluator is 12 lines over a `{[contextKey]: boolean}` object; unknown identifiers → `false`. τ-mux contexts fall out of existing state: `paletteOpen`, `claudePaneFocused`, `editorFocused`, `terminalFocus`…
- **Last matching rule wins**; user rules are merged *after* retained defaults; a default is dropped if the user's file already binds that command.
- Two load paths: a *writable* load (drops invalid entries, never rewrites a bad entry to disk) and a *runtime* load returning `{keybindings, issues}` with **per-entry, index-attributed issues** surfaced in the UI — the diagnostics UX to pair with R3's.
- File-watch → reload → broadcast; commands can be an extensible validated namespace (their `script.<id>.run` template-literal schema — pairs with R11, and with τ-mux's palette command ids which already exist as stable strings).

In τ-mux this is *simpler* than in t3code (no server/client split for the native webview — parse and evaluate in one process; the web mirror can receive the resolved rules over the existing settings push). The cheat-sheet and palette already enumerate the same arrays, so remapped keys show up everywhere for free. Add an `AppSettings` pointer or keep the separate JSON file (separate file matches t3code and keeps `settings.json` clean); either way document it in website-doc (EN+FR) per the coverage gate.

### R5. Deterministic tests — kill the 91 sleeps

**Verified state:** τ-mux has the right *ideal* — injectable seams everywhere (`runTickForTest`, `AskUserQueue` timer injection, `queryFn` replay, pure `decideBackpressure`) — applied unevenly: **91 sleep-based waits across 32 unit-test files**, a single per-file `waitFor` that *swallows* timeouts (`tests/web-server.test.ts:8-17`), and a fixed port 18923 that serializes web-server tests.

Adopt t3code's three primitives (all framework-agnostic; ~150 lines total):

1. **`DrainableWorker` with `drain()`** (`packages/shared/src/DrainableWorker.ts`, ~100 lines): a queue worker whose `drain()` resolves when the queue is empty *and* the in-flight item finished. The non-negotiable detail: the outstanding counter is bumped **in the enqueue path, before the offer**, so work enqueued mid-drain is captured (no false-idle window). Wrap τ-mux's async pipelines (web push fan-out, telegram send queue, sideband processing) in it and tests do `await worker.drain()` instead of `Bun.sleep(50)`. t3code's three reactors expose `drain` on their service interface — production code, not a test hook, which is why it's trustworthy.
2. **Typed receipts instead of polling**: when an async milestone completes (snapshot captured, telegram message committed, checkpoint diff finalized), publish `{type, ...identifyingKeys, at}` on a tiny bus. Tests (and features) `await nextReceipt(r => r.type === "x" && r.paneId === id)` — accumulate history into the subscriber first so a receipt that fired before the test looked still matches (t3code's harness does exactly this to avoid lost-wakeup races). Include a bare "quiesced" receipt for "everything settled". (Note: t3code built this bus and then barely used it — wire consumers from day one or don't build it.)
3. **One shared `tests/helpers/wait.ts` that throws a *named* timeout** — t3code's `waitFor` converts a hang into `WaitForTimeoutError("timed out waiting for projected thread 'x'")` instead of a confusing downstream assertion. τ-mux's native-e2e helper already exists (`tests-e2e-native/helpers/wait.ts`); promote the pattern to unit tests and make it throw.

Plus: ephemeral ports (`Bun.serve({port: 0})` and read the assigned port) so web-server tests parallelize — or R10's hashed port offsets for the dev instance problem.

Two more t3code testing patterns worth stealing when R9 lands: the **scripted fake provider adapter** (turns are *pre-scripted per test* and `sendTurn` hard-fails if no script is queued — under-specified tests fail loudly; interactions are recorded for assertion, no mocking library), and **pure-reducer extraction for shell-process logic** (their Electron updater/main logic is pure functions tested with zero Electron in the loop — directly applicable to Electrobun main-process code).

---

## 2. Tier 2 — plan for

### R6. Diff rendering in Claude-pane tool cards + transcript DOM cap

Two verified gaps in `claude-agent-pane.ts`: **(a)** Edit/Write tool cards show only the file path — `old_string`/`new_string` are in the payload and never rendered, and `highlightDiff` (which exists, used once in the pi panel) isn't even imported; **(b)** the transcript is unbounded DOM — every message is a permanent node, no pruning, no virtualization. t3code's timeline is fully virtualized with one deliberate twist worth copying if τ-mux ever virtualizes: **never virtualize the active turn** (the last N rows plus the whole in-flight turn stay real DOM so streaming never fights measurement).

Pragmatic τ-mux steps: (1) render Edit cards as old/new with `highlightDiff` or a small line-LCS unified diff — zero new deps; (2) cap the transcript at ~300 message nodes with a "show earlier" expander (matches the existing 4000-char tool-output cap philosophy); (3) when R1 lands, add the per-turn changed-files card + a diff view (the editor pane + a unified-diff CodeMirror mode, or a dedicated panel; `@pierre/diffs` is an option but violates the minimal-deps rule — a hand-rolled renderer over `git diff` output is in keeping).

### R7. "Add to chat" — terminal selection → agent context

t3code's standout interaction: select text in a terminal → context menu → the selection (with source label and line range) becomes a chip in the composer, serialized as a `<terminal_context>` block in the prompt. In τ-mux: select in any xterm pane → "Send to Claude pane" → chip in the Claude pane composer (rendered back as a hoverable chip in the sent message, not a wall of pasted output). Small, no server dependency, and it's the bridge τ-mux's hybrid model is *made* for — PTY panes and agent panes already live side by side. Same mechanism extends to `ht send-context` from the CLI.

### R8. Worktree-per-agent-session

`git worktree add [-b <branch>] <path> <base>` under `~/Library/Application Support/hyperterm-canvas/worktrees/<repo>/<branch>`, temp branch `tau/<8hex>` renamed after the first turn (t3code LLM-generates the real name — τ-mux can ask the session itself, or skip renaming). τ-mux verified: **zero** occurrences of `worktree` in src/. The payoff is running two+ agent sessions against the same repo without them trampling each other — increasingly the normal workflow, and it composes with R1 (checkpoint refs resolve through the shared common dir, so worktree checkpoints are visible repo-wide).

Do better than t3code on lifecycle: they never delete the branch, never clean checkpoint refs on thread delete, and cleanup is client-driven best-effort (leaks on failure). Track worktrees in the session state, sweep orphans on startup, and hard-error early when the branch is already checked out elsewhere (git will refuse anyway — surface it properly). UI: a "new Claude pane in worktree" variant + a worktree chip in the pane header (the metadata poller already reports per-pane git info; teach it worktree awareness).

### R9. Canonical agent-event vocabulary + scripted fake adapter (adapter-lite)

t3code's `ProviderAdapterShape` is proven by three implementations — Codex (JSON-RPC translator), Claude SDK (semantics reconstructor), and a **test fixture** — and everything above the adapter (~4,000 lines of orchestration) is provider-blind. The full framework is overkill for τ-mux (two providers, pi's protocol is upstream-fixed, and τ-mux's higher layers — plan panel, ask-user, auto-continue — are *already* provider-agnostic services). Adopt the two ideas that carry the value:

1. **A canonical event envelope with provenance**: every agent event carries canonical ids *plus* `providerRefs` (native turn/item ids) *plus* `raw` (source-tagged original payload). Consequences t3code demonstrates: debugging never requires reading adapter code, one log reader works for all providers, and downstream code can opportunistically read native fields. τ-mux's `ClaudeTranscriptOp` union is halfway there — extend it to a shared `AgentEvent` that both `claude-agent-manager` and `pi-agent-manager` emit, and the pi panel / Claude pane / web mirror / sidebar converge on one vocabulary. This is also the prerequisite for mirroring agent panes to the web client (verified gap: the mirror covers only `term`/`telegram` today).
2. **A scripted fake agent** implementing that vocabulary, injected where `queryFn` already is: pre-scripted turns, hard-fail on unscripted `sendTurn`, recorded interactions, a `mutateWorkspace` hook so R1's checkpoint tests exercise real git. This makes the full pipeline (manager → plan mirror → approvals → checkpoints → mirror) integration-testable with zero SDK processes.

Cautionary tales from their adapters worth noting in ours: classification by substring on tool names drifts; interrupt detection by string-matching error text is fragile — prefer explicit state (τ-mux controls its managers, so it can do this properly); and unrecognized provider events should emit a visible warning, not silently vanish (t3code's Codex path drops them; their Claude path warns — copy the latter).

### R10. Release engineering

Verified τ-mux state: tag-triggered release with artifacts, but **no signing/notarization** (Gatekeeper friction on every install), **no auto-update** (Electrobun's updater is simply not configured — no `bucketUrl`/artifacts block in `electrobun.config.ts`), fixed dev ports, no dev/prod state isolation. From t3code, in value order:

1. **Signing + notarization, secret-gated**: CI auto-detects credential presence (`has_all()` on secrets) — with secrets it signs/notarizes, without them it still ships working unsigned artifacts. Fork PRs and local builds never break. The pattern is packager-agnostic; only the codesign/notarytool invocations are new work.
2. **Configure Electrobun's built-in updater** + a conservative update policy lifted from their pure state machine: no auto-download, no install-on-quit without consent, explicit "why auto-update is unavailable here" derivation (dev build / unpackaged / platform). Their reducer-style `updateMachine.ts` + 30 Electron-free tests is the shape to copy.
3. **`release-smoke.ts` run on every PR**: exercise the version bumper, manifest generation, and update-manifest merging in a temp dir — *release-only code paths tested on ordinary PRs*. τ-mux already has `bump-version.ts` and `version-consistency.test.ts`; extend to the packaging scripts. Add their 57-line spawn-the-app-and-grep-for-`Cannot find module` smoke test — it catches the #1 packaging failure class for pennies.
4. **Dev-instance isolation**: hashed port offset from `TAU_DEV_INSTANCE` (offset applied to web-mirror + RPC socket path together, probe upward from the hash for a free pair) and a `dev/` vs `userdata/` split under the config dir derived in *one* place — running a dev build no longer risks the daily-driver's `layout.json`/`settings.json`. Both are small, both pay daily.

### R11. Project scripts

Per-cwd persisted commands `{id, name, command, icon}` that **run by typing into the PTY** (visible, interruptible, in the real shell env — exactly τ-mux's philosophy, and trivially implementable with the existing surface/send machinery) with `TAU_PROJECT_ROOT` injected. Keybindable via R4's `script.<id>.run` validated namespace; surfaced in the palette and as pane-bar chips; `runOnWorktreeCreate` composes with R8 (auto-`bun install` in a fresh worktree). t3code remembers the last-run script as the primary button — nice touch.

---

## 3. Tier 3 — selective ideas

### R12. SQLite state store + event-log-lite — *selectively*

t3code's full event-sourcing core (single-writer command queue → pure decider → append-only `orchestration_events` with `AUTOINCREMENT` as the global sequence → projections with per-projector cursors → command receipts for idempotency) is genuinely well-built, and the portable essence is ~400 lines of vanilla TS on `bun:sqlite`. But **τ-mux should not adopt it wholesale** — its state is mostly ephemeral-by-design (PTY is the source of truth) and the costs are real: t3code maintains the same projection logic **twice** (in-memory + SQL, ~1,900 near-duplicated lines, drift-bug class included), replays the full log on every boot with no snapshots, and its idempotency table is defeated by random command ids. Take the pieces:

- One `state.sqlite` (WAL, statically-imported ordered migrations, migrate-at-open so an unmigrated handle is unrepresentable) replacing the growing family of JSON files *as they next need schema changes* — telegram.db already proves the pattern.
- **Command receipts** for RPC-driven mutations that can be retried over a flaky socket (`command_id PK → result, status`): the web mirror and `ht` CLI both benefit. Deterministic ids or it's theater.
- An **append-only session-history table** for R1/R2 (turns, checkpoint refs, summaries) — an event log for the one domain that's genuinely historical.
- The hygiene rules regardless of storage: bounded in-memory collections (`.slice(-N)` caps), unknown record types are a no-op not a throw, explicit ordering tiebreakers (never insertion order), uniqueness invariants pushed into the schema.

### R13. UI polish inventory (cheap, independent)

- **Status-pill priority ladder** with strict ordering (PendingApproval > AwaitingInput > Working > PlanReady > Completed) and a **rolled-up dot** per workspace = max across panes — τ-mux's sidebar has pills; the explicit priority fold is the idea.
- **Approval takes over the composer** (banner + Approve once / Always allow this session / Decline / Cancel turn replacing the toolbar) — the answer is where your hands are. τ-mux's inline `perm` row + modal could adopt the in-place variant for the native pane; "always allow this session" is the missing option (verified: every prompt is one-shot today; the SDK's `updatedPermissions` suggestions path is how t3code's Claude adapter implements it properly — a real permission-rule update, not a rubber stamp).
- **Numbered-key wizard** for multi-question asks (1-9 select + auto-advance) — τ-mux's AskUserModal handles choices; the number-key ergonomics port in an afternoon.
- **Multi-select thread/pane rows** (Cmd-click, Shift-range, bulk close/mark-read) in the sidebar.
- **@-mention file search** in the Claude pane composer (debounced workspace file search → path chip) — the file explorer already walks the tree.
- **Adjacent tool-call collapsing** in transcripts (collapse-key = toolType ⊕ label; "Tool calls (n)" group showing the last 6) — directly applicable to long Claude-pane sessions.
- Editor deep-links everywhere one helper: file paths in markdown, tool cards, and terminal output (τ-mux has terminal link detection; unify with pane/editor opening).

### R14. Tooling

- **oxlint + oxfmt**: 22 + 12 lines of config in t3code, Rust-speed, no plugin dependency tree. Strict upgrade for a single-package Bun repo at near-zero adoption cost.
- **tsconfig strictness**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` — the three non-default flags where real safety lives (adopt incrementally; the first one will surface real issues in parser code).
- **`.mise.toml` + `engines`** as the single toolchain pin, CI reading versions from `package.json` (`bun-version-file`) so local and CI can't skew.
- **CI assertions on build output**: after build, `test -f` + `grep` for symbols the bundler must not tree-shake (their preload-bridge check) — cheap insurance for the Electrobun bundle and the injected `ht` CLI.
- **`.docs/encyclopedia.md`**: a living glossary mapping project vocabulary → defining file. τ-mux's doc/ is deep but has no term-level index; cheap and high-leverage for agent-assisted development (both projects are built *by* agents — the glossary is prompt-context gold).

---

## 4. What NOT to copy

- **Effect-TS / React / the framework layer.** The ideas above all port to vanilla TS; the frameworks themselves contradict τ-mux's constraints and would be regressions for its goals.
- **Dual read models** (in-memory fold + SQL projections of the same events): t3code's single biggest self-inflicted cost. Pick one representation per domain.
- **Global push-sequence counter**: makes client gap detection impossible by construction. τ-mux's per-session seq is the correct design — keep it.
- **Unvalidated RPC responses**: t3code validates pushes both ways but leaves RPC `result` as `unknown` with dead schemas written and never wired. If adding validation (R3), do both directions from day one — retrofitting response validation never happens.
- **Their auth model** (query-param token, `!==` compare, HTTP routes unprotected, and a browser client that can't even send the token, making the documented remote-access flow broken). τ-mux's is already better; only the *defaults* need tightening (R3.5).
- **No approval timeout** anywhere in t3code (an approval blocks forever) — τ-mux's 570 s ask timeout with fail-safe defaults is the right call; keep it.
- **Speculative API surface**: t3code is littered with built-then-unused machinery (`replayEvents` end-to-end with zero call sites, `replayLatest`, the receipt bus with no subscribers, `resumeSessionAt` captured and never used). Build R5's receipts *with* their consumers or not at all.
- **Silent event dropping, substring-based tool classification, string-matched error/interrupt detection** — all identified drift bugs in their adapters; τ-mux controls its managers and can use explicit state instead.
- **LLM-generated branch names / thread titles as a launch feature**: t3code's thread titles are a 50-char truncation and nobody died. Ship the mechanism first; garnish later.

---

## 5. Suggested sequencing

1. **M1 — Foundations for undo** (R1 core + R6a): checkpoint capture/diff/revert engine behind the existing turn signals; Edit-card diffs; changed-files summary chip. No new UI surface beyond cards.
2. **M2 — Continuity** (R2 + quick wins): persisted resume cursors, auto-resume on layout restore, transcript replay; atomic layout.json; persisted sidebar logs.
3. **M3 — Trust the wire** (R3): two-stage decode + validators + structured diagnostics; gap-resync; readiness latch; loopback/token defaults.
4. **M4 — Make it yours** (R4 + R11): keybindings.json + `when` engine; project scripts riding the same command namespace.
5. **M5 — Test debt** (R5 + R9b): DrainableWorker + shared waitFor across the worst 5 files (web-server, telegram-service, web-resume); scripted fake agent; ephemeral ports.
6. **M6 — Parallel agents** (R8 + R9a): worktree sessions; canonical AgentEvent + agent panes on the web mirror.
7. **M7 — Ship like grown-ups** (R10): signing/notarization, Electrobun updater, release-smoke, dev isolation.

Each milestone is independently shippable; R1 is the one with compounding returns (R6, R8, R13, and safe auto-continue all stack on it).

---

## Appendix — t3code source map (for implementation reference)

| Topic | Read these |
|---|---|
| Checkpoint capture/restore/diff | `apps/server/src/checkpointing/Layers/CheckpointStore.ts`, `checkpointing/Utils.ts`, `checkpointing/Diffs.ts`, `orchestration/Layers/CheckpointReactor.ts` |
| Worktrees | `apps/server/src/git/Layers/GitCore.ts:1327-1418`, `git/Layers/GitManager.ts:844-968`, `apps/web/src/worktreeCleanup.ts` |
| Drain/receipts | `packages/shared/src/DrainableWorker.ts`, `orchestration/Services/RuntimeReceiptBus.ts`, `integration/OrchestrationEngineHarness.integration.ts` |
| Fake provider | `apps/server/integration/TestProviderAdapter.integration.ts` |
| Event store / receipts / cursors | `orchestration/Layers/OrchestrationEngine.ts`, `persistence/Migrations/001+002+005`, `orchestration/Layers/ProjectionPipeline.ts:1160-1204` |
| Adapter contract + Claude SDK usage | `provider/Services/ProviderAdapter.ts`, `provider/Layers/ClaudeAdapter.ts`, `packages/contracts/src/providerRuntime.ts` (esp. `providerRefs`/`raw` at :28-44) |
| Session directory / resume | `provider/Layers/ProviderSessionDirectory.ts`, `provider/Layers/ProviderService.ts:208-296` |
| Readiness / push bus | `apps/server/src/wsServer/readiness.ts`, `wsServer/pushBus.ts`, `wsServer.ts:956-975` |
| Keybindings | `apps/server/src/keybindings.ts` (parser :86-282, merge :453-470, watch :802-830), `packages/contracts/src/keybindings.ts`, `apps/web/src/keybindings.ts:71-118` |
| Terminal drawer / add-to-chat | `apps/web/src/components/ThreadTerminalDrawer.tsx`, `lib/terminalContext.ts`, `terminal-links.ts` |
| Timeline derivation / collapsing / virtualization | `apps/web/src/session-logic.ts`, `components/chat/MessagesTimeline.tsx`, `components/timelineHeight.ts` |
| Release / CI | `.github/workflows/release.yml` (secret gating :155-190), `scripts/release-smoke.ts`, `scripts/build-desktop-artifact.ts`, `apps/desktop/scripts/smoke-test.mjs`, `apps/desktop/src/updateMachine.ts` |
| Dev experience | `scripts/dev-runner.ts` (port offsets :77-102, :226-333), `apps/server/src/config.ts:49-70` (dev/userdata split) |
