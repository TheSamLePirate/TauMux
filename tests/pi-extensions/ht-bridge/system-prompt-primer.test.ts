/**
 * system-prompt primer — pin the rendered text shape for both the
 * τ-mux and outside-τ-mux paths plus tool-flag gating.
 */

import { describe, expect, test } from "bun:test";
import { buildPrimer } from "../../../pi-extensions/ht-bridge/system-prompt/primer";
import {
  DEFAULT_CONFIG,
  type Config,
} from "../../../pi-extensions/ht-bridge/lib/config";

const CFG: Config = { ...DEFAULT_CONFIG };

const SURFACE = {
  surfaceId: "surface:7",
  workspaceId: "ws:2",
  agentId: "pi:surface:7",
  inTauMux: true,
  cwd: "/Users/me/code/foo",
  fg: "bun run dev",
};
const SURFACE_NO_WORKSPACE = {
  surfaceId: "surface:7",
  workspaceId: null,
  agentId: "pi:surface:7",
  inTauMux: true,
  cwd: null,
  fg: null,
};
const NO_SURFACE = {
  surfaceId: "",
  workspaceId: null,
  agentId: "pi:1234",
  inTauMux: false,
  cwd: null,
  fg: null,
};

describe("buildPrimer", () => {
  test("returns empty string when no surface (avoids touting unusable tools)", () => {
    expect(buildPrimer(CFG, NO_SURFACE)).toBe("");
  });

  test("includes surface id when in τ-mux", () => {
    const out = buildPrimer(CFG, SURFACE);
    expect(out).toContain("surface:7");
  });

  test("enumerates only enabled ht_* tools", () => {
    const out = buildPrimer(CFG, SURFACE);
    expect(out).toContain("ht_ask_user");
    expect(out).toContain("ht_plan_set");
    expect(out).toContain("ht_browser_open");
    expect(out).toContain("ht_notify");
    expect(out).toContain("ht_screenshot");
    expect(out).toContain("ht_run_in_split");
  });

  test("mentions workspace id when known", () => {
    expect(buildPrimer(CFG, SURFACE)).toMatch(/workspace `ws:2`/);
  });

  test("omits workspace clause when not yet resolved", () => {
    const out = buildPrimer(CFG, SURFACE_NO_WORKSPACE);
    expect(out).toContain("surface:7");
    expect(out).not.toMatch(/workspace `/);
  });

  test("includes pane cwd when known", () => {
    expect(buildPrimer(CFG, SURFACE)).toMatch(
      /Pane cwd: `\/Users\/me\/code\/foo`/,
    );
  });

  test("disabling toolRunInSplitEnabled removes the tool and its nudge", () => {
    const out = buildPrimer({ ...CFG, toolRunInSplitEnabled: false }, SURFACE);
    expect(out).not.toContain("ht_run_in_split");
  });

  test("disabling toolsEnabled hides every ht_* tool", () => {
    const out = buildPrimer({ ...CFG, toolsEnabled: false }, SURFACE);
    expect(out).not.toContain("ht_ask_user");
    expect(out).not.toContain("ht_plan_set");
    expect(out).not.toContain("ht_browser_open");
  });

  test("disabling individual tool flags hides that tool only", () => {
    const out = buildPrimer({ ...CFG, toolBrowserEnabled: false }, SURFACE);
    expect(out).not.toContain("ht_browser_open");
    expect(out).toContain("ht_ask_user");
  });

  test("bashSafetyMode=off omits the gate paragraph", () => {
    const out = buildPrimer({ ...CFG, bashSafetyMode: "off" }, SURFACE);
    expect(out).not.toMatch(/confirmation modal/i);
  });

  test("bashSafetyMode=confirmAll uses the stricter wording", () => {
    const out = buildPrimer({ ...CFG, bashSafetyMode: "confirmAll" }, SURFACE);
    expect(out).toMatch(/Every `bash` call/);
  });

  test("primer ends with a guideline block when tools are present", () => {
    const out = buildPrimer(CFG, SURFACE);
    expect(out).toMatch(/Use these tools sparingly/);
  });
});
