// W4-1 (full_app_review_2026-05.md §14.2) — settings schema versioning.
//
// Before this, settings.json had no version field and no migration
// framework (only an ad-hoc, idempotent bloom stamp), so a field could
// never be renamed or removed without silently losing the user's data on
// the next load. This adds a forward-only ordered migration runner.
//
// The version is PERSISTENCE METADATA, not a user setting: it lives as a
// top-level `__schemaVersion` key in settings.json and is handled entirely
// by SettingsManager + this module. It is never part of the typed
// `AppSettings` object — `validateSettings` rebuilds from known fields and
// drops unknown keys, so the metadata never leaks into the in-memory
// settings.

/** Current on-disk settings schema version. Bump this (and add the matching
 *  `SETTINGS_MIGRATIONS[N]`) whenever a field is renamed/removed/reshaped in
 *  a way that a plain merge-over-defaults can't recover — or when a security
 *  default flips and existing installs must be carried over to it (v2). */
export const SETTINGS_SCHEMA_VERSION = 2;

/** Top-level JSON key that records the version a settings.json was written
 *  with. Underscore-prefixed so it's visibly "internal" in the file. */
export const SCHEMA_VERSION_KEY = "__schemaVersion";

/** A migration upgrades a settings blob from version N to N+1. Keep them
 *  pure and defensive (the input is whatever was on disk — possibly
 *  partial/garbage). */
export type SettingsMigration = (
  raw: Record<string, unknown>,
) => Record<string, unknown>;

/**
 * Registry keyed by the version each migration upgrades FROM:
 * `SETTINGS_MIGRATIONS[1]` turns a v1 blob into v2.
 */
export const SETTINGS_MIGRATIONS: Record<number, SettingsMigration> = {
  /**
   * v1 → v2 — opt existing installs into RPC socket token enforcement
   * (§2.5, full_app_review_2026-08.md).
   *
   * `rpcSocketRequireToken` shipped defaulting to `false`, so every install
   * that has ever written settings.json has `false` on disk. Flipping
   * `DEFAULT_SETTINGS` alone would therefore only protect *new* installs and
   * leave every existing user exactly as exposed as before — merge-over-
   * defaults keeps the persisted value. A security default that only applies
   * to people who don't have the product yet isn't a fix, so the flip has to
   * be a migration.
   *
   * Safe to do silently because the token is transparent to every
   * first-party client: `src/cli/rpc-client.ts` (bundled `ht`),
   * `pi-extensions/ht-bridge`, `packages/tau-mux-sdk`, and
   * `claude-integration/ht-bridge` (which shells out to `ht`) all read
   * `socket.token` themselves, and the file is written on every launch
   * regardless of the setting. Read-only diagnostics stay unauthenticated,
   * so `ht doctor` / `ht ping` keep working even against a stale token.
   *
   * Only rewrite an explicit `false`. A user who had already opted IN keeps
   * `true` (no-op), and a file that never had the key falls through to the
   * new default anyway.
   */
  1: (s) => {
    let next = s;
    if (next["rpcSocketRequireToken"] === false) {
      next = { ...next, rpcSocketRequireToken: true };
    }

    /**
     * Also rescue installs stuck on the known-broken GPU renderer.
     *
     * v0.4.9 shipped `terminalRenderer: "webgl"` as the DEFAULT and it
     * rendered panes blank (the pane paints via DOM for a moment, then the
     * deferred WebGL attach blanks it). v0.4.11 "fixed" this by flipping
     * the default back to `"dom"` — but a default only applies to installs
     * that have never written settings.json. Every user who actually ran
     * v0.4.9 or v0.4.10 has `"webgl"` persisted, so the revert never
     * reached the people it was for: they are still looking at a blank
     * terminal, and the faster they update the more likely they are stuck.
     * Reproduced live on 2026-08-02 against a dev profile carrying the
     * v0.4.9 value.
     *
     * The underlying WebGL fault is still unconfirmed (see
     * doc/changes_to_document.md), which is exactly why this resets rather
     * than preserves: an opt-in to a feature the user never opted into, and
     * which is known to break the app's core function, is not a preference
     * worth honouring. One-time and logged — `__schemaVersion` reaches 2 so
     * this never runs again, and a deliberate re-opt-in afterwards sticks.
     */
    if (next["terminalRenderer"] === "webgl") {
      next = { ...next, terminalRenderer: "dom" };
    }
    return next;
  },
};

/**
 * Run forward migrations from the blob's recorded version up to `target`.
 *
 * - Missing/invalid `__schemaVersion` ⇒ treated as 0 (a pre-versioning
 *   file), so a future v0→v1 migration can run against legacy files.
 * - A blob claiming a version HIGHER than `target` (e.g. a settings.json
 *   written by a newer app, then opened by an older one) is returned
 *   untouched — we never migrate backward; the caller's merge-over-defaults
 *   + validation will drop any unknown future fields.
 * - A migration that throws stops the chain rather than bricking startup;
 *   the partially-migrated blob still flows through merge-over-defaults.
 *
 * Returns the migrated blob (stamped with `__schemaVersion = target` when it
 * advanced) plus the from/to versions so the caller can decide whether to
 * persist the upgraded file.
 */
export function migrateSettings(
  raw: Record<string, unknown>,
  target: number = SETTINGS_SCHEMA_VERSION,
  migrations: Record<number, SettingsMigration> = SETTINGS_MIGRATIONS,
): { data: Record<string, unknown>; from: number; to: number } {
  const recorded = raw[SCHEMA_VERSION_KEY];
  const from =
    typeof recorded === "number" && Number.isInteger(recorded) && recorded >= 0
      ? recorded
      : 0;

  // Downgrade case: a newer file opened by an older app. Don't run anything
  // backward; hand it back as-is (unknown future fields get dropped later).
  if (from >= target) {
    return { data: raw, from, to: from };
  }

  let data = raw;
  for (let v = from; v < target; v++) {
    const migrate = migrations[v];
    if (!migrate) continue;
    try {
      data = migrate(data);
    } catch {
      // A broken migration must never prevent the app from starting.
      break;
    }
  }
  return { data: { ...data, [SCHEMA_VERSION_KEY]: target }, from, to: target };
}
