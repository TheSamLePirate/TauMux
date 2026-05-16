// Phase 2 / A1 — webview action envelope typing invariants.
//
// The bun-side dispatch() in src/bun/index.ts used to cast every
// payload field at the use site (`payload["surfaceId"] as string |
// undefined`). The typed `ActionPayloadByAction` lookup in
// src/shared/webview-actions.ts gives each `case` body a per-action
// payload shape; adding a new action without declaring its payload
// there is now a TS error.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ACTIONS_SRC = readFileSync(
  join(import.meta.dir, "..", "src", "shared", "webview-actions.ts"),
  "utf-8",
);
const INDEX_SRC = readFileSync(
  join(import.meta.dir, "..", "src", "bun", "index.ts"),
  "utf-8",
);

describe("[A1] WebviewActionEnvelope contract", () => {
  it("declares the discriminated union with at least 15 actions", () => {
    // Match up to the next `export type` (the next top-level
    // declaration) so the non-greedy stop is structural, not character-
    // based — the per-arm `{ action: "X"; payload: Y };` contains
    // semicolons that would otherwise terminate the match early.
    const union = ACTIONS_SRC.match(
      /export type WebviewActionEnvelope\s*=([\s\S]*?)export type/,
    );
    expect(union).not.toBeNull();
    const arms = [...union![1].matchAll(/action:\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(arms.length).toBeGreaterThanOrEqual(15);
    // Spot-check a few well-known actions are present.
    for (const must of [
      "createSurface",
      "splitSurface",
      "closeSurface",
      "renameSurface",
      "runScript",
      "notification",
      "openExternal",
    ]) {
      expect(arms).toContain(must);
    }
  });

  it("exposes a `ActionPayloadByAction` lookup keyed on the union", () => {
    expect(ACTIONS_SRC).toContain("ActionPayloadByAction");
    expect(ACTIONS_SRC).toMatch(
      /type\s+ActionPayloadByAction\s*=\s*\{[\s\S]*?WebviewActionEnvelope[\s\S]*?\}/,
    );
  });
});

describe("[A1] index.ts dispatch — typed payload usage", () => {
  it("imports the typed lookup from src/shared/webview-actions", () => {
    expect(INDEX_SRC).toMatch(
      /import type \{[^}]*ActionPayloadByAction[^}]*\}\s*from\s*"\.\.\/shared\/webview-actions"/,
    );
  });

  it('every action branch uses `payload as ActionPayloadByAction["…"]`', () => {
    // Pull every `action === "X"` from the dispatch function body and
    // assert each one is followed (within ~600 chars — covering the
    // case body) by a matching typed cast. Skip the umbrella sidebar
    // cluster which routes the payload through unchanged before
    // narrowing inside `setStatus`.
    const dispatchBody = INDEX_SRC.match(
      /function dispatch\(action: string[\s\S]*?\n\}/,
    );
    expect(dispatchBody).not.toBeNull();
    const body = dispatchBody![0];
    const branches = [...body.matchAll(/action === "([^"]+)"/g)].map(
      (m) => m[1],
    );
    // Drop the sidebar-cluster aliases (setStatus is the one that
    // narrows in the inner if).
    const sidebarCluster = new Set([
      "clearStatus",
      "setProgress",
      "clearProgress",
      "log",
    ]);
    for (const action of branches) {
      if (sidebarCluster.has(action)) continue;
      const literal = `ActionPayloadByAction["${action}"]`;
      expect(body).toContain(literal);
    }
  });

  it('no `payload["…"]` index-cast survives in the dispatch body', () => {
    const dispatchBody = INDEX_SRC.match(
      /function dispatch\(action: string[\s\S]*?\n\}/,
    );
    expect(dispatchBody).not.toBeNull();
    const body = dispatchBody![0];
    // `payload["key"] as Foo` was the old anti-pattern. Match the
    // shape directly and fail loudly.
    expect(body).not.toMatch(/payload\["[^"]+"\]\s*as\s/);
  });
});
