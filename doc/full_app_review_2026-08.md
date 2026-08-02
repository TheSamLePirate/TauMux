# τ-mux — Application Audit (2026-08)

**Date:** 2026-08-02
**Version reviewed:** 0.4.11 (`cfaa406e`)
**Baseline:** `bun run typecheck` clean · `bun test` **3136 pass / 0 fail** (260 files) · `bun run lint` 0 errors / 2 warnings
**Scope:** whole repo, weighted toward code added since the previous review (`doc/full_app_review_2026-05.md`, v0.3.160) — the extension-app platform (v0.4.0–0.4.7), the libSystem FFI poller (v0.4.8), and the GPU renderer + stdout coalescer (v0.4.9–0.4.11).
**Method:** direct source reading with every claim verified at `file:line`. Findings the previous review already closed are not repeated; §6 records what was re-verified as fixed.

---

## 1. Executive summary

The engineering discipline established in the last review has held. The release pipeline now has a `verify` gate, eslint is wired and green, `bun audit` runs in CI, the sideband sandbox is shared between native and web, the C1 web-server wiring bug is structurally impossible (bind/token are required constructor params), the Telegram-crash-kills-`ht` failure the user reported in `issues_now.md` is fixed by global fault handlers, and `system.identify` returns the real socket path. Test count is up to 3136 across 260 files, more test files than source files. The two newest performance efforts — the FFI poller (~200 ms → ~5 ms per tick) and adaptive stdout coalescing — are genuinely well-engineered, with self-validating fallbacks and unusually honest comments.

The problems that remain cluster into four themes, and three of them are the *same shape* as last time:

1. **Defenses are built but left switched off by default.** This is now the dominant security pattern in the codebase. `webMirrorBind` still defaults to `0.0.0.0` with an empty token, and an empty token means `authorized()` returns `true` for every request — so the headline "mirror your terminal to your phone" feature is, on first use, an unauthenticated read/write terminal on every LAN interface, mitigated only by a `console.log` a GUI user never sees. `rpcSocketRequireToken` defaults to `false`. In both cases the mechanism exists, is correct, and is opt-in. **(§2.1, §2.5)**

2. **The extension platform added a large new attack surface with no trust boundary.** Installing an extension runs `bun install` (arbitrary postinstall) then `bun run <entry>` with `HT_RPC_TOKEN` injected — full control of the terminal — with no consent prompt, no permission model, and no manifest signing. Its `enabled` flag is never enforced anywhere, so "disabled" extensions still launch. **(§2.3, §2.4)**

3. **Two guards silently do nothing.** `pruneCpuSamples` compares its sample map against the *whole system process table*, so the condition is always true and the function never prunes — the leak its own doc comment promises to prevent. The coverage gate iterates the *baseline*, so every file added since 2026-05-16 (the extension platform, the FFI module, the renderer, the coalescer — ~2,000 LOC) is exempt from it. Both are one-line fixes with outsized value. **(§2.2, §3.2)**

4. **Decomposition is losing to feature growth.** Despite the H10 controller-extraction wave, all four god modules are *larger* than at the last review: sidebar 3418→**3714**, bun/index 2871→**3162**, views/index 2789→**3040**, surface-manager 2730→2808. **(§3.6)**

Nothing here threatens the architecture, which remains sound. The highest-leverage work is **flipping the unsafe defaults, giving the extension platform a trust boundary, and repairing the two dead guards** — roughly a day of work for the top six items.

### 1.1 Prioritized roadmap

