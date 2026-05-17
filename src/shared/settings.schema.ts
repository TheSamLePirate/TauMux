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

// Migrated subset: all the simple primitive fields whose validator is
// either a numeric clamp or a boolean coercion. Strings / enums / array
// fields stay on the per-clause path in `validateSettings` for now —
// they'll fold in when the seam is broadened in a later session.
export const SETTINGS_FIELD_SCHEMAS = {
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
} as const;

export type SchemaFieldName = keyof typeof SETTINGS_FIELD_SCHEMAS;
