// W2 (full_app_review_2026-05.md §6.1) — shared constants/helpers for the
// optional RPC socket token. Pure (path only) so it can be imported by the
// bun main process, the bundled `bin/ht` CLI, and the pi ht-bridge client
// without dragging in any platform deps.

import { dirname, join } from "node:path";

/** Filename of the per-boot token, written beside the RPC socket. */
export const RPC_TOKEN_FILENAME = "socket.token";

/** Top-level request field carrying the token (sibling to method/params).
 *  Kept out of `params` so it never reaches a handler or the rpc audit. */
export const RPC_TOKEN_FIELD = "__token";

/** Methods that work WITHOUT a token even when enforcement is on. These are
 *  read-only diagnostics so `ht doctor` / status can still report a token
 *  mismatch instead of failing opaquely. Everything else (incl.
 *  system.shutdown) is deny-by-default when enforcement is enabled. */
export const UNAUTHENTICATED_RPC_METHODS: ReadonlySet<string> = new Set([
  "system.ping",
  "system.version",
  "system.identify",
  "system.capabilities",
  "system.health",
  "system.tree",
]);

/** Resolve the token-file path for a given socket path: the token lives in
 *  the same directory as the socket (the app's config dir). */
export function rpcTokenPathForSocket(socketPath: string): string {
  return join(dirname(socketPath), RPC_TOKEN_FILENAME);
}
