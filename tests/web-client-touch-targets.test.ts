// Phase 1 / I.5 / U5 — web-mirror touch target minimums.
//
// Asserts the @media (pointer: coarse) block is present in
// src/web-client/client.css and that it covers every chip-class plus
// the surface-tab close button. A Playwright mobile-viewport test
// (deferred to P3) would assert bounding boxes at runtime; this
// source-level check catches the regression class we're guarding
// (a refactor that drops the block, or splits chips into a new
// class name without adding it to the selector list).

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(
  join(import.meta.dir, "..", "src", "web-client", "client.css"),
  "utf-8",
);

describe("[U5/I.5] mirror touch-target minimums", () => {
  it("includes a (pointer: coarse) media block", () => {
    expect(CSS).toMatch(/@media\s*\(pointer:\s*coarse\)/);
  });

  it("declares min-width: 44px AND min-height: 44px inside the block", () => {
    // Match the block body and assert both rules are present.
    const block = CSS.match(/@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\n\}/);
    expect(block).not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/min-width:\s*44px/);
    expect(body).toMatch(/min-height:\s*44px/);
  });

  it("covers every chip class + the surface-tab close button", () => {
    const block = CSS.match(/@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\n\}/);
    expect(block).not.toBeNull();
    const body = block![0];
    // Every interactive class that lives in the mirror's chip / toast
    // / sidebar surface today. Adding a new clickable class without
    // also listing it here is the regression we're guarding.
    const expected = [
      ".chip-port",
      ".chip-cwd",
      ".chip-git",
      ".chip-fg",
      ".surface-tab-close",
      ".sidebar-pill",
    ];
    for (const sel of expected) {
      expect(body).toContain(sel);
    }
  });
});
