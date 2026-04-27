// Plan #09 commit B — pure-function tests for the shared plan-panel
// renderer. Both the native webview and the web mirror import these
// helpers; pinning their output here means a regression in either
// surface shows up immediately.

import { describe, expect, test } from "bun:test";
import {
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
  test("emits a button with the workspace id as a data-attribute", () => {
    const html = renderPlanCardHtml(samplePlan);
    expect(html).toContain('data-plan-workspace="ws-1"');
    expect(html.startsWith("<button")).toBe(true);
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
