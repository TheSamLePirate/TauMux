// Coverage for the workspace-card display preferences (Plan #06
// section B). Pure validation — no DOM, no SettingsManager. The
// integration with the sidebar (toggles → render branches) is
// exercised structurally by typecheck; visual verification is the
// deferred Section A item in the tracking doc.

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SETTINGS,
  validateSettings,
  type AppSettings,
} from "../src/shared/settings";

describe("AppSettings.workspaceCard*", () => {
  test("DEFAULT_SETTINGS exposes density + show toggles", () => {
    expect(DEFAULT_SETTINGS.workspaceCardDensity).toBe("comfortable");
    expect(DEFAULT_SETTINGS.workspaceCardShowMeta).toBe(true);
    expect(DEFAULT_SETTINGS.workspaceCardShowStats).toBe(true);
    expect(DEFAULT_SETTINGS.workspaceCardShowPanes).toBe(true);
    expect(DEFAULT_SETTINGS.workspaceCardShowManifests).toBe(true);
    expect(DEFAULT_SETTINGS.workspaceCardShowStatusPills).toBe(true);
    expect(DEFAULT_SETTINGS.workspaceCardShowProgress).toBe(true);
  });

  test("validateSettings preserves valid values", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      workspaceCardDensity: "compact",
      workspaceCardShowMeta: false,
      workspaceCardShowStats: true,
      workspaceCardShowPanes: false,
      workspaceCardShowManifests: false,
      workspaceCardShowStatusPills: true,
      workspaceCardShowProgress: false,
    } as AppSettings);
    expect(out.workspaceCardDensity).toBe("compact");
    expect(out.workspaceCardShowMeta).toBe(false);
    expect(out.workspaceCardShowStats).toBe(true);
    expect(out.workspaceCardShowPanes).toBe(false);
    expect(out.workspaceCardShowManifests).toBe(false);
    expect(out.workspaceCardShowStatusPills).toBe(true);
    expect(out.workspaceCardShowProgress).toBe(false);
  });

  test("validateSettings accepts spacious + retains it", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      workspaceCardDensity: "spacious",
    } as AppSettings);
    expect(out.workspaceCardDensity).toBe("spacious");
  });

  test("invalid density values fall back to comfortable", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      workspaceCardDensity:
        "huge" as unknown as AppSettings["workspaceCardDensity"],
    });
    expect(out.workspaceCardDensity).toBe("comfortable");
  });

  test("missing show toggles default to true (back-compat with pre-Plan-#06 configs)", () => {
    // Strip the new fields entirely — emulates a settings.json
    // written by a pre-revamp build.
    const stripped = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
    delete stripped["workspaceCardDensity"];
    delete stripped["workspaceCardShowMeta"];
    delete stripped["workspaceCardShowStats"];
    delete stripped["workspaceCardShowPanes"];
    delete stripped["workspaceCardShowManifests"];
    delete stripped["workspaceCardShowStatusPills"];
    delete stripped["workspaceCardShowProgress"];
    const out = validateSettings(stripped as AppSettings);
    expect(out.workspaceCardDensity).toBe("comfortable");
    expect(out.workspaceCardShowMeta).toBe(true);
    expect(out.workspaceCardShowStats).toBe(true);
    expect(out.workspaceCardShowPanes).toBe(true);
    expect(out.workspaceCardShowManifests).toBe(true);
    expect(out.workspaceCardShowStatusPills).toBe(true);
    expect(out.workspaceCardShowProgress).toBe(true);
  });

  test("non-boolean show fields fall back to true", () => {
    const out = validateSettings({
      ...DEFAULT_SETTINGS,
      // Numeric / string values would survive a corrupted JSON edit;
      // validation must coerce them to defaults rather than render
      // garbage at the renderer's `show.*` lookup.
      workspaceCardShowMeta: 0 as unknown as boolean,
      workspaceCardShowStats: "yes" as unknown as boolean,
    });
    expect(out.workspaceCardShowMeta).toBe(true);
    expect(out.workspaceCardShowStats).toBe(true);
  });
});
