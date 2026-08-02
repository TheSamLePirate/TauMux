# system: security trust model

τ-mux runs a hybrid trust model: a single-user macOS / Linux desktop app that optionally exposes itself on the LAN via a WebSocket mirror. The compensating controls are documented here so a reviewer can audit the boundary in one sitting, and so a future refactor can't silently weaken a control without flagging the matching regression test.

This doc is the **authoritative ledger of every security control in the codebase.** Each item carries its issue id (cross-reference `doc/triple_a_analysis.md`), the file:line where it lives, and the test that prevents regression.

---

## Threat model

Three classes of attacker:

| # | Attacker | Capability | Defense |
|---|---|---|---|
| **L** | Local-user / cloud-sync agent | Can read files under `~/Library/Application Support/hyperterm-canvas` | File-mode 0o600 on sensitive files (S1 / H.1). |
| **N** | LAN attacker without the token | Can reach `0.0.0.0:<webMirrorPort>` over TCP | Token entropy floor warning (S4), brute-force throttle (S5), security headers (S6). |
| **A** | LAN peer holding the auth token, OR a process that writes to fd 4 of any pane (npm postinstall, `curl|sh`, Homebrew formula) | Can submit any wire message after auth, OR inject sideband content | iframe-sandbox + CSP on sideband HTML/SVG (S2), Telegram parse_mode allow-list (S11), Telegram outbound cap (S3) + chatId allow-list (S7), WS heartbeat + reconnect jitter (L3/L5). |

The most subtle is **A**: the auth token gates the WebSocket, but once authenticated, any wire message becomes a privileged operation. Independently, sideband HTML rendered into the mirror's origin used to bypass the gate entirely — every fd-4 producer in the user's terminal effectively had script execution in the mirror page.

---

## Red-team checklist

Ten items, each paired to a test or CI grep that catches a regression. A green build = none of these have rotted.

| # | Control | Where it lives | Where it's tested |
|---|---|---|---|
| 1 | Token entropy floor warning on `0.0.0.0` boot with `webMirrorAuthToken.length < 16` | `src/bun/web/server.ts` near `TOKEN_MIN_LEN_FOR_LAN = 16` | `tests/web-token-entropy.test.ts` (source-grep on warn message + threshold) |
| 2 | Brute-force throttle: 10 failures / 60 s / peer → 10 min cooldown + HTTP 429 + Retry-After | `src/bun/web/server.ts` brute-force window | `tests/web-auth.test.ts` ("excessive auth failures from same peer trip a 429 cooldown") |
| 3 | Default security headers on every HTTP response: CSP, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: no-referrer, Permissions-Policy | `src/bun/web/server.ts` `securityHeaders()` | `tests/web-auth.test.ts` ("every response carries security headers") |
| 4 | iframe-sandbox + strict CSP for sideband HTML/SVG in the web mirror | `src/web-client/panel-renderers.ts` `wrapInSandboxedShell` + `ensureSandboxIframe` | `tests/web-client-panel-sandbox.test.ts` (11 invariants) |
| 5 | Telegram `parse_mode` allow-list — only `MarkdownV2` survives the sanitizer | `src/bun/telegram-service.ts` `sanitizeParseMode()` | `tests/telegram-parse-mode.test.ts` (7 invariants) |
| 6 | Telegram outbound text capped at 4096 chars before send | `src/bun/index.ts` `TELEGRAM_MAX_TEXT_LEN = 4096` | `tests/telegram-outbound-cap.test.ts` (S3 cap shape) |
| 7 | Telegram chatId allow-list — mirror-originated sends rejected for unknown chats | `src/bun/index.ts` `sendTelegramAndBroadcast` allow-list check | `tests/telegram-outbound-cap.test.ts` (S7 allow-list) |
| 8 | File-mode 0o600 on sensitive on-disk files: logger, settings, cookies, history, telegram.db | `src/bun/atomic-write.ts` mode opt; `src/bun/logger.ts` chmod; `src/bun/telegram-db.ts` chmod | `tests/atomic-write.test.ts` (mode opt) + `tests/file-modes.test.ts` (live stat) |
| 9 | Socket buffer cap — `/tmp/hyperterm.sock` peers can't OOM the host with a no-newline write | `src/bun/socket-server.ts` `MAX_BUFFER_BYTES = 1_048_576` | `tests/socket-server.test.ts` (1.5 MiB garbage → error) |
| 10 | WebSocket heartbeat (`idleTimeout=60`, `sendPings=true`) + reconnect jitter (±25 %, max 30 attempts) so dead peers don't pile up state | `src/bun/web/server.ts` Bun.serve.websocket opts + `src/web-client/transport.ts` reconnect math | `tests/web-ws-heartbeat.test.ts` (config + jitter + cap) |

---

## Native vs mirror trust model

The native Electrobun webview and the LAN-visible mirror have different threat boundaries:

- **Native webview** — same origin as the bun process; same user. Since H4 the native side **also** sandboxes: display-only `html`/`svg` (inline `meta.data` or binary fd4) renders inside the same strict-CSP iframe as the mirror, via the shared `src/shared/sideband-sandbox.ts`. The one deliberate escape hatch is `interactive`, which keeps the direct-`innerHTML` path because DOM event forwarding cannot cross an iframe boundary. Note precisely what that buys: `interactive` is set *by the producer*, so this hardens the native sink against a **careless** producer, not a hostile one — a compromised producer sets the flag and gets `innerHTML`. The underlying trust model is unchanged: "the script that wrote to fd 4 is the local user; the local user can already do anything."

- **LAN mirror** — exposed on `0.0.0.0:<webMirrorPort>` with a token gate. The token isn't enough by itself once any process can write to fd 4 of any pane, so every sideband payload renders inside an iframe sandbox (see control #4). The mirror page's origin holds the auth token + `localStorage` + the live WebSocket; the sandbox prevents a sideband injection from reaching any of those.

When in doubt: the native side ships content **at the user**; the mirror ships content **between machines**. Network distance increases the attack surface.

---

## Extensions are fully trusted code

*(§2.4, doc/full_app_review_2026-08.md — added because this boundary existed in the implementation but was written down nowhere.)*

The extension-app platform (`src/bun/extension-manager.ts`) runs third-party code with **no sandbox and no permission model**. Installing and opening an extension does all of this:

1. `cpSync` the source tree into `<configDir>/extensions/<id>/`;
2. `bun install` in that directory — which executes **arbitrary `postinstall` scripts**;
3. `bun run <manifest.backend.entry>` with `HT_SOCKET_PATH` and `HT_RPC_TOKEN` in the environment.

That token is the key to the entire control surface: sending keystrokes to any pane, reading screen contents, driving browser panes, installing further extensions, shutting the app down.

**The rule: install an extension only if you would pipe it to a shell.** There is no meaningful difference in privilege.

What we *do* enforce today:

- **No network fetch of dev binaries** (§2.4) — `spawnDevServer` runs only a binary already present in the extension's `node_modules`. There is deliberately no `bun x <bin>` fallback, because that would resolve a package name from the manifest against the registry and execute it, turning "open a pane" into remote code execution against a name the user never reviewed.
- **`enabled` is enforced** (§2.3) — `ensureBackend` and `extension.open` / `extension.split` refuse a disabled extension, and disabling stops any surface already running it. Toggle with `ht extension enable|disable <id>`.
- **Id validation** — `isValidExtensionId` gates the on-disk folder name and the URL segment; the static bundle host additionally rejects `..` and unknown ids.
- **Kill escalation** (§3.5) — `stop()` sends SIGTERM then SIGKILL after `EXTENSION_KILL_GRACE_MS`, so a backend that ignores SIGTERM cannot outlive the app holding a live RPC token.

What is **not** defended (deferred, in value order):

- **No install-time consent.** `extension.install` is reachable over the socket RPC. `rpcSocketRequireToken` now defaults to `true` (§2.5), so a random same-user process can no longer reach it without reading the token file — but a human-visible confirmation for socket-originated installs is still the right control.
- **No capability scoping.** Every extension backend gets the full-privilege token. The per-domain handler registry under `src/bun/rpc-handlers/` is the natural granularity for a scoped token; that is a design task, not a patch.
- **No manifest signing / provenance.**
- **Symlinks are followed on install.** A malicious source tree can plant a symlink that the static bundle host will then serve.

---

## What's NOT defended

Documented gaps. Each is an explicit deferral with the phase that owns the follow-up.

- **Per-surface browser partition** (H.8) — the embedded browser pane shares a webview partition across surfaces. A cookie set in one browser pane is visible to every other browser pane in the workspace. Owned by **P7** polish.

- **Session cap + manifest-auth + cross-site origin check** (H.9) — the mirror accepts an unbounded number of resume sessions and doesn't validate the `Origin` header on incoming WebSocket upgrades. Owned by **P7**.

- **Native sandbox bypass via `interactive`** — see "Native vs mirror" above. Display-only markup is sandboxed on both sides since H4; `interactive` remains a producer-controlled opt-out on the native side only. Closing it means finding another way to forward DOM events out of an iframe.

- **Extension sandboxing / capability scoping** — see "Extensions are fully trusted code" above.

- **`pi-extensions/ht-bridge` + `claude-integration/ht-bridge` session-state TTL** — the hooks write per-session state under `$TMPDIR` with 24 h pruning. No hard file-count cap. Owned by **P7**.

- **Sideband fuzz corpus** — the parser is well-tested for normal input but not against a corpus of malformed JSONL. Owned by **P7**.

---

## How to add a new control

1. Add the runtime code with a `Triple-A` comment marker referencing the issue id (e.g. `// Triple-A S11 — runtime allow-list ...`).
2. Add a regression test under `tests/` with the issue id in the test name.
3. Add a row to the red-team checklist above.
4. If the control is gated by a config knob, document the safe default in the comment.

This doc plus the matching test row is the contract. A future PR that removes either fails review.