| # | Fix | §  | Severity | Effort |
|---|-----|----|----------|--------|
| 1 | Default `webMirrorBind` to `127.0.0.1`; auto-generate a token when the mirror is first enabled; refuse `0.0.0.0` with an empty/short token and surface it in the UI | 2.1 | **critical** | S |
| 2 | Delete the `pruneCpuSamples` early-return guard | 2.2 | **high** | XS |
| 3 | Enforce `enabled` in `ensureBackend` + `extension.open`; add enable/disable RPCs (or delete the field) | 2.3 | **high** | S |
| 4 | Install-time consent + a declared-permission model for extensions; document the trust boundary | 2.4 | **high** | M |
| 5 | Default `rpcSocketRequireToken` to `true` | 2.5 | **high** | S |
| 6 | Re-promote the coverage baseline; make the gate flag unmeasured new files | 3.2 | medium | S |
| 7 | Fix the three stale `?? "webgl"` fallbacks | 3.1 | medium | XS |
| 8 | Gate the 1 Hz status-bar tick on `document.hidden` + input-hash | 3.3 | medium | S |
| 9 | Per-extension ephemeral dev port + identity probe | 3.4 | medium | S |
| 10 | Implement the SIGTERM→SIGKILL escalation `stop()` documents | 3.5 | medium | S |
| 11 | Bump the `brace-expansion` override to `^5.0.8` | 3.7 | medium | XS |

---

## 2. Critical & high findings

### 2.1 (CRITICAL) Web mirror defaults to LAN-wide with authentication disabled

`src/shared/settings.ts:751-752`

```ts
webMirrorBind: "0.0.0.0",
webMirrorAuthToken: "",
```

`src/bun/web/server.ts:232` — an empty token is not "no token configured", it is **"authentication off"**:

```ts
private authorized(url: URL, req: Request): boolean {
  if (!this.authToken) return true;
  …
```

The only mitigation is a log line at `server.ts:522-525` ("Anyone on your network can view and type in your terminal"), written to a console the GUI user does not read.

`autoStartWebMirror` is `false`, so this does not fire unless the user turns the mirror on — but turning the mirror on is the entire point of the feature. The first time a user enables it to reach their terminal from their phone, they publish an unauthenticated, full-stdin terminal to every device on the network, including on untrusted café / hotel / conference Wi-Fi.

The previous review's C1 fix was correct and is intact — `bind` and `authToken` are required constructor params (`server.ts:135-142`), so no code path can *forget* them. But it fixed the wiring and left the **values** unsafe. The remaining half of the finding is the defaults themselves.

`TOKEN_MIN_LEN_FOR_LAN` (`server.ts:44-50`) documents a deliberate choice to warn rather than refuse, "so existing users with a 12-char token aren't locked out by an upgrade". That reasoning is sound for a *short* token and wrong for **no** token — there is no back-compat cost to refusing an empty token on `0.0.0.0`, because that configuration has never been defensible.

**Fix**
1. `webMirrorBind: "127.0.0.1"` in `DEFAULT_SETTINGS`.
2. When the mirror is enabled with an empty token, generate one — `generateAuthToken()` already exists at `src/views/terminal/settings-panel.ts:2111` and the Regenerate button is already wired (`:1144`).
3. Refuse to bind `0.0.0.0` with an empty token; return the refusal through the settings RPC so the panel renders an error, instead of `console.log`.
4. Keep the short-token path as a warning (that back-compat argument does hold).

---

### 2.2 (HIGH) `pruneCpuSamples` never prunes — its guard is always true

`src/bun/native-proc.ts:384-389`

```ts
pruneCpuSamples(livePids: Set<number>): void {
  if (this.cpuSamples.size <= livePids.size) return;
  for (const pid of this.cpuSamples.keys()) {
    if (!livePids.has(pid)) this.cpuSamples.delete(pid);
  }
}
```

The caller passes **the entire system process table**, `src/bun/surface-metadata.ts:980-987`:

```ts
const rows = native.listProcesses();      // ~1000 pids on a normal Mac
if (rows.size === 0) return Promise.resolve(null);
native.pruneCpuSamples(new Set(rows.keys()));
```

`cpuSamples` only gains an entry when `taskInfoOf` runs, and that is reached exclusively through the **lazy** `.cpu` / `.rssKb` getters on `NativePsRow` (`native-proc.ts:595-609`) — which the tree walk touches only for descendants of tracked shells, a few dozen pids. So `cpuSamples.size` (dozens) `<= livePids.size` (~1000) holds on essentially every tick, and the loop below it has, in practice, never executed.

The interface doc at `native-proc.ts:195-198` states the exact contract the code fails to honour:

> *"Called by the poller each tick so a long-running app doesn't accumulate an entry per process it has ever seen."*

