# Tracking — brand-string consolidation (H0j / §20.1)

Started: 2026-05-30. Source: `doc/full_app_review_2026-05.md` §20.1 / H0j — "Product rename is half-done: user state is split across two brand names."

## Scope (the review's recommended SAFE path: centralize + fix user-facing, don't rename load-bearing)
- New `src/shared/brand.ts` — the single home for the brand identifiers, each annotated LOAD-BEARING or safe.
- Wired the src usages to the constants: config-dir name + socket basename (`index.ts`), log-dir name (`logger.ts`), RPC protocol tag (`system.ts`).
- Fixed the 5 user-facing "HyperTerm Canvas" strings in `bin/ht` → "τ-mux" (CLI header comment, the two "… is not running." errors, the `--help` banner).
- `electrobun.config.ts` keeps its literal `identifier` (it's evaluated by the electrobun build before `src/` is bundled, so importing brand.ts there is build-risky) — added a cross-ref comment + a test that keeps it in sync.

## Deliberately NOT changed (load-bearing — would orphan state without a migration)
- `CONFIG_DIR_NAME = "hyperterm-canvas"` — existing users' settings/cookies/telegram.db/layout live there.
- `SOCKET_BASENAME = "hyperterm.sock"` — the `ht` CLI + pi/Claude bridges resolve this path.
- `BUNDLE_IDENTIFIER = "dev.hyperterm.canvas"` — macOS Keychain/TCC/LaunchServices key on it.
- `RPC_PROTOCOL = "hyperterm-socket"` — wire handshake some external clients may assert on.
- `.agents/skills/hyperterm-canvas/` path (`index.ts:1519`) — the directory genuinely exists; the string must match it.

A future change can flip the config-dir to the new brand via a one-time rename-on-launch (if old exists and new doesn't, mv) — now a one-line change in `brand.ts` + the migration. Left out of this commit (it's the risky, can't-verify-headlessly part).

## Verification (2026-05-30)
- `bun run typecheck`: clean. `bun run lint`: clean.
- `bun test`: **2993 pass / 0 fail** — incl. new `tests/brand.test.ts` (pins the load-bearing values so a careless rename trips the test; asserts electrobun stays in sync; asserts `bin/ht` no longer prints the old name). Fixed two tests that asserted the old strings: `bin-ht-help.test.ts` (banner) and `audit-emoji.test.ts` (my brand.ts comment had a `⚠️` — replaced with `!!` per the project's "No emoji. Ever." guideline).
- `bun start`: boots clean — log dir / socket path / config dir all resolve from the brand constants; `ht version` + `ht identify` round-trip; zero runtime errors. Rebuilt `build/ht-cli` shows "ht — τ-mux CLI" + "τ-mux is not running."

## Commit / release
- (recorded below)
