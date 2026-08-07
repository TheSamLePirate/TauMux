// Plan #09 commit B — pure-function tests for the shared plan-panel
// renderer. Both the native webview and the web mirror import these
// helpers; pinning their output here means a regression in either
// surface shows up immediately.

import { describe, expect, test } from "bun:test";
import {
  formatUpdatedAt,
  planStepKey,
  renderAuditRowHtml,
  renderPlanCardHtml,
  renderStepRowHtml,
  summarizePlan,
} from "../src/shared/plan-panel-render";
import type { AutoContinueAuditEntry, Plan } from "../src/shared/types";

const samplePlan: Plan = {
  workspaceId: "ws-1",
  agentId: "claude:1",
  steps: [
    { id: "M1", title: "Explore", state: "done" },
    { id: "M2", title: "Implement", state: "active" },
    { id: "M3", title: "Test", state: "waiting" },
  ],
  updatedAt: 0,
};

// ── summarizePlan ────────────────────────────────────────────

describe("summarizePlan", () => {
  test("done count + total", () => {
    expect(summarizePlan(samplePlan.steps)).toContain("1/3 done");
  });

  test("appends active count when any step is active", () => {
    expect(summarizePlan(samplePlan.steps)).toContain("1 active");
  });

  test("appends err count when any step is err", () => {
    const out = summarizePlan([
      { state: "done" },
      { state: "err" },
      { state: "err" },
    ]);
    expect(out).toContain("1/3 done");
    expect(out).toContain("2 err");
  });

  test("hides 0 active / 0 err", () => {
    const out = summarizePlan([{ state: "waiting" }, { state: "waiting" }]);
    expect(out).toBe("0/2 done");
  });

  test("empty plan = 'no steps'", () => {
    expect(summarizePlan([])).toBe("no steps");
  });
});

// ── renderStepRowHtml ────────────────────────────────────────

