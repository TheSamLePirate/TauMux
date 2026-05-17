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
  numberRange,
  numberRangeStrict,
} from "../src/shared/settings.schema";
import {
  DEFAULT_SETTINGS,
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
