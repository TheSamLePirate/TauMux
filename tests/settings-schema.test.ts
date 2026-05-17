// P7 S13 — F.6 typed FieldSchema seam.
//
// Pins the validation behaviour that `validateSettings` previously did
// inline so the seam can't silently drift from the historical clamp /
// coerce semantics.

import { describe, expect, test } from "bun:test";
import {
  SETTINGS_FIELD_SCHEMAS,
  bool,
  boolStrict,
  enumStr,
  nullableString,
  numberRange,
  numberRangeStrict,
  string,
  stringArray,
  stringTrim,
  wrapped,
} from "../src/shared/settings.schema";
import {
  ACCENT_COLOR_SCHEMA,
  ANSI_COLORS_SCHEMA,
  AUTO_CONTINUE_SCHEMA,
  BG_BASE_SCHEMA,
  DEFAULT_ANSI_COLORS,
  DEFAULT_SETTINGS,
  FOREGROUND_COLOR_SCHEMA,
  SECONDARY_COLOR_SCHEMA,
  THEME_PRESETS,
  THEME_PRESET_SCHEMA,
  validateSettings,
  type AppSettings,
} from "../src/shared/settings";

describe("FieldSchema factories", () => {
  test("numberRange clamps within [min, max]", () => {
    const s = numberRange(5, 0, 10);
    expect(s.validate(-1)).toBe(0);
    expect(s.validate(0)).toBe(0);
    expect(s.validate(5)).toBe(5);
    expect(s.validate(10)).toBe(10);
    expect(s.validate(99)).toBe(10);
  });

  test("numberRange rounds when opts.round is set", () => {
    const s = numberRange(5, 0, 10, { round: true });
    expect(s.validate(3.4)).toBe(3);
    expect(s.validate(3.6)).toBe(4);
  });

  test("numberRange falls back to default for non-finite / non-numeric input", () => {
    const s = numberRange(7, 0, 100);
    expect(s.validate(Number.NaN)).toBe(7);
    expect(s.validate(Infinity)).toBe(7);
    expect(s.validate(-Infinity)).toBe(7);
    expect(s.validate("nope" as unknown)).toBe(7);
    expect(s.validate(undefined)).toBe(7);
  });

  test("bool coerces non-boolean input via !!", () => {
    const s = bool(true);
    expect(s.validate(true)).toBe(true);
    expect(s.validate(false)).toBe(false);
    expect(s.validate(1 as unknown)).toBe(true);
    expect(s.validate(0 as unknown)).toBe(false);
    expect(s.validate("" as unknown)).toBe(false);
    expect(s.validate("x" as unknown)).toBe(true);
  });
});

describe("SETTINGS_FIELD_SCHEMAS defaults match DEFAULT_SETTINGS", () => {
  test("every migrated field's schema default equals DEFAULT_SETTINGS", () => {
    for (const [name, schema] of Object.entries(SETTINGS_FIELD_SCHEMAS)) {
      const key = name as keyof typeof SETTINGS_FIELD_SCHEMAS;
      expect(schema.default).toEqual(DEFAULT_SETTINGS[key] as never);
    }
  });
});