**Impact.** Bounded by the macOS pid ceiling rather than unbounded (~100 k entries ≈ a few MB after a very long uptime), so this is a slow leak, not a crash. The severity is that a stated invariant is silently unenforced in the module the whole metadata pipeline depends on, and the failure is invisible.

**Fix.** Delete the guard. Iterating `cpuSamples` is O(dozens) — cheaper than the `Set` construction already being paid at the call site. If a fast path is wanted, compare against the previous tick's live-pid set, not its size.

---

### 2.3 (HIGH) Extension `enabled` is write-only state — disabled extensions still run

The flag is loaded from the registry (`extension-manager.ts:229`), defaulted (`:253`), reconciled back to disk (`:265`), and reported over RPC (`rpc-handlers/extension.ts:41`).

It is **never read as a condition**. `ensureBackend()` (`:338-396`) does not check it, and neither does `extension.open` / `extension.split` (`rpc-handlers/extension.ts:53-75`), which gate only on `mgr.has(id)`.

There is also no way to *change* it: the RPC surface has `list` / `templates` / `open` / `split` / `new` / `install` / `remove` / `reload` / `stop` — no `enable` or `disable`. So the field is persisted, surfaced in the UI and CLI as if meaningful, and has no effect and no setter.

**Fix.** Either enforce it (early return in `ensureBackend`, reject in `extension.open`, plus `extension.enable` / `extension.disable` RPCs), or remove it from the manifest, registry, and `extension.list` payload. Reporting a control that does nothing is worse than not having one.

---

### 2.4 (HIGH) The extension platform has no trust boundary

Installing and opening an extension performs, in order:

1. `cpSync(srcDir, dest, { recursive: true })` — `extension-manager.ts:823`, follows whatever the source tree contains;
2. `bun install` in the extension dir — `:487`, which executes **arbitrary postinstall scripts**;
3. `bun run <manifest.backend.entry>` — `:525`, with `HT_SOCKET_PATH` and `HT_RPC_TOKEN` injected into the environment (`:533-534`).

That token is the key to the whole RPC surface: sending keystrokes to any pane, reading screen contents, driving browser panes, shutting the app down. In dev mode there is a fourth vector — when the manifest's `frontend.dev` binary is not installed locally, `spawnDevServer` falls back to `bun x <bin>` (`:607-615`), which the code's own comment notes "may fetch from the network".

There is no install-time consent prompt, no declared-permission model, no manifest signature, and no sandbox. `extension.install` is reachable over the socket RPC, which by default requires no token (§2.5).

This is a **design gap rather than a bug** — an extension platform that runs code is a legitimate choice, and pi-agent-manager sets the precedent. But it is the largest new attack surface added since the last audit, it is not described in `doc/system-security.md`, and it composes badly with §2.5: any `bun install` you run in any project could drop an extension and gain persistence inside your terminal.

**Fix (incremental, in value order)**
1. Document the trust model explicitly in `doc/system-security.md` and `doc/design_extension_platform.md` — "extensions are fully trusted code; install only what you would `curl | sh`".
2. Require an interactive confirmation for `extension.install` when it arrives over the socket (as opposed to the in-app UI).
3. Declare capabilities in the manifest and scope the injected `HT_RPC_TOKEN` to them; the per-domain handler registry in `src/bun/rpc-handlers/` already gives you the natural granularity.
4. Drop the `bun x` network fallback — fail with "run `bun install` in the extension dir" instead.

---

### 2.5 (HIGH) `rpcSocketRequireToken` defaults to `false`

`src/shared/settings.ts:753`. The enforcement is implemented and correct (`src/bun/socket-server.ts:158`), and the token file plumbing exists (`src/shared/rpc-token.ts`). It is simply off, so the previous review's H3 — any same-user process can inject keystrokes into your shells or shut the app down — is still open in the default configuration, now with `extension.install` added to the reachable surface.

The counter-argument is `ht` ergonomics. But `ht` already resolves the token from disk beside the socket (`rpcTokenPathForSocket`, used at `extension-manager.ts:518`), so enabling this by default should be transparent to the CLI.

**Fix.** Default to `true`; verify `bin/ht` and the bundled CLI binary read the token file on every mutating call; keep the setting for users who need the old behaviour.

---

## 3. Medium findings

