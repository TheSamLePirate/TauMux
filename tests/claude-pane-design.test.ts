/**
 * Pane v3 — τ-mux design-system conformance for the Claude Code pane.
 *
 * The v2 pane shipped with a Catppuccin palette inherited from the v1
 * hook bridge (#f5c2e7 / #1e1e2e / #cdd6f4). It worked, but it looked
 * like a different app pasted into τ-mux, and it broke the §7 identity
 * contract by rendering an agent session in the human colour. These
 * tests pin the design contract so a future edit can't drift back.
 */
import { afterAll, beforeAll, describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const CSS = readFileSync(
  join(import.meta.dir, "..", "src", "views", "terminal", "index.css"),
  "utf-8",
);

/** The pane's CSS block — from its banner to end of file. */
function claudeBlock(): string {
  const i = CSS.indexOf("/* ── Native Claude Code pane");
  expect(i).toBeGreaterThan(-1);
  return CSS.slice(i);
}

describe("§1 palette — TAU tokens only", () => {
  test("no raw hex colours in the pane block (all colour via var(--tau-*))", () => {
    // Allow nothing: every colour must come from a token so theme
    // changes and contrast work reach the pane for free.
    const hexes = [...claudeBlock().matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(
      (m) => m[0],
    );
    expect(hexes).toEqual([]);
  });

  test("the Catppuccin palette the v2 pane shipped with is gone", () => {
    const block = claudeBlock().toLowerCase();
    for (const dead of [
      "#f5c2e7",
      "#1e1e2e",
      "#cdd6f4",
      "#a6adc8",
      "#313244",
    ]) {
      expect(block).not.toContain(dead);
    }
  });

  test("accent is the agent amber, not the human cyan (§7)", () => {
    const block = claudeBlock();
    expect(block).toContain("var(--tau-agent)");
    // The pane must not paint itself with the human identity colour.
    expect(block).not.toContain("var(--tau-cyan)");
  });
});

describe("§3 shape + §10 motion", () => {
  test("radii come from the token scale (nothing above --tau-r-window)", () => {
    const radii = [...claudeBlock().matchAll(/border-radius:\s*([^;]+);/g)].map(
      (m) => m[1]!.trim(),
    );
    expect(radii.length).toBeGreaterThan(5);
    for (const r of radii) {
      const ok =
        r.includes("var(--tau-r-") || r === "50%" || /^\d(\.\d)?px$/.test(r);
      expect({ radius: r, ok }).toEqual({ radius: r, ok: true });
      // Any literal px radius must stay within the §3 cap of 12.
      const px = /^(\d+(?:\.\d+)?)px$/.exec(r);
      if (px) expect(Number(px[1])).toBeLessThanOrEqual(12);
    }
  });

  test("only canonical keyframes are referenced — no new ones declared", () => {
    const block = claudeBlock();
    expect(block).not.toContain("@keyframes");
    const used = [...block.matchAll(/animation:\s*([a-zA-Z-]+)/g)].map(
      (m) => m[1],
    );
    const allowed = new Set(["tauPulse", "tauBlink", "agent-msg-in", "none"]);
    for (const name of used) expect(allowed.has(name!)).toBe(true);
  });

  test("no glow shadows — only the focused pane may glow (§4)", () => {
    // Neutral depth shadows are fine; a coloured glow on pane chrome is
    // not (the focus glow belongs to `.tau-pane.is-focused` alone).
    const shadows = [...claudeBlock().matchAll(/box-shadow:\s*([^;]+);/g)].map(
      (m) => m[1]!,
    );
    for (const sh of shadows) {
      const neutral =
        sh.includes("var(--ht-pm-panel-shadow)") || sh.includes("rgb(0 0 0");
      expect({ shadow: sh, neutral }).toEqual({ shadow: sh, neutral: true });
      expect(sh).not.toContain("--tau-agent");
      expect(sh).not.toContain("--tau-cyan");
    }
  });
});

describe("§7 identity mapping", () => {
  test("a claude surface is an AGENT (amber), like the pi agent pane", async () => {
    const { surfaceIdentity } =
      await import("../src/views/terminal/surface-manager");
    expect(surfaceIdentity("claude")).toBe("agent");
    expect(surfaceIdentity("agent")).toBe("agent");
    // Everything the user drives stays cyan.
    expect(surfaceIdentity("terminal")).toBe("human");
    expect(surfaceIdentity("browser")).toBe("human");
    expect(surfaceIdentity("telegram")).toBe("human");
  });
});

describe("pane chrome uses the shared primitives", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
  });
  afterAll(async () => {
    await GlobalRegistrator.unregister();
  });

  test("identity dot + status badge carry the primitive classes", async () => {
    const { createClaudePaneView, destroyClaudePaneView } =
      await import("../src/views/terminal/claude-agent-pane");
    const noop = () => {};
    const view = createClaudePaneView("claude-agent:1", {
      onPrompt: noop,
      onInterrupt: noop,
      onSetMode: noop,
      onSetModel: noop,
      onListSessions: noop,
      onResume: noop,
      onNewSession: noop,
      onClose: noop,
      onFocus: noop,
      onSplit: noop,
    });
    // The dot is the shared IdentityDot in agent (amber) form, so the
    // pulse + focus-glow rules apply to it for free.
    expect(view.stateDotEl.className).toContain("tau-identity-dot");
    expect(view.stateDotEl.className).toContain("tau-identity-agent");
    expect(view.stateBadgeEl.className).toContain("tau-badge-status");
    expect(view.stateBadgeEl.textContent).toBe("idle");
    destroyClaudePaneView(view);
  });
});