describe("validateSettings uses the schema for migrated fields", () => {
  test("clamps numeric ranges identically to the prior inline logic", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      scrollbackLines: 99,
      fontSize: 4,
      lineHeight: 5,
      terminalBgOpacity: 2,
      bloomIntensity: 9,
      webMirrorPort: 0,
      paneGap: -3,
      sidebarWidth: 99,
      notificationSoundVolume: -1,
    } as AppSettings);
    expect(out.scrollbackLines).toBe(100);
    expect(out.fontSize).toBe(8);
    expect(out.lineHeight).toBe(2);
    expect(out.terminalBgOpacity).toBe(1);
    expect(out.bloomIntensity).toBe(2);
    expect(out.webMirrorPort).toBe(1);
    expect(out.paneGap).toBe(0);
    expect(out.sidebarWidth).toBe(200);
    expect(out.notificationSoundVolume).toBe(0);
  });

  test("rounds the round-flagged numeric fields", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      scrollbackLines: 12345.7,
      fontSize: 12.4,
      webMirrorPort: 3001.6,
      paneGap: 3.4,
      sidebarWidth: 250.6,
    } as AppSettings);
    expect(out.scrollbackLines).toBe(12346);
    expect(out.fontSize).toBe(12);
    expect(out.webMirrorPort).toBe(3002);
    expect(out.paneGap).toBe(3);
    expect(out.sidebarWidth).toBe(251);
  });

  test("coerces notificationSoundEnabled to a boolean", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      notificationSoundEnabled: 1 as unknown as boolean,
    });
    expect(out.notificationSoundEnabled).toBe(true);
    const out2 = validateSettings({
      ...DEFAULT_SETTINGS,
      notificationSoundEnabled: 0 as unknown as boolean,
    });
    expect(out2.notificationSoundEnabled).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────
// P7 S14 — strict-bool + strict-number batch
// ──────────────────────────────────────────────────────────────────

describe("FieldSchema factories — strict variants (S14)", () => {
  test("boolStrict returns the input when boolean, default otherwise", () => {
    const s = boolStrict(true);
    expect(s.validate(true)).toBe(true);
    expect(s.validate(false)).toBe(false);
    // Non-boolean inputs fall back to default — NOT !!-coerced.
    expect(s.validate(1 as unknown)).toBe(true);
    expect(s.validate(0 as unknown)).toBe(true); // !!0 would be false; strict keeps default.
    expect(s.validate("" as unknown)).toBe(true);
    expect(s.validate(undefined)).toBe(true);
    expect(s.validate(null)).toBe(true);
    expect(s.validate("false" as unknown)).toBe(true);
  });

  test("boolStrict with default=false also keeps default on non-boolean", () => {
    const s = boolStrict(false);
    expect(s.validate(true)).toBe(true);
    expect(s.validate("anything" as unknown)).toBe(false);
    expect(s.validate(undefined)).toBe(false);
  });

  test("numberRangeStrict falls back on non-number / non-finite", () => {
    const s = numberRangeStrict(50, 0, 100);
    expect(s.validate(25)).toBe(25);
    expect(s.validate(-10)).toBe(0);
    expect(s.validate(200)).toBe(100);
    expect(s.validate(Number.NaN)).toBe(50);
    expect(s.validate(Infinity)).toBe(50);
    expect(s.validate("100" as unknown)).toBe(50);
    expect(s.validate(undefined)).toBe(50);
  });

  test("numberRangeStrict with floor option", () => {
    const s = numberRangeStrict(6000, 0, 60_000, { floor: true });
    expect(s.validate(1234.7)).toBe(1234);
    expect(s.validate(0.9)).toBe(0);
    expect(s.validate(-5)).toBe(0);
    expect(s.validate(100_000)).toBe(60_000);
  });
});