### 3.1 Stale `?? "webgl"` fallbacks contradict the shipped default

v0.4.11 reverted the renderer default to DOM after v0.4.9 shipped blank panes:

- `src/shared/settings.ts:705` — `terminalRenderer: "dom"`
- `src/shared/settings.schema.ts:222` — `enumStr("dom", …)`

Three sites in the command palette were missed — `src/views/terminal/index.ts:1445, 1449, 1454`:

```ts
(currentSettings?.terminalRenderer ?? "webgl") === "webgl"
```

`currentSettings` is `null` until the first settings payload arrives (`index.ts:483`, assigned at `:584`). Until then the palette entry shows the inverted label ("Use DOM Terminal Renderer" while already on DOM) and its action computes `next = "dom"` — writing the value the user is already on, so the command appears to do nothing and persists a no-op.

**Fix.** Replace all three with `?? DEFAULT_SETTINGS.terminalRenderer`. Better: the file already imports `DEFAULT_SETTINGS` and uses `currentSettings ?? DEFAULT_SETTINGS` correctly two lines below (`:1457`) — use that form consistently and the class of bug disappears.

### 3.2 The coverage gate does not see any file added since 2026-05-16

`scripts/check-coverage.ts:85` iterates the **baseline**:

```ts
for (const [path, b] of baseline) {
  const c = current.get(path);
  if (!c) continue;      // deleted/renamed — tolerated
```

A file in `current` but not in `baseline` is never examined. The baseline was last promoted on **2026-05-16** (`9b66a5fd`, "close Phase 3"). Everything merged since then is therefore exempt from the gate, including:

| File | LOC | In baseline? |
|---|---|---|
| `src/bun/extension-manager.ts` | 862 | no |
| `src/bun/native-proc.ts` | 745 | no |
| `src/views/terminal/extension-pane.ts` | 254 | no |
| `src/views/terminal/terminal-renderer.ts` | 178 | no |
| `src/bun/native-stdout-coalescer.ts` | 134 | no |

`native-proc.ts` and `terminal-renderer.ts` do have good test files — the point is that the *gate* cannot tell, so new code can land at 0 % and CI stays green. A quality gate that silently narrows to a shrinking subset of the codebase is worse than none, because it reports success.

**Fix.** (a) `bun run baseline:coverage` to re-promote; (b) in `findRegressions`, collect files present in `current` but absent from `baseline` and either fail them against a floor or print them as a warning block so the omission is visible in CI logs.

### 3.3 The webview pays CPU every second forever, including when hidden

`src/views/terminal/index.ts:927`

```ts
setInterval(() => { refreshStatusBar(); }, 1000);
```

Unconditional, never cleared, no `document.hidden` check. `refreshStatusBar` (`:754`) is half-optimized: it builds the **entire status-key DOM subtree into an off-DOM scratch div on every tick**, then hashes the result to skip `replaceChildren`. The comment at `:769-772` is accurate about what it achieves — "turns the steady-state cost of paint+style-recalc to zero" — but the `buildStatusContext()` call, the per-key `renderStatusKey()` calls, and the element allocations are all still paid, forever, whether or not the window is visible.

The bun side received exactly this treatment in v0.3.179 (activity-adaptive idle backoff, §5.3 of the previous review). The webview side never did.

**Fix.** Early-return on `document.hidden`; hash the *inputs* (`ctx` + `ids` + settings revision) before building rather than the output DOM; consider dropping to 1/5 Hz when no status key depends on wall-clock.

### 3.4 Extension dev servers can collide and load each other's UI

`extension-manager.ts:384` and `:408` both default to `devPort ?? 5173`. `waitForPort` (`:116-141`) only proves that *something* is accepting TCP on that port — it never checks it is the server we just spawned.

Consequences:
- Two extensions without an explicit `devPort` collide. `--strictPort` (`:604`, `:614`) makes the second Vite fail to bind, `waitForPort` still returns `true` because the first is listening, and the second extension's iframe loads **the first extension's UI**.
- The same happens against any unrelated Vite project the user has running — 5173 is the ecosystem default, so this is likely rather than theoretical.

The three bundled examples dodge it with hand-assigned ports (5191/5192/5193), which is why it has not been noticed.

