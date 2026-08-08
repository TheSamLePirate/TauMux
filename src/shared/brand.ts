// Canonical brand identifiers (full_app_review_2026-05.md §20.1 / H0j).
//
// The product was renamed "HyperTerm Canvas" → "τ-mux", but the rename was
// only half-applied: logs moved to the new brand while config, the socket,
// the bundle id, and the RPC handshake kept the old one. This module is the
// single place those strings live so the split is visible + auditable, and
// so a future migration can change them in one spot.
//
// !! LOAD-BEARING — do NOT change these without a migration; they key
// existing user state / OS registrations / external tooling:
//   - CONFIG_DIR_NAME  : existing users' settings.json / cookies / telegram.db
//                        / layout.json live in Application Support/<this>.
//                        Renaming orphans them unless you ship a one-time
//                        rename-on-launch (if old exists and new doesn't, mv).
//   - SOCKET_BASENAME  : the `ht` CLI + the pi/Claude ht-bridge resolve this
//                        path; renaming breaks external scripts.
//   - BUNDLE_IDENTIFIER: macOS Keychain / TCC permissions / LaunchServices
//                        key on it. Changing it orphans installed apps'
//                        permissions. (Mirrored literally in
//                        electrobun.config.ts — keep in sync.)
//   - RPC_PROTOCOL     : the system.capabilities handshake tag; some external
//                        clients may assert on it.
//
// LOG_DIR_NAME already moved to the new brand. DISPLAY_NAME is the
// user-facing product name and is safe to use anywhere.

/** User-facing product name. Safe to print / display anywhere. */
export const DISPLAY_NAME = "τ-mux";
/** The pre-rename product name — kept only for migration/diagnostics. */
export const LEGACY_DISPLAY_NAME = "HyperTerm Canvas";

/** Application Support sub-directory. LOAD-BEARING (see header). */
export const CONFIG_DIR_NAME = "hyperterm-canvas";
/** ~/Library/Logs sub-directory (already on the new brand). */
export const LOG_DIR_NAME = "tau-mux";
/** Unix socket basename (under the config dir, or /tmp fallback).
 *  LOAD-BEARING (see header). */
export const SOCKET_BASENAME = "hyperterm.sock";
/** macOS bundle identifier. LOAD-BEARING — do NOT change (see header). */
export const BUNDLE_IDENTIFIER = "dev.hyperterm.canvas";
/** RPC `system.capabilities` handshake protocol tag. */
export const RPC_PROTOCOL = "hyperterm-socket";

/** `TERM_PROGRAM` announced to every PTY child.
 *
 *  Programs branch on this to decide what the host terminal supports.
 *  Lower-case, no spaces, matching the convention of every other value
 *  in the wild (`ghostty`, `WezTerm`, `iTerm.app`, `vscode`). */
export const TERM_PROGRAM_NAME = "tau-mux";

/** Current app version, as `TERM_PROGRAM_VERSION` and anywhere else the
 *  bun side needs it without reaching into an RPC handler module.
 *
 *  Stamped by `scripts/bump-version.ts` alongside package.json,
 *  electrobun.config.ts and `src/bun/rpc-handlers/system.ts`. The three
 *  copies are pinned to each other by `tests/version-consistency.test.ts`,
 *  so a partial bump fails CI instead of shipping a lie. */
export const APP_VERSION = "0.11.1";
