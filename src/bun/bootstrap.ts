import { existsSync, mkdirSync } from "node:fs";

/**
 * Create the config dir before anything tries to open a file in it.
 *
 * Everything in the bootstrap (settings, telegram.db, browser history,
 * cookies) assumes the directory exists, but the only guaranteed
 * mkdir used to live ~2,200 lines into `index.ts`, just before the
 * socket bind — a fresh install could crash at the first file open
 * long before reaching it. Call this immediately after `configDir`
 * is computed. Idempotent; failures are logged, not thrown (the
 * socket bind is the first truly hard requirement).
 */
export function ensureConfigDir(configDir: string): void {
  try {
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  } catch (err) {
    console.error(`[boot] could not create config dir ${configDir}:`, err);
  }
}
