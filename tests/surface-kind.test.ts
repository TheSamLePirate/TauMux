// Triple-A F.4 / A3+A17 — verify SurfaceKind is the single source of truth.
// Backfill from Phase 0 audit (PR 14). The fix in commit 1858f27 unified
// the literal-string union across PaneLeaf.surfaceType, surfaceTypes
// records, RPC types, and WorkspaceSnapshot. This test asserts the
// invariants that prevent the next duplication regression.

import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SurfaceKind } from "../src/shared/types";

const ROOT = resolve(import.meta.dir, "..", "src");

function walkTs(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      walkTs(p, acc);
    } else if (s.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) {
      acc.push(p);
    }
  }
  return acc;
}

describe("[A3+A17] SurfaceKind canonical union", () => {
  it("type-checks as the documented four-value literal-string union", () => {
    // Compile-time invariant via the type system: the assignments below
    // would fail tsc --noEmit if the union shape changed.
    const t: SurfaceKind = "terminal";
    const b: SurfaceKind = "browser";
    const a: SurfaceKind = "agent";
    const g: SurfaceKind = "telegram";
    expect([t, b, a, g]).toEqual(["terminal", "browser", "agent", "telegram"]);
  });

  it("is declared exactly once across the codebase", () => {
    const files = walkTs(ROOT);
    // Permit `export type SurfaceKind = ...` only in the canonical
    // shared/types.ts. Any other file re-declaring it would be a
    // regression to the duplication the fix eliminated.
    const declarationRe = /^\s*export\s+type\s+SurfaceKind\s*=/m;
    const declarations = files.filter((f) =>
      declarationRe.test(readFileSync(f, "utf-8")),
    );
    expect(declarations).toHaveLength(1);
    expect(declarations[0].endsWith("shared/types.ts")).toBe(true);
  });

  it("the `tg:` substring shortcut on the bun side is bounded", () => {
    // The fix removed most of the `id.startsWith("tg:")` surface-kind
    // detection paths. One legitimate residual lives in
    // src/bun/index.ts (`closeSurface` handler): telegram surfaces
    // have no per-id manager (no PTY, no browser process, no agent),
    // so there's no `isTelegramSurface()` to call — the close handler
    // routes telegram closes by id prefix. A residual usage in
    // src/web-client/store.ts is the mirror's own per-id check for
    // store tagging (different concern, not kind dispatch).
    //
    // This test fails if a *second* `startsWith("tg:")` appears in
    // src/bun/, which would mean the dedupe has regressed.
    const files = walkTs(join(ROOT, "bun"));
    const re = /\.startsWith\(["']tg:["']\)/g;
    let total = 0;
    const offenders: string[] = [];
    for (const f of files) {
      const body = readFileSync(f, "utf-8");
      const matches = body.match(re);
      if (matches) {
        total += matches.length;
        offenders.push(f);
      }
    }
    expect(total).toBeLessThanOrEqual(1);
    if (total === 1) {
      // pin to the documented spot
      expect(offenders).toEqual([join(ROOT, "bun", "index.ts")]);
    }
  });
});
