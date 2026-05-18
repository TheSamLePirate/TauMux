// P8 S4 — wire tau-focus-audit into bun test.
//
// The audit was previously DevTools-only ("Not wired into `bun test`
// because it needs a live webview"). This test pulls it into the
// regular suite via happy-dom so a chromatic-glow leak in chrome CSS
// fails the build instead of waiting for someone to open DevTools.
//
// Coverage:
//   - splitShadows parses multi-layer shadows including commas inside
//     rgba() parens.
//   - isGlow distinguishes the four classes (chromatic glow, near-zero
//     alpha fade, pure-black elevation, sub-4px blur).
//   - auditFocusGlow against a fixture DOM:
//       * baseline (no glow) reports zero hits
//       * focused-pane glow shows up as role="focus" (expected)
//       * non-pane chrome with a chromatic glow shows up as role="leak"

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

beforeEach(() => {
  document.body.innerHTML = "";
});

// Imported lazily so happy-dom's `window` is already in place.
let auditModule: typeof import("../src/views/terminal/tau-focus-audit");
beforeAll(async () => {
  auditModule = await import("../src/views/terminal/tau-focus-audit");
});

describe("tau-focus-audit — splitShadows", () => {
  test("returns [] for 'none' and empty input", () => {
    // Access via the module's exported auditFocusGlow indirectly — but
    // splitShadows is internal. We exercise it via auditFocusGlow with
    // a fixture; splitShadows is also covered by every isGlow case.
    // Direct sanity: an element with `box-shadow: none` produces zero
    // hits regardless of selector.
    const tau = document.createElement("div");
    tau.className = "tau-pane is-focused";
    tau.style.boxShadow = "none";
    document.body.appendChild(tau);
    expect(auditModule.auditFocusGlow().length).toBe(0);
  });
});

describe("tau-focus-audit — isGlow classification", () => {
  function fixtureWithShadow(cls: string, boxShadow: string): HTMLElement {
    const el = document.createElement("div");
    el.className = cls;
    el.style.boxShadow = boxShadow;
    document.body.appendChild(el);
    return el;
  }

  test("pure-black elevation drop shadow does NOT count as a glow", () => {
    fixtureWithShadow("tau-pane", "0 4px 12px rgba(0, 0, 0, 0.45)");
    const hits = auditModule.auditFocusGlow();
    // Pure black is filtered out — even with blur 12 and alpha 0.45.
    expect(hits.length).toBe(0);
  });

  test("near-zero alpha fade does NOT count as a glow", () => {
    fixtureWithShadow("tau-pane", "0 0 8px rgba(111, 233, 255, 0.01)");
    expect(auditModule.auditFocusGlow().length).toBe(0);
  });

  test("sub-4px blur radius does NOT count as a glow", () => {
    fixtureWithShadow("tau-pane", "0 0 2px rgba(111, 233, 255, 0.6)");
    expect(auditModule.auditFocusGlow().length).toBe(0);
  });

  test("cyan glow at blur 8 + alpha 0.6 DOES count", () => {
    fixtureWithShadow("tau-pane", "0 0 8px rgba(111, 233, 255, 0.6)");
    const hits = auditModule.auditFocusGlow();
    expect(hits.length).toBe(1);
    expect(hits[0].shadow).toContain("rgba(111, 233, 255, 0.6)");
  });
});

describe("tau-focus-audit — role classification", () => {
  test("focused pane glow is reported with role='focus'", () => {
    const pane = document.createElement("div");
    pane.className = "tau-pane is-focused";
    pane.style.boxShadow = "0 0 12px rgba(111, 233, 255, 0.65)";
    document.body.appendChild(pane);
    const hits = auditModule.auditFocusGlow();
    expect(hits.length).toBe(1);
    expect(hits[0].role).toBe("focus");
  });

  test("non-pane chrome glow is reported with role='leak'", () => {
    // Build a #sidebar > .sidebar-new-btn fixture with a cyan halo —
    // that's exactly the kind of drift the audit catches.
    const sidebar = document.createElement("div");
    sidebar.id = "sidebar";
    const btn = document.createElement("button");
    btn.className = "sidebar-new-btn";
    btn.style.boxShadow = "0 0 10px rgba(111, 233, 255, 0.5)";
    sidebar.appendChild(btn);
    document.body.appendChild(sidebar);
    const hits = auditModule.auditFocusGlow();
    expect(hits.length).toBe(1);
    expect(hits[0].role).toBe("leak");
    expect(hits[0].selector).toContain("sidebar-new-btn");
  });

  test("multi-layer shadow with one glow layer reports only that layer", () => {
    const pane = document.createElement("div");
    pane.className = "tau-pane is-focused";
    // Two layers: pure-black elevation + cyan focus halo.
    pane.style.boxShadow =
      "0 4px 12px rgba(0, 0, 0, 0.45), 0 0 10px rgba(111, 233, 255, 0.6)";
    document.body.appendChild(pane);
    const hits = auditModule.auditFocusGlow();
    // Only the cyan layer counts; the black drop shadow is filtered.
    expect(hits.length).toBe(1);
    expect(hits[0].shadow).toContain("111, 233, 255");
  });

  test("clean room — no chrome with glow → empty result", () => {
    const sidebar = document.createElement("div");
    sidebar.id = "sidebar";
    const btn = document.createElement("button");
    btn.className = "sidebar-new-btn";
    // Standard hairline border — no shadow.
    sidebar.appendChild(btn);
    document.body.appendChild(sidebar);
    expect(auditModule.auditFocusGlow().length).toBe(0);
  });
});

describe("tau-focus-audit — global hook", () => {
  test("window.tauAuditFocus is exposed for DevTools use", () => {
    expect(typeof window.tauAuditFocus).toBe("function");
  });
});
