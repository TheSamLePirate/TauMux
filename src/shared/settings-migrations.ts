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
 *  a way that a plain merge-over-defaults can't recover. */
export const SETTINGS_SCHEMA_VERSION = 1;

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
 * `SETTINGS_MIGRATIONS[1]` turns a v1 blob into v2. Empty today — v1 is the
 * current shape. Example for a future rename:
 *
 *   export const SETTINGS_MIGRATIONS = {
 *     1: (s) => {
 *       const { oldName, ...rest } = s;
 *       return { ...rest, newName: oldName };
 *     },
 *   };
 */
export const SETTINGS_MIGRATIONS: Record<number, SettingsMigration> = {};

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
