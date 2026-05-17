// Phase 7 / U2 — chrome theme settings field + wire projection.
//
// The theme tokens themselves are tested in
// `tests/web-theme-tokens.test.ts`. This file pins the settings
// contract: the AppSettings carries a `chromeTheme` field, the
// validator narrows unknown values to "system", the wire projection
// includes it, and the value round-trips.

import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SETTINGS,
  pickWebSettings,
  validateSettings,
  type AppSettings,
} from "../src/shared/settings";

describe("[U2] chromeTheme — default + validation", () => {
  it("DEFAULT_SETTINGS.chromeTheme is 'system'", () => {
    expect(DEFAULT_SETTINGS.chromeTheme).toBe("system");
  });

  it("validateSettings accepts each of the four documented values", () => {
    for (const v of [
      "system",
      "graphite-dark",
      "graphite-light",
      "high-contrast",
    ] as const) {
      const out = validateSettings({
        ...DEFAULT_SETTINGS,
        chromeTheme: v,
      });
      expect(out.chromeTheme).toBe(v);
    }
  });

  it("validateSettings narrows unknown values to 'system'", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      chromeTheme: "dracula" as unknown as AppSettings["chromeTheme"],
    });
    expect(out.chromeTheme).toBe("system");
  });

  it("validateSettings narrows undefined / null to 'system'", () => {
    const a = validateSettings({
      ...DEFAULT_SETTINGS,
      chromeTheme: undefined as unknown as AppSettings["chromeTheme"],
    });
    const b = validateSettings({
      ...DEFAULT_SETTINGS,
      chromeTheme: null as unknown as AppSettings["chromeTheme"],
    });
    expect(a.chromeTheme).toBe("system");
    expect(b.chromeTheme).toBe("system");
  });
});

describe("[U2] chromeTheme — wire projection", () => {
  it("pickWebSettings includes chromeTheme in the mirror payload", () => {
    const wire = pickWebSettings({
      ...DEFAULT_SETTINGS,
      chromeTheme: "graphite-light",
    });
    expect(wire.chromeTheme).toBe("graphite-light");
  });

  it("pickWebSettings preserves 'system' default", () => {
    const wire = pickWebSettings(DEFAULT_SETTINGS);
    expect(wire.chromeTheme).toBe("system");
  });
});