describe("renderStepRowHtml", () => {
  test("done step uses ■ icon and spp-step-done class", () => {
    const html = renderStepRowHtml({
      id: "M1",
      title: "Explore",
      state: "done",
    });
    expect(html).toContain("spp-step-done");
    expect(html).toContain("■");
    expect(html).toContain("M1");
    expect(html).toContain("Explore");
  });

  test("active step uses ● icon and spp-step-active class", () => {
    const html = renderStepRowHtml({
      id: "M2",
      title: "Build",
      state: "active",
    });
    expect(html).toContain("spp-step-active");
    expect(html).toContain("●");
  });

  test("waiting step uses ○ icon", () => {
    const html = renderStepRowHtml({
      id: "M3",
      title: "Test",
      state: "waiting",
    });
    expect(html).toContain("spp-step-waiting");
    expect(html).toContain("○");
  });

  test("err step uses × icon", () => {
    const html = renderStepRowHtml({ id: "M4", title: "Ship", state: "err" });
    expect(html).toContain("spp-step-err");
    expect(html).toContain("×");
  });

  test("unknown state falls back to 'waiting' class", () => {
    const html = renderStepRowHtml({
      id: "X",
      title: "?",
      state: "mystery" as never,
    });
    expect(html).toContain("spp-step-waiting");
  });

  test("HTML-escapes step title (XSS guard)", () => {
    const html = renderStepRowHtml({
      id: "M1",
      title: "<script>alert(1)</script>",
      state: "done",
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ── renderPlanCardHtml ───────────────────────────────────────

describe("renderPlanCardHtml", () => {
  test("card is an inert container; the workspace switch is its own button", () => {
    const html = renderPlanCardHtml(samplePlan);
    expect(html.startsWith('<div class="spp-card"')).toBe(true);
    // The card used to BE the button, which made the clear control and
    // the step toggles illegal nested buttons.
    expect(html).toContain(
      '<button type="button" class="spp-card-goto" data-plan-workspace="ws-1"',
    );
  });

  test("card carries its store key so a host can route clear/expand", () => {
    const html = renderPlanCardHtml(samplePlan);
    expect(html).toContain('data-plan-ws="ws-1"');
    expect(html).toContain('data-plan-agent="claude:1"');
  });

  test("includes workspace + agent + summary in the header", () => {
    const html = renderPlanCardHtml(samplePlan);
    expect(html).toContain("ws-1");
    expect(html).toContain("claude:1");
    expect(html).toContain("1/3 done");
  });

  test("agent label hidden when not provided", () => {
    const noAgent: Plan = { ...samplePlan, agentId: undefined };
    const html = renderPlanCardHtml(noAgent);
    expect(html).not.toContain("spp-card-agent");
  });

  test("renders one step row per step", () => {
    const html = renderPlanCardHtml(samplePlan);
    const matches = html.match(/class="spp-step /g) ?? [];
    expect(matches.length).toBe(3);
  });

  test("HTML-escapes the workspace id (XSS guard)", () => {
    const evil: Plan = {
      ...samplePlan,
      workspaceId: '"><script>alert(1)</script>',
    };
    const html = renderPlanCardHtml(evil);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});

// ── clear control ────────────────────────────────────────────

describe("plan card clear control", () => {
  test("not rendered unless the host opted in — never a dead button", () => {
    expect(renderPlanCardHtml(samplePlan)).not.toContain("data-plan-clear");
    expect(renderPlanCardHtml(samplePlan, { clearable: true })).toContain(
      "data-plan-clear",
    );
  });

  test("an unfinished plan gets the quiet × glyph", () => {
    const html = renderPlanCardHtml(samplePlan, { clearable: true });
    expect(html).toContain(">×</button>");
    expect(html).not.toContain("spp-card-clear-ready");
    expect(html).not.toContain("spp-card-complete");
  });

  test("a finished plan promotes it to a labelled control", () => {
    const done: Plan = {
      ...samplePlan,
      steps: samplePlan.steps.map((s) => ({ ...s, state: "done" as const })),
    };
    const html = renderPlanCardHtml(done, { clearable: true });
    expect(html).toContain("spp-card-complete");
    expect(html).toContain("spp-card-clear-ready");
    expect(html).toContain(">Clear</button>");
  });

  test("the clear label is escaped into an aria-label, not raw markup", () => {
    const evil: Plan = { ...samplePlan, workspaceId: '"><img src=x>' };
    const html = renderPlanCardHtml(evil, { clearable: true });
    expect(html).not.toContain("<img");
    expect(html).toContain("aria-label=");
  });

  test("an empty plan renders no progress bar (nothing to divide by)", () => {
    const empty: Plan = { ...samplePlan, steps: [] };
    const html = renderPlanCardHtml(empty, { clearable: true });
    expect(html).not.toContain("spp-card-progress");
    expect(html).not.toContain("spp-card-complete");
  });

  test("progress fill tracks the done ratio", () => {
    expect(renderPlanCardHtml(samplePlan)).toContain("width:33%");
  });
});

// ── step detail ──────────────────────────────────────────────

describe("step detail expansion", () => {
  const withDesc = {
    id: "M2",
    title: "Implement",
    state: "active",
    description: "Wire the reducer and repaint on change.",
  };

  test("a step with no description stays an inert div", () => {
    const html = renderStepRowHtml({ id: "M1", title: "X", state: "done" });
    expect(html.startsWith("<div")).toBe(true);
    expect(html).not.toContain("data-plan-step");
    expect(html).not.toContain("spp-step-caret");
  });

  test("a step with a description becomes a labelled toggle", () => {
    const html = renderStepRowHtml(withDesc);
    expect(html).toContain('data-plan-step="M2"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("spp-step-expandable");
  });

  test("collapsed rows do not ship the description text", () => {
    expect(renderStepRowHtml(withDesc)).not.toContain("Wire the reducer");
  });

  test("expanded rows render it inline", () => {
    const html = renderStepRowHtml(withDesc, { expanded: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("spp-step-open");
    expect(html).toContain("Wire the reducer and repaint on change.");
  });

  test("descriptions are escaped (XSS guard)", () => {
    const html = renderStepRowHtml(
      { ...withDesc, description: "<script>alert(1)</script>" },
      { expanded: true },
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  test("whitespace-only descriptions do not create a toggle", () => {
    const html = renderStepRowHtml({ ...withDesc, description: "   \n  " });
    expect(html).not.toContain("data-plan-step");
  });

  test("the card threads expansion through by scoped key", () => {
    const plan: Plan = {
      ...samplePlan,
      steps: [{ ...withDesc, state: "active" as const }],
    };
    const key = planStepKey(plan, "M2");
    expect(renderPlanCardHtml(plan)).not.toContain("Wire the reducer");
    expect(
      renderPlanCardHtml(plan, { expanded: new Set([key]) }),
    ).toContain("Wire the reducer");
  });

  test("expansion keys are scoped per agent, not per step id", () => {
    const a = planStepKey({ workspaceId: "ws-1", agentId: "claude:1" }, "M1");
    const b = planStepKey({ workspaceId: "ws-1", agentId: "pi:1" }, "M1");
    expect(a).not.toBe(b);
  });
});

// ── formatUpdatedAt ──────────────────────────────────────────

describe("formatUpdatedAt", () => {
  const now = 1_754_000_000_000;
  test("sub-minute reads 'just now'", () => {
    expect(formatUpdatedAt(now - 30_000, now)).toBe("just now");
  });
  test("minutes / hours / days", () => {
    expect(formatUpdatedAt(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatUpdatedAt(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatUpdatedAt(now - 50 * 3_600_000, now)).toBe("2d ago");
  });
  test("clock skew from the future is not rendered as negative", () => {
    expect(formatUpdatedAt(now + 10_000, now)).toBe("just now");
  });
  test("a missing timestamp drops the footer entirely", () => {
    expect(formatUpdatedAt(0, now)).toBe("");
    expect(renderPlanCardHtml(samplePlan, { now })).not.toContain(
      "spp-card-foot",
    );
  });
});

// ── renderAuditRowHtml ───────────────────────────────────────

describe("renderAuditRowHtml", () => {
  function entry(
    overrides: Partial<AutoContinueAuditEntry> = {},
  ): AutoContinueAuditEntry {
    return {
      at: 0,
      surfaceId: "s1",
      outcome: "fired",
      reason: "Plan step M2 is active; continuing.",
      engine: "heuristic",
      modelConsulted: false,
      ...overrides,
    };
  }

  test("fired outcome gets the correct class", () => {
    const html = renderAuditRowHtml(entry({ outcome: "fired" }));
    expect(html).toContain("spp-audit-fired");
    expect(html).toContain("fired");
  });

  test("dry-run outcome flattens to the spp-audit-dryrun class", () => {
    const html = renderAuditRowHtml(entry({ outcome: "dry-run" }));
    expect(html).toContain("spp-audit-dryrun");
    expect(html).toContain("dry-run");
  });

  test("skipped outcome gets the correct class", () => {
    const html = renderAuditRowHtml(entry({ outcome: "skipped" }));
    expect(html).toContain("spp-audit-skipped");
    expect(html).toContain("skipped");
  });

  test("modelConsulted appends '+model' to the engine label", () => {
    const html = renderAuditRowHtml(
      entry({ modelConsulted: true, engine: "hybrid" }),
    );
    expect(html).toContain("hybrid+model");
  });

  test("no model appends nothing", () => {
    const html = renderAuditRowHtml(
      entry({ modelConsulted: false, engine: "heuristic" }),
    );
    expect(html).toContain("heuristic");
    expect(html).not.toContain("+model");
  });

  test("HTML-escapes the reason (XSS guard)", () => {
    const html = renderAuditRowHtml(
      entry({ reason: 'Bad <script>"&</script> reason' }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });
});
