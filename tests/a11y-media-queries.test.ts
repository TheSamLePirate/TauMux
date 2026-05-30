// Triple-A I.2+I.3 / U2+U3 — verify the three a11y media queries are
// present in both the native and mirror CSS files. Backfill from
// Phase 0 audit (PR 21).
//
// We can't render CSS-in-DOM here and assert computed styles under a
// forced media query (happy-dom's matchMedia is stub-only); instead
// we pin the @media block presence and the blanket-reduced-motion
// shape that catches every animation in one rule.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const NATIVE_CSS = readFileSync(
  join(import.meta.dir, "..", "src", "views", "terminal", "index.css"),
  "utf-8",
);
const MIRROR_CSS = readFileSync(
  join(import.meta.dir, "..", "src", "web-client", "client.css"),
  "utf-8",
);

const QUERIES = [
  "prefers-reduced-motion: reduce",
  "prefers-contrast: more",
  "forced-colors: active",
] as const;

describe("[U2+U3] a11y media queries — native CSS", () => {
  for (const q of QUERIES) {
    it(`@media (${q}) is present in src/views/terminal/index.css`, () => {
      expect(NATIVE_CSS).toContain(`@media (${q})`);
    });
  }

  // W3-2 (full_app_review_2026-05.md §19.1): the HCM / prefers-contrast
  // blocks targeted `.ask-user-modal`, a class the ask-user modal never
  // emits (it uses `.ask-user-sheet` / `.ask-user-overlay`), so the safety-
  // critical confirm-command prompt got NO high-contrast treatment. Pin the
  // real class is targeted and the dead one is gone so this can't recur.
  it("the ask-user contrast/HCM selector matches the class the modal emits", () => {
    const ASK_SHEET = readFileSync(
      join(
        import.meta.dir,
        "..",
        "src",
        "views",
        "terminal",
        "ask-user-modal.ts",
      ),
      "utf-8",
    );
    // The modal really produces `ask-user-sheet`.
    expect(ASK_SHEET).toContain('"ask-user-sheet"');
    // The contrast styling must target that class, not the phantom one.
    expect(NATIVE_CSS).toContain(".ask-user-sheet");
    expect(NATIVE_CSS).not.toContain(".ask-user-modal");
  });

  it("includes a blanket reduced-motion rule that catches every animation", () => {
    // The blanket rule is `*, *::before, *::after { animation-duration:
    // 0.001ms !important; transition-duration: 0.001ms !important; }`
    // inside a prefers-reduced-motion block. A future regression that
    // dropped the universal selector for per-component overrides would
    // miss every component added since.
    expect(NATIVE_CSS).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\*[\s\S]*?animation-duration:\s*0\.001ms[\s\S]*?!important/,
    );
  });
});

describe("[U2+U3] a11y media queries — mirror CSS", () => {
  for (const q of QUERIES) {
    it(`@media (${q}) is present in src/web-client/client.css`, () => {
      expect(MIRROR_CSS).toContain(`@media (${q})`);
    });
  }

  it("includes the same blanket reduced-motion rule as the native side", () => {
    expect(MIRROR_CSS).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\*[\s\S]*?animation-duration:\s*0\.001ms[\s\S]*?!important/,
    );
  });
});