**Fix.** Allocate an ephemeral port per extension instance and pass it to Vite, or have `waitForPort` fetch a known path and verify an identity header before mounting the iframe.

### 3.5 `stop()` documents an escalation it does not implement

`extension-manager.ts:735-749` — the doc comment reads *"Stop the backend (and dev server) for a surface. SIGTERM then SIGKILL."* The body calls `proc.kill()` once, with no follow-up timer:

```ts
for (const proc of [inst.backendProc, inst.devProc]) {
  if (!proc) continue;
  try { proc.kill(); } catch { /* already dead */ }
}
```

A backend that ignores SIGTERM survives, and `dispose()` (`:845`) routes through the same path, so it survives app shutdown too — leaving an orphan holding `HT_RPC_TOKEN`. `PtyManager` already implements the correct SIGHUP→SIGKILL escalation; reuse that shape.

### 3.6 God modules grew through the decomposition wave

Measured against `99973a2c` (v0.3.160, the previously reviewed commit):

| Module | Then | Now | Δ |
|---|---|---|---|
| `src/views/terminal/sidebar.ts` | 3418 | **3714** | +296 |
| `src/bun/index.ts` | 2871 | **3162** | +291 |
| `src/views/terminal/index.ts` | 2789 | **3040** | +251 |
| `src/views/terminal/surface-manager.ts` | 2730 | 2808 | +78 |

H10 did real work — `TelegramSurfaceController`, `EditorController`, `AgentController` were genuinely extracted — and surface-manager still grew. `sidebar.ts` is now the largest file in the project and has never had an extraction plan. The lesson is that one-off extraction waves do not hold against steady feature growth; a standing constraint does. Consider a lint rule capping module size (warn at 1500, error at 2500) so new features are forced into new modules at authoring time.

### 3.7 The `brace-expansion` override sits inside the vulnerable range

`bun audit` reports 2 high advisories (GHSA-mh99-v99m-4gvg, GHSA-3jxr-9vmj-r5cp) affecting `>=4.0.0 <5.0.8`. `package.json` already has an override — but it pins `^5.0.6`, and `bun.lock:188` resolves **5.0.6**, inside the range. The override was added to fix this and lands one patch short.

Dev-only (eslint → `@eslint/config-array` → minimatch), so there is no user-facing exposure — but CI runs `bun audit` non-blocking, which means the scan is permanently red and therefore useless as a signal.

**Fix.** `"brace-expansion": "^5.0.8"`.

---

## 4. Low findings

**4.1 Renderer fallback is invisible and permanent.** `RendererFallbackReason` (`terminal-renderer.ts:31-37`) is documented as *"Surfaced for logging and for the settings panel's status hint"*. Grepping every consumer: `surface-manager.ts:1394` (`getActiveRendererKind`) and `__test-handlers.ts:114`. **The settings-panel hint does not exist**, so a user whose GPU renderer silently fell back has no way to know. Separately, after `onContextLoss` (`:133-143`) the pane stays on DOM until it is recreated — no retry. Given that browsers cap live WebGL contexts and this app opens one per pane *plus* one per bloom layer, heavy multi-pane users will hit this. Add the settings hint the doc already promises.

**4.2 `rpc-handler.ts:158` repeats the C1 anti-pattern.** `socketPath: options.socketPath ?? "/tmp/hyperterm.sock"` — a default that silently reproduces the wrong-socket-path bug the user reported in `issues_now.md`. The C1 lesson was to make such params required so omission is a typecheck error; apply it here.

**4.3 The sandbox threat model is overstated.** CLAUDE.md describes the fd4 iframe sandbox as *"defense-in-depth against a compromised/careless producer"*. At `src/views/terminal/panel.ts:143-148` any producer opts out by setting `interactive: true`. It defends against a **careless** producer; a **compromised** one simply sets the flag. The web mirror has no such escape hatch (`src/web-client/main.ts:1063-1070` always sandboxes), which is correct. Narrow the wording, or require an explicit user/settings opt-in for interactive panels.

**4.4 `uncaughtException` continues after arbitrary faults.** `src/bun/index.ts:204-207` was the right call for the Telegram-kills-`ht` bug and the attribution helper is a nice touch — but the process now runs on indefinitely after *any* uncaught fault, including ones that leave state corrupt. Consider a fault budget (N faults in M minutes → clean restart with state persisted).

