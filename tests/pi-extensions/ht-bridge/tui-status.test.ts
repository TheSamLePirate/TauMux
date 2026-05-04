/**
 * tui-status — `formatStatusLine` is the pure formatter behind the
 * footer pill. Pin the four shapes:
 *
 *   - inside τ-mux, workspace + surface known   → green dot, "τ-mux ws:0 surface:1"
 *   - inside τ-mux, workspace not yet resolved  → green dot, "τ-mux surface:1"
 *   - outside τ-mux                             → red dot,   "τ-mux (offline)"
 *   - no theme supplied                         → plain glyphs, no ANSI
 */

import { describe, expect, test } from "bun:test";
import { formatStatusLine } from "../../../pi-extensions/ht-bridge/observe/tui-status";
import type { SurfaceContext } from "../../../pi-extensions/ht-bridge/lib/surface-context";

const fakeTheme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
};

const FULL: SurfaceContext = {
  surfaceId: "surface:1",
  workspaceId: "ws:0",
  agentId: "pi:surface:1",
  inTauMux: true,
  cwd: "/Users/me/code/foo",
  fg: "zsh",
};
const PARTIAL: SurfaceContext = {
  surfaceId: "surface:1",
  workspaceId: null,
  agentId: "pi:surface:1",
  inTauMux: true,
  cwd: null,
  fg: null,
};
const OFFLINE: SurfaceContext = {
  surfaceId: "",
  workspaceId: null,
  agentId: "pi:1234",
  inTauMux: false,
  cwd: null,
  fg: null,
};

describe("formatStatusLine", () => {
  test("inside τ-mux with workspace + surface → green + both ids", () => {
    const out = formatStatusLine(fakeTheme, FULL);
    expect(out).toContain("<success>●</success>");
    expect(out).toContain("τ-mux ws:0 surface:1");
    expect(out).not.toContain("error");
    expect(out).not.toContain("offline");
  });

  test("inside τ-mux with workspace unresolved → green + surface only", () => {
    const out = formatStatusLine(fakeTheme, PARTIAL);
    expect(out).toContain("<success>●</success>");
    expect(out).toContain("τ-mux surface:1");
    expect(out).not.toContain("ws:");
  });

  test("outside τ-mux → red + (offline) label", () => {
    const out = formatStatusLine(fakeTheme, OFFLINE);
    expect(out).toContain("<error>●</error>");
    expect(out).toContain("τ-mux (offline)");
    expect(out).not.toContain("success");
  });

  test("no theme supplied → plain glyphs, no ANSI tags", () => {
    const out = formatStatusLine(null, FULL);
    expect(out).toContain("●");
    expect(out).toContain("τ-mux ws:0 surface:1");
    expect(out).not.toMatch(/<\/?(success|error|dim)>/);
  });

  test("never includes a workspace clause when workspaceId is null", () => {
    // Edge case: a surfaceId is present but workspace hasn't
    // resolved yet. Avoid printing a stale "workspace null" label.
    const out = formatStatusLine(fakeTheme, PARTIAL);
    expect(out).not.toMatch(/ws:|null/);
  });

  test("dot color is the only color marker on the offline pill", () => {
    const out = formatStatusLine(fakeTheme, OFFLINE);
    // Exactly one error-tagged glyph; the rest should be dim.
    const errorMatches = out.match(/<error>/g) ?? [];
    expect(errorMatches.length).toBe(1);
  });
});
