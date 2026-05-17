// P7 S13 — F.6 typed FieldSchema seam.
//
// `settings.ts` validates ~50 fields inline with ad-hoc clamp / bool /
// enum guards. That's hard to introspect (no single source of truth for
// "what is the legal range of fontSize?") and every new field copies
// the pattern by hand. This file introduces a `FieldSchema<T>` seam
// that captures `default` + `validate` per field. Today we migrate the
// simplest 10 primitive fields as proof; future sessions can fold the
// rest in incrementally without churning the public AppSettings shape.

export interface FieldSchema<T> {
  readonly default: T;
  validate(input: unknown): T;
}

export function numberRange(
  def: number,
  min: number,
  max: number,
  opts: { round?: boolean } = {},
): FieldSchema<number> {
  return {
    default: def,
    validate(input) {
      const n =
        typeof input === "number" && Number.isFinite(input) ? input : def;
      const v = opts.round ? Math.round(n) : n;
      return Math.max(min, Math.min(max, v));
    },
  };
}

export function bool(def: boolean): FieldSchema<boolean> {
  return {
    default: def,
    validate(input) {
      return typeof input === "boolean" ? input : !!input;
    },
  };
}

// P7 S14 — strict-bool variant. Used by the workspace-card / overlay /
// telegram toggles where non-boolean input (undefined, missing, wrong
// type) MUST fall back to the documented default. `bool()` would
// `!!`-coerce non-booleans (so the string "false" becomes true);
// `boolStrict()` keeps the default in that case.
export function boolStrict(def: boolean): FieldSchema<boolean> {
  return {
    default: def,
    validate(input) {
      return typeof input === "boolean" ? input : def;
    },
  };
}

// P7 S14 — strict-number variant. Falls back to default on non-number
// / non-finite input BEFORE clamping. `floor` rounds toward zero (used
// by `notificationOverlayMs` whose validator originally floored to ms).
export function numberRangeStrict(
  def: number,
  min: number,
  max: number,
  opts: { round?: boolean; floor?: boolean } = {},
): FieldSchema<number> {
  return {
    default: def,
    validate(input) {
      if (typeof input !== "number" || !Number.isFinite(input)) return def;
      const v = opts.floor
        ? Math.floor(input)
        : opts.round
          ? Math.round(input)
          : input;
      return Math.max(min, Math.min(max, v));
    },
  };
}

// Migrated subset: simple primitive fields whose validator is either a
// numeric clamp or a boolean coercion. Strings / enums / array fields
// stay on the per-clause path in `validateSettings` for now — they'll
// fold in when the seam is broadened in a later session.
//
// S13 added the first 10 primitive fields. S14 adds the strict-bool
// batch (workspace-card show toggles, overlay enabled, telegram
// notification toggles, terminalOsc94, bloomMigratedToTau) + the three
// strict-number fields that previously had explicit `typeof X ===
// "number" && Number.isFinite` guards.
export const SETTINGS_FIELD_SCHEMAS = {
  // S13 batch
  scrollbackLines: numberRange(10000, 100, 100000, { round: true }),
  fontSize: numberRange(13, 8, 32, { round: true }),
  lineHeight: numberRange(1.0, 0.8, 2.0),
  terminalBgOpacity: numberRange(1, 0, 1),
  bloomIntensity: numberRange(0, 0, 2),
  webMirrorPort: numberRange(3000, 1, 65535, { round: true }),
  paneGap: numberRange(2, 0, 20, { round: true }),
  sidebarWidth: numberRange(320, 200, 600, { round: true }),
  notificationSoundEnabled: bool(true),
  notificationSoundVolume: numberRange(1.0, 0, 1),

  // S14 strict-bool batch
  telegramNotificationButtonsEnabled: boolStrict(false),
  telegramAskUserEnabled: boolStrict(false),
  terminalOsc94Enabled: boolStrict(true),
  notificationOverlayEnabled: boolStrict(true),
  workspaceCardShowMeta: boolStrict(true),
  workspaceCardShowStats: boolStrict(true),
  workspaceCardShowPanes: boolStrict(true),
  workspaceCardShowManifests: boolStrict(true),
  workspaceCardShowFileExplorer: boolStrict(true),
  workspaceFileExplorerShowHidden: boolStrict(false),
  workspaceCardShowStatusPills: boolStrict(true),
  workspaceCardShowProgress: boolStrict(true),

  // S14 strict-number batch
  notificationOverlayMs: numberRangeStrict(6000, 0, 60_000, { floor: true }),
  workspaceFileExplorerMaxEntries: numberRangeStrict(200, 20, 1000, {
    round: true,
  }),
  legacyBloomIntensity: numberRangeStrict(0, 0, 2),
} as const;

export type SchemaFieldName = keyof typeof SETTINGS_FIELD_SCHEMAS;