---

## 5. What is notably good

Worth recording so it does not get refactored away by someone who does not know why it is there:

- **`native-proc.ts` self-validation** (`:697-757`). Hardcoded kernel struct offsets are normally a liability; making the module *prove* its offsets against known-good answers (own pid/ppid, own cwd, a throwaway listener on an ephemeral port) and return `null` on any mismatch converts a future macOS ABI change from "silently wrong chips" into "clean fallback to `ps`". This is the right pattern for every unsafe optimization.
- **`NativeStdoutCoalescer`'s quiet/busy split** (`native-stdout-coalescer.ts:13-35`). Recognising that a fixed batching window taxes precisely the case where latency is most visible — keystroke echo on an idle terminal — and engaging the window only on evidence of streaming. The reasoning is documented at the point of the tradeoff. Ordering is safe under all interleavings I traced.
- **Required constructor params as the C1 fix.** Making the unsafe configuration unrepresentable rather than adding a call-site check. §2.1 is the remaining half, not a regression.
- **Fault attribution on unhandled rejection** (`bun/index.ts:210+`) — marking *which* subsystem destabilised, so the user sees the cause rather than a generic error.

---

## 6. Previous-review items re-verified as fixed

| Item | Status |
|---|---|
| C1 — auto-start ignored bind/token | **Fixed** — required ctor params (`web/server.ts:135-142`). Defaults still unsafe → §2.1 |
| C2 — inline `meta.data` bypassed the sandbox | **Fixed** — `web-client/main.ts:1063`, `views/terminal/panel.ts:141` |
| C3 — no persistence on GUI quit | **Fixed** — `e91ed5f1` |
| C4 — hardcoded personal Telegram ID | **Fixed** — `settings.ts:800` defaults to `""` |
| H4 — native fd4 `innerHTML`, no CSP | **Fixed** — shared `sideband-sandbox.ts`; `interactive` caveat → §4.3 |
| H8 / 10.2 — auto-continue gates after the paid call | **Fixed** — `f0f0b451` |
| H11 — forked sidebar card rendering | **Fixed** — `f87727c7` |
| H14 — `tick()` untested | **Fixed** — `b39b9a84` |
| §5.3 — poller idle backoff | **Fixed** — `8abca6d4`; webview equivalent still missing → §3.3 |
| §6.5 — 2,341-line `bin/ht` | **Fixed** — `b9dc0362`, split into `src/cli/` |
| H0b — release shipped without a test gate | **Fixed** — `verify` job, `release.yml:70-85` |
| eslint installed but dead | **Fixed** — wired in CI (`ci.yml:40-44`), 0 errors |
| No vuln scan | **Fixed** — `bun audit` in CI; ineffective override → §3.7 |
| Telegram crash killed `ht` (`issues_now.md`) | **Fixed** — `bun/index.ts:196-207`; caveat → §4.4 |
| `/tmp/hyperterm.sock` hardcoded (`issues_now.md`) | **Fixed** — injected `deps.socketPath`; stale default → §4.2 |
| H3 — unauthenticated socket RPC | **Mechanism built, off by default** → §2.5 |

---

## 7. Suggested sequencing

**Wave A — one sitting (~2h).** §2.2 (delete the guard), §3.1 (three fallbacks), §3.7 (override bump), §3.2a (re-promote baseline), §4.2 (required param). All XS, all independently verifiable, no behaviour risk.

**Wave B — the security defaults (~half a day).** §2.1 and §2.5 together, since both change what happens the first time a user enables a networked feature. Ship with a short release note — these are the only user-visible behaviour changes in the whole list.

**Wave C — the extension platform (~1–2 days).** §2.3 (enforce `enabled`), §3.5 (kill escalation), §3.4 (dev ports), then §2.4's documentation step. The capability-scoped token is a larger design task worth its own plan doc.

**Wave D — standing constraints.** §3.2b (gate flags unmeasured files), §3.3 (idle tick), §3.6 (module-size lint rule). These are the ones that stop the same findings recurring in the next audit.