describe("validateSettings uses the schema for strict-bool fields (S14)", () => {
  test("strict-bool fields keep default for non-boolean input", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      // Force-cast bogus values past TypeScript.
      workspaceCardShowMeta: 0 as unknown as boolean,
      workspaceCardShowStats: undefined as unknown as boolean,
      terminalOsc94Enabled: "" as unknown as boolean,
      notificationOverlayEnabled: null as unknown as boolean,
    });
    // All defaults are true — strict keeps true regardless of input shape.
    expect(out.workspaceCardShowMeta).toBe(true);
    expect(out.workspaceCardShowStats).toBe(true);
    expect(out.terminalOsc94Enabled).toBe(true);
    expect(out.notificationOverlayEnabled).toBe(true);
  });

  test("strict-bool fields honour an explicit false", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      workspaceCardShowMeta: false,
      terminalOsc94Enabled: false,
      notificationOverlayEnabled: false,
    });
    expect(out.workspaceCardShowMeta).toBe(false);
    expect(out.terminalOsc94Enabled).toBe(false);
    expect(out.notificationOverlayEnabled).toBe(false);
  });

  test("strict-number fields clamp + floor identically to prior inline logic", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      notificationOverlayMs: 1234.7,
      workspaceFileExplorerMaxEntries: 99.4,
      legacyBloomIntensity: 5,
    });
    expect(out.notificationOverlayMs).toBe(1234);
    expect(out.workspaceFileExplorerMaxEntries).toBe(99);
    expect(out.legacyBloomIntensity).toBe(2);
  });

  test("strict-number fields fall back to default for non-finite input", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      notificationOverlayMs: "abc" as unknown as number,
      workspaceFileExplorerMaxEntries: Number.NaN,
      legacyBloomIntensity: "x" as unknown as number,
    });
    expect(out.notificationOverlayMs).toBe(6000);
    expect(out.workspaceFileExplorerMaxEntries).toBe(200);
    expect(out.legacyBloomIntensity).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────
// P7 S15 — enum + stringTrim + stringArray batch
// ──────────────────────────────────────────────────────────────────

describe("FieldSchema factories — enum / stringTrim / stringArray (S15)", () => {
  test("enumStr returns input when in allowed set, default otherwise", () => {
    const s = enumStr("a" as "a" | "b" | "c", ["a", "b", "c"]);
    expect(s.validate("a")).toBe("a");
    expect(s.validate("b")).toBe("b");
    expect(s.validate("c")).toBe("c");
    expect(s.validate("d")).toBe("a");
    expect(s.validate("")).toBe("a");
    expect(s.validate(42 as unknown)).toBe("a");
    expect(s.validate(undefined)).toBe("a");
  });

  test("stringTrim trims valid strings, defaults non-strings", () => {
    const s = stringTrim("fallback");
    expect(s.validate("  hello  ")).toBe("hello");
    expect(s.validate("")).toBe("");
    expect(s.validate(undefined)).toBe("fallback");
    expect(s.validate(null)).toBe("fallback");
    expect(s.validate(123 as unknown)).toBe("fallback");
  });

  test("stringArray filters to non-empty strings + defaults non-arrays", () => {
    const s = stringArray(["a", "b"]);
    expect(s.validate(["x", "y", "z"])).toEqual(["x", "y", "z"]);
    expect(s.validate(["x", "", 1 as unknown, "y"])).toEqual(["x", "y"]);
    expect(s.validate("not-an-array" as unknown)).toEqual(["a", "b"]);
    expect(s.validate(null)).toEqual(["a", "b"]);
    // Default should be a fresh array (no shared mutation).
    const out = s.validate(null) as string[];
    out.push("mutated");
    expect(s.validate(null)).toEqual(["a", "b"]);
  });
});

