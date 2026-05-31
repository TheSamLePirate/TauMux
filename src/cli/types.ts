/**
 * Shared types for the `ht` CLI command modules.
 * Split out of the former 2,361-line `bin/ht` monolith
 * (full_app_review_2026-05.md §6.5).
 */

export interface RpcCall {
  method: string;
  params: Record<string, unknown>;
}

/** Parsed argv handed to the command mappers. */
export interface CliContext {
  /** Raw argv (process.argv.slice(2)) — a few legacy `browser-cookie-*`
   *  aliases index it directly; preserved as-is by the §6.5 split. */
  args: string[];
  command: string;
  positional: string[];
  flags: Record<string, string>;
}
