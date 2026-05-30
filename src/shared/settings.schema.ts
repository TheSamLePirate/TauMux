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

// P7 S15 — enum factory for string-union fields (cursorStyle,
// packageRunner, layoutVariant, chromeTheme, workspaceCardDensity,
// browserSearchEngine, browserPartitionMode, webMirrorBind). Anything
// outside the allowed set falls back to default.
export function enumStr<T extends string>(
  def: T,
  allowed: readonly T[],
): FieldSchema<T> {
  const set = new Set<string>(allowed);
  return {
    default: def,
    validate(input) {
      return typeof input === "string" && set.has(input) ? (input as T) : def;
    },
  };
}

// P7 S15 — string-trim factory. Used by free-text fields that flow
// into network calls / file paths: webMirrorAuthToken, telegramBotToken,
// browserHomePage. Coerces null/undefined to "", then trims; non-string
// input becomes "".
export function stringTrim(def: string = ""): FieldSchema<string> {
  return {
    default: def,
    validate(input) {
      if (typeof input === "string") return input.trim();
      if (input == null) return def;
      return def;
    },
  };
}

// P7 S16 — pass-through string factory. Used by shellPath / fontFamily
// where the prior code spread the input through validateSettings
// without any guard. Coerces non-strings to default but does NOT trim
// (callers that need trimming use `stringTrim()` instead).
export function string(def: string = ""): FieldSchema<string> {
  return {
    default: def,
    validate(input) {
      return typeof input === "string" ? input : def;
    },
  };
}

// P7 S17 — wrapper factory for fields whose validation needs a custom
// helper (nested records, multi-field interlocks, etc.). The helper
// owns the validation; the schema just provides the default + a
// uniform call-site. Used by `autoContinue` (delegates to
// `validateAutoContinue`).
export function wrapped<T>(
  def: T,
  validator: (input: unknown) => T,
): FieldSchema<T> {
  return {
    default: def,
    validate: validator,
  };
}

// P7 S16 — nullable-string factory with non-empty guard. Used by
// `auditsGitUserNameExpected`: `null` means "opt out of the audit",
// any non-empty string is the expected git user, and anything else
// (missing, undefined, empty string, non-string) falls back to the
// documented default. Mirrors the prior inline `=== null ? null :
// typeof X === "string" && X.length > 0 ? X : default` chain.
export function nullableString(def: string | null): FieldSchema<string | null> {
  return {
    default: def,
    validate(input) {
      if (input === null) return null;
      if (typeof input === "string" && input.length > 0) return input;
      return def;
    },
  };
}

// P7 S15 — string-array factory. Used by statusBarKeys / htStatusKeyOrder
// / htStatusKeyHidden — filters input to non-empty strings; non-array
// input falls back to default.
export function stringArray(def: readonly string[]): FieldSchema<string[]> {
  const defCopy = [...def];
  return {
    default: defCopy,
    validate(input) {
      if (!Array.isArray(input)) return [...defCopy];
      return input.filter(
        (k): k is string => typeof k === "string" && k.length > 0,
      );
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

  // S15 enum batch
  cursorStyle: enumStr("block" as "block" | "bar" | "underline", [
    "block",
    "bar",
    "underline",
  ]),
  packageRunner: enumStr("bun" as "bun" | "npm" | "pnpm" | "yarn", [
    "bun",
    "npm",
    "pnpm",
    "yarn",
  ]),
  layoutVariant: enumStr("bridge" as "bridge" | "cockpit" | "atlas", [
    "bridge",
    "cockpit",
    "atlas",
  ]),
  chromeTheme: enumStr(
    "system" as "system" | "graphite-dark" | "graphite-light" | "high-contrast",
    ["system", "graphite-dark", "graphite-light", "high-contrast"],
  ),
  workspaceCardDensity: enumStr(
    "comfortable" as "compact" | "comfortable" | "spacious",
    ["compact", "comfortable", "spacious"],
  ),
  browserSearchEngine: enumStr(
    "google" as "google" | "duckduckgo" | "bing" | "kagi",
    ["google", "duckduckgo", "bing", "kagi"],
  ),
  browserPartitionMode: enumStr("per-surface" as "shared" | "per-surface", [
    "shared",
    "per-surface",
  ]),
  webMirrorBind: enumStr("0.0.0.0" as "127.0.0.1" | "0.0.0.0", [
    "127.0.0.1",
    "0.0.0.0",
  ]),

  // W2 — opt-in RPC socket token enforcement. boolStrict so only a real
  // boolean flips it (a stray truthy value can't silently enable a
  // security mode).
  rpcSocketRequireToken: boolStrict(false),

  // S15 string-trim batch
  webMirrorAuthToken: stringTrim(""),
  telegramBotToken: stringTrim(""),
  browserHomePage: stringTrim(""),

  // S15 string-array batch. statusBarKeys default mirrors DEFAULT_SETTINGS
  // (11 keys including procs / ht-all / ports). The prior inline
  // validator fell back to an 8-key subset; folding through the schema
  // unifies both paths on the documented fresh-install default — a
  // corrupt-config user now gets the full set after restart instead of
  // missing procs / ht-all / ports.
  statusBarKeys: stringArray([
    "workspace",
    "panes",
    "cpu",
    "mem",
    "procs",
    "fg",
    "cwd",
    "branch",
    "ht-all",
    "ports",
    "time",
  ]),
  htStatusKeyOrder: stringArray([]),
  htStatusKeyHidden: stringArray([]),

  // S15 !!-bool batch (coercing, not strict)
  bloomMigratedToTau: bool(false),
  browserForceDarkMode: bool(false),
  browserInterceptTerminalLinks: bool(false),
  telegramEnabled: bool(false),
  telegramNotificationsEnabled: bool(false),

  // S16 final-simple batch. These five fields previously flowed through
  // validateSettings via the unmodified `...s` spread with no guard at
  // all — folding them onto the schema closes silent gaps where a
  // non-boolean cursorBlink or non-string shellPath could slip through
  // unchanged. shellPath / fontFamily are pass-through `string()`
  // (no trim) to match prior behaviour.
  terminalBloom: bool(false),
  cursorBlink: bool(true),
  autoStartWebMirror: bool(false),
  shellPath: string(""),
  fontFamily: string(
    "'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Berkeley Mono', 'SF Mono', 'Menlo', monospace",
  ),

  // S16 nullable-string batch. auditsGitUserNameExpected: null opts out
  // of the audit, any non-empty string is the expected git user.
  // H0g: default null (opt-out) — never ship a specific person's username.
  auditsGitUserNameExpected: nullableString(null),
} as const;

export type SchemaFieldName = keyof typeof SETTINGS_FIELD_SCHEMAS;