describe("validateSettings uses the schema for S15 enum / string / array fields", () => {
  test("enum fields keep default for unknown values", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      cursorStyle: "spaceship" as never,
      packageRunner: "rustpkg" as never,
      layoutVariant: "exotica" as never,
      chromeTheme: "neon" as never,
      workspaceCardDensity: "tiny" as never,
      browserSearchEngine: "bingbong" as never,
      browserPartitionMode: "ephemeral" as never,
      webMirrorBind: "10.0.0.1" as never,
    });
    expect(out.cursorStyle).toBe("block");
    expect(out.packageRunner).toBe("bun");
    expect(out.layoutVariant).toBe("bridge");
    expect(out.chromeTheme).toBe("system");
    expect(out.workspaceCardDensity).toBe("comfortable");
    expect(out.browserSearchEngine).toBe("google");
    expect(out.browserPartitionMode).toBe("per-surface");
    expect(out.webMirrorBind).toBe("0.0.0.0");
  });

  test("enum fields honour valid values", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      cursorStyle: "bar",
      packageRunner: "pnpm",
      layoutVariant: "atlas",
      chromeTheme: "graphite-light",
      browserPartitionMode: "shared",
      webMirrorBind: "127.0.0.1",
    });
    expect(out.cursorStyle).toBe("bar");
    expect(out.packageRunner).toBe("pnpm");
    expect(out.layoutVariant).toBe("atlas");
    expect(out.chromeTheme).toBe("graphite-light");
    expect(out.browserPartitionMode).toBe("shared");
    expect(out.webMirrorBind).toBe("127.0.0.1");
  });

  test("string-trim fields trim whitespace + handle null/undefined", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      webMirrorAuthToken: "  secret  ",
      telegramBotToken: " 1234:abc ",
      browserHomePage: " https://example.com ",
    });
    expect(out.webMirrorAuthToken).toBe("secret");
    expect(out.telegramBotToken).toBe("1234:abc");
    expect(out.browserHomePage).toBe("https://example.com");

    const out2 = validateSettings({
      ...DEFAULT_SETTINGS,
      webMirrorAuthToken: null as unknown as string,
      telegramBotToken: undefined as unknown as string,
    });
    expect(out2.webMirrorAuthToken).toBe("");
    expect(out2.telegramBotToken).toBe("");
  });

  test("string-array fields filter junk + fall back to default for non-arrays", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      statusBarKeys: ["custom1", "", 0 as unknown as string, "custom2"],
      htStatusKeyOrder: "not an array" as unknown as string[],
      htStatusKeyHidden: ["hidden1"],
    });
    expect(out.statusBarKeys).toEqual(["custom1", "custom2"]);
    expect(out.htStatusKeyOrder).toEqual([]);
    expect(out.htStatusKeyHidden).toEqual(["hidden1"]);
  });

  test("!!-bool batch coerces non-boolean input", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      telegramEnabled: 1 as unknown as boolean,
      bloomMigratedToTau: "" as unknown as boolean,
    });
    expect(out.telegramEnabled).toBe(true);
    expect(out.bloomMigratedToTau).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────
// P7 S16 — string / nullableString + final-simple batch
// ──────────────────────────────────────────────────────────────────

describe("FieldSchema factories — string / nullableString (S16)", () => {
  test("string pass-through returns input when string, default otherwise", () => {
    const s = string("default");
    expect(s.validate("hello")).toBe("hello");
    expect(s.validate("  preserves whitespace  ")).toBe(
      "  preserves whitespace  ",
    );
    expect(s.validate("")).toBe("");
    expect(s.validate(undefined)).toBe("default");
    expect(s.validate(null)).toBe("default");
    expect(s.validate(42 as unknown)).toBe("default");
  });

  test("nullableString accepts null, non-empty string, or default", () => {
    const s = nullableString("fallback");
    expect(s.validate(null)).toBe(null);
    expect(s.validate("alice")).toBe("alice");
    expect(s.validate("")).toBe("fallback");
    expect(s.validate(undefined)).toBe("fallback");
    expect(s.validate(42 as unknown)).toBe("fallback");
  });
});

