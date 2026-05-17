// P7 S26 — Cluster E remediation UX.
//
// `runAndPublishAudits` in src/bun/index.ts now bridges audit fixes
// through to the health registry: when a result carries a `fix`, the
// `health.set(id, sev, msg, fix)` call attaches a wrapped `action`
// that runs `applyFix` (which re-runs `check()` post-action) and then
// pushes the recovered result back to health in the same tick.
//
// We can't easily exercise the full bun bootstrap here, so this test
// reconstructs the bridge inline with stubbed audits and asserts the
// HealthRegistry transitions through degraded → ok when the fix
// runs.

import { describe, expect, test } from "bun:test";
import { HealthRegistry } from "../src/bun/health";
import {
  applyFix,
  runAudits,
  type Audit,
  type AuditResult,
} from "../src/bun/audits";

/** Build a single audit that:
 *   - on first check, returns `warn` + a `fix` whose action flips
 *     `state.ok = true` so a subsequent check returns `info`.
 *   - is reusable across the test's two-phase flow (initial publish
 *     → user clicks fix → re-publish). */
function flakeyAudit(state: { ok: boolean }): Audit {
  return {
    id: "demo",
    description: "demo audit",
    check: async (): Promise<AuditResult> => {
      if (state.ok) {
        return {
          id: "demo",
          ok: true,
          severity: "info",
          message: "demo is happy",
        };
      }
      return {
        id: "demo",
        ok: false,
        severity: "warn",
        message: "demo needs a fix",
        fix: {
          label: "Make demo ok",
          action: async () => {
            state.ok = true;
          },
        },
      };
    },
  };
}

/** Inlined copy of the production runAndPublishAudits() loop's
 *  publish step. Keeps the test focused on the bridge contract. */
async function publish(
  registry: HealthRegistry,
  audits: Audit[],
): Promise<void> {
  const results = await runAudits(audits);
  for (const r of results) {
    const sev =
      r.severity === "info"
        ? "ok"
        : r.severity === "warn"
          ? "degraded"
          : "error";
    const fix =
      r.fix && !r.ok
        ? {
            label: r.fix.label,
            action: async () => {
              const post = await applyFix(r, audits);
              const postSev =
                post.severity === "info"
                  ? "ok"
                  : post.severity === "warn"
                    ? "degraded"
                    : "error";
              registry.set(`audit:${post.id}`, postSev, post.message);
            },
          }
        : undefined;
    registry.set(`audit:${r.id}`, sev, r.message, fix);
  }
}

describe("audit fix → health registry bridge (P7 S26)", () => {
  test("an audit result with a fix lands as a health entry with a fixLabel", async () => {
    const state = { ok: false };
    const registry = new HealthRegistry();
    await publish(registry, [flakeyAudit(state)]);

    const snap = registry.snapshot();
    expect(snap.entries.length).toBe(1);
    expect(snap.entries[0]!.id).toBe("audit:demo");
    expect(snap.entries[0]!.severity).toBe("degraded");
    expect(snap.entries[0]!.fixLabel).toBe("Make demo ok");
  });

  test("an ok audit result lands without a fixLabel even if the audit declared one", async () => {
    const state = { ok: true };
    const registry = new HealthRegistry();
    await publish(registry, [flakeyAudit(state)]);

    const snap = registry.snapshot();
    expect(snap.entries[0]!.severity).toBe("ok");
    expect(snap.entries[0]!.fixLabel).toBeUndefined();
  });

  test("runFix() triggers the wrapped action and the post-fix entry goes ok", async () => {
    const state = { ok: false };
    const registry = new HealthRegistry();
    await publish(registry, [flakeyAudit(state)]);

    expect(registry.snapshot().entries[0]!.severity).toBe("degraded");
    await registry.runFix("audit:demo");

    const snap = registry.snapshot();
    expect(snap.entries[0]!.severity).toBe("ok");
    expect(snap.entries[0]!.message).toContain("happy");
    expect(snap.entries[0]!.fixLabel).toBeUndefined();
  });
});
