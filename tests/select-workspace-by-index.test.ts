// Triple-A I.6 / U13 — verify the ⌘1..⌘9 workspace-switch shortcut.
// Backfill from Phase 0 audit (PR 19).
//
// SurfaceManager construction requires a fully-formed webview environment
// (xterm, DOM, settings, RPC bridges) — testing selectWorkspaceByIndex
// in isolation is more setup than the invariant deserves. Source-grep
// the method shape and the binding registration.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SURFACE_MGR = readFileSync(
  join(import.meta.dir, "..", "src", "views", "terminal", "surface-manager.ts"),
  "utf-8",
);
const INDEX_TS = readFileSync(
  join(import.meta.dir, "..", "src", "views", "terminal", "index.ts"),
  "utf-8",
);

describe("[U13] selectWorkspaceByIndex", () => {
  it("is exposed as a public method on SurfaceManager", () => {
    expect(SURFACE_MGR).toMatch(
      /selectWorkspaceByIndex\(index: number\): void/,
    );
  });

  it("is bounds-checked (no-op on out-of-range index)", () => {
    // The bounds check is what makes the binding safe to register
    // unconditionally even when the user has only one workspace.
    // A regression that drops the check would throw a runtime error
    // on every unused ⌘N press.
    expect(SURFACE_MGR).toMatch(
      /selectWorkspaceByIndex[\s\S]*?if\s*\(index\s*<\s*0\s*\|\|\s*index\s*>=\s*this\.workspaces\.length\)\s*return/,
    );
  });
});

describe("[U13] ⌘1..⌘9 keybindings", () => {
  it("registers all nine bindings from a generated array", () => {
    // The fix uses `[1, 2, 3, 4, 5, 6, 7, 8, 9].map(...)` to spread
    // nine Binding<KeyCtx> entries into KEYBOARD_BINDINGS so a future
    // edit can't forget one of them. Pin both the source array and
    // the map shape.
    expect(INDEX_TS).toMatch(/\[1,\s*2,\s*3,\s*4,\s*5,\s*6,\s*7,\s*8,\s*9\]/);
    expect(INDEX_TS).toMatch(/workspace\.switch-\$\{n\}|workspace\.switch-/);
  });

  it("each binding calls selectWorkspaceByIndex with n - 1 (0-based)", () => {
    // Off-by-one regression guard.
    expect(INDEX_TS).toMatch(
      /surfaceManager\.selectWorkspaceByIndex\(n\s*-\s*1\)/,
    );
  });

  it("uses meta:true so the binding fires under ⌘N", () => {
    // The keyMatch options for the workspace switch must include
    // meta:true; otherwise typing "1" while focused on a text input
    // would also fire the binding.
    expect(INDEX_TS).toMatch(
      /keyMatch\(\{\s*key:\s*String\(n\)[\s\S]*?meta:\s*true/,
    );
  });
});