describe("validateSettings uses the schema for S16 final-simple fields", () => {
  test("five previously-unguarded fields now coerce non-matching input", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      // None of these were validated before; non-matching input slipped
      // through. They MUST now fall back to default.
      terminalBloom: 1 as unknown as boolean,
      cursorBlink: "yes" as unknown as boolean,
      autoStartWebMirror: 0 as unknown as boolean,
      shellPath: 42 as unknown as string,
      fontFamily: null as unknown as string,
    });
    // bool() does !!-coerce, so 1→true, 0→false, "yes"→true.
    expect(out.terminalBloom).toBe(true);
    expect(out.cursorBlink).toBe(true);
    expect(out.autoStartWebMirror).toBe(false);
    // string() falls back to default for non-string input.
    expect(out.shellPath).toBe("");
    expect(out.fontFamily).toContain("JetBrainsMono"); // default
  });

  test("auditsGitUserNameExpected honours null + non-empty + fallback", () => {
    const optedOut = validateSettings({
      ...DEFAULT_SETTINGS,
      auditsGitUserNameExpected: null,
    });
    expect(optedOut.auditsGitUserNameExpected).toBe(null);

    const custom = validateSettings({
      ...DEFAULT_SETTINGS,
      auditsGitUserNameExpected: "alice",
    });
    expect(custom.auditsGitUserNameExpected).toBe("alice");

    const empty = validateSettings({
      ...DEFAULT_SETTINGS,
      auditsGitUserNameExpected: "" as string,
    });
    expect(empty.auditsGitUserNameExpected).toBe("olivierveinand");
  });

  test("shellPath / fontFamily pass through string input verbatim", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      shellPath: "/bin/zsh",
      fontFamily: "Comic Sans MS",
    });
    expect(out.shellPath).toBe("/bin/zsh");
    expect(out.fontFamily).toBe("Comic Sans MS");
  });
});

// ──────────────────────────────────────────────────────────────────
// P7 S17 — wrapped() factory + AUTO_CONTINUE_SCHEMA
// ──────────────────────────────────────────────────────────────────

describe("FieldSchema factory — wrapped (S17)", () => {
  test("wrapped delegates validation to the supplied helper", () => {
    const helper = (input: unknown): string => {
      return typeof input === "string" ? input.toUpperCase() : "FALLBACK";
    };
    const s = wrapped("FALLBACK", helper);
    expect(s.default).toBe("FALLBACK");
    expect(s.validate("hello")).toBe("HELLO");
    expect(s.validate(undefined)).toBe("FALLBACK");
    expect(s.validate(42 as unknown)).toBe("FALLBACK");
  });

  test("AUTO_CONTINUE_SCHEMA exposes the validateAutoContinue helper through the seam", () => {
    expect(AUTO_CONTINUE_SCHEMA.default).toEqual(DEFAULT_SETTINGS.autoContinue);

    // Non-object input → fresh copy of default.
    const fromNull = AUTO_CONTINUE_SCHEMA.validate(null);
    expect(fromNull).toEqual(DEFAULT_SETTINGS.autoContinue);
    // Sanity: not the same reference.
    expect(fromNull).not.toBe(DEFAULT_SETTINGS.autoContinue);

    // Engine sanitisation flows through.
    const fromBogus = AUTO_CONTINUE_SCHEMA.validate({
      engine: "nonsense",
      dryRun: "not a bool",
      cooldownMs: -5,
      maxConsecutive: 999,
      modelName: "  custom-haiku  ",
      modelApiKeyEnv: "  MY_KEY  ",
    });
    expect(fromBogus.engine).toBe("off");
    // dryRun non-boolean → fallback to default (true).
    expect(fromBogus.dryRun).toBe(DEFAULT_SETTINGS.autoContinue.dryRun);
    // cooldown clamps to >= 0.
    expect(fromBogus.cooldownMs).toBe(0);
    // maxConsecutive clamps to <= 50.
    expect(fromBogus.maxConsecutive).toBe(50);
    // Strings trim.
    expect(fromBogus.modelName).toBe("custom-haiku");
    expect(fromBogus.modelApiKeyEnv).toBe("MY_KEY");
  });

  test("validateSettings routes autoContinue through AUTO_CONTINUE_SCHEMA", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      autoContinue: {
        engine: "hybrid",
        dryRun: false,
        cooldownMs: 2000,
        maxConsecutive: 5,
        modelProvider: "anthropic",
        modelName: "claude-haiku-4-5",
        modelApiKeyEnv: "ANTHROPIC_API_KEY",
      },
    });
    expect(out.autoContinue.engine).toBe("hybrid");
    expect(out.autoContinue.dryRun).toBe(false);
    expect(out.autoContinue.cooldownMs).toBe(2000);
    expect(out.autoContinue.maxConsecutive).toBe(5);
  });
});

// ──────────────────────────────────────────────────────────────────
// P7 S20 — theme-preset interlock (final F.6 batch)
// ──────────────────────────────────────────────────────────────────

describe("Theme-preset interlock schemas (S20)", () => {
  test("THEME_PRESET_SCHEMA accepts any known preset id; rejects unknown", () => {
    expect(THEME_PRESET_SCHEMA.default).toBe(THEME_PRESETS[0].id);
    for (const preset of THEME_PRESETS) {
      expect(THEME_PRESET_SCHEMA.validate(preset.id)).toBe(preset.id);
    }
    expect(THEME_PRESET_SCHEMA.validate("nonexistent")).toBe(
      THEME_PRESETS[0].id,
    );
    expect(THEME_PRESET_SCHEMA.validate(42 as unknown)).toBe(
      THEME_PRESETS[0].id,
    );
    expect(THEME_PRESET_SCHEMA.validate(undefined)).toBe(THEME_PRESETS[0].id);
  });

  test("colour schemas pass string input through verbatim", () => {
    expect(ACCENT_COLOR_SCHEMA.validate("#ff00ff")).toBe("#ff00ff");
    expect(SECONDARY_COLOR_SCHEMA.validate("rgb(1,2,3)")).toBe("rgb(1,2,3)");
    expect(FOREGROUND_COLOR_SCHEMA.validate("white")).toBe("white");
    expect(BG_BASE_SCHEMA.validate("0,0,0")).toBe("0,0,0");
  });

  test("colour schemas fall back to default for non-string input", () => {
    expect(ACCENT_COLOR_SCHEMA.validate(42 as unknown)).toBe(
      THEME_PRESETS[0].accentColor,
    );
    expect(BG_BASE_SCHEMA.validate(null)).toBe(THEME_PRESETS[0].bgBase);
  });

  test("ANSI_COLORS_SCHEMA returns a fresh default for non-object input", () => {
    const out = ANSI_COLORS_SCHEMA.validate(null);
    expect(out).toEqual(DEFAULT_ANSI_COLORS);
    expect(out).not.toBe(DEFAULT_ANSI_COLORS);
  });

  test("ANSI_COLORS_SCHEMA passes string entries through + defaults missing ones", () => {
    const out = ANSI_COLORS_SCHEMA.validate({
      red: "#ff0000",
      green: 42, // wrong type → default
      brightCyan: "#00ffff",
    });
    expect(out.red).toBe("#ff0000");
    expect(out.green).toBe(DEFAULT_ANSI_COLORS.green); // junked
    expect(out.brightCyan).toBe("#00ffff");
    // Missing keys → default values for ALL of the canonical 16.
    expect(out.brightBlack).toBe(DEFAULT_ANSI_COLORS.brightBlack);
    expect(out.white).toBe(DEFAULT_ANSI_COLORS.white);
  });

  test("validateSettings sanitises the 6 theme fields end-to-end", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      themePreset: "made-up" as string,
      accentColor: 0 as unknown as string,
      secondaryColor: undefined as unknown as string,
      foregroundColor: "#abc123",
      bgBase: null as unknown as string,
      ansiColors: { red: "#ff0000", garbage: 42 } as unknown as never,
    });
    expect(out.themePreset).toBe(THEME_PRESETS[0].id);
    expect(out.accentColor).toBe(THEME_PRESETS[0].accentColor);
    expect(out.secondaryColor).toBe(THEME_PRESETS[0].secondaryColor);
    expect(out.foregroundColor).toBe("#abc123"); // string → pass-through
    expect(out.bgBase).toBe(THEME_PRESETS[0].bgBase);
    expect(out.ansiColors.red).toBe("#ff0000");
    // The extraneous `garbage` key is silently dropped.
    expect((out.ansiColors as Record<string, unknown>)["garbage"]).toBe(
      undefined,
    );
  });
});
