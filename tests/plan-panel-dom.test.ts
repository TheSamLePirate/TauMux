// I11 — DOM-level coverage for PlanPanel lifecycle. The pure renderer
// has its own test file; this one verifies the panel mounts, repaints,
// and tears down cleanly via destroy() so a follow-up state event after
// destroy can't render against detached nodes.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { AutoContinueAuditEntry, Plan } from "../src/shared/types";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function loadPanel() {
  return await import("../src/views/terminal/plan-panel");
}

const samplePlan: Plan = {
  workspaceId: "ws-1",
  agentId: "claude:1",
  steps: [
    { id: "M1", title: "Explore", state: "done" },
    { id: "M2", title: "Implement", state: "active" },
  ],
  updatedAt: 0,
};

const sampleAudit: AutoContinueAuditEntry = {
  at: 0,
  surfaceId: "surface:1",
  agentId: "claude:1",
  outcome: "skipped",
  reason: "ok",
  engine: "heuristic",
  modelConsulted: false,
};

describe("PlanPanel destroy()", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="host"></div>`;
  });

  test("setPlans renders cards before destroy, then root is detached", async () => {
    const { PlanPanel } = await loadPanel();
    const host = document.getElementById("host")!;
    const panel = new PlanPanel({ onSelectWorkspace: () => {} });
    host.appendChild(panel.getElement());

    panel.setPlans([samplePlan]);
    expect(host.querySelector(".sidebar-plan-panel")).not.toBeNull();
    expect(host.querySelector(".spp-plans")?.innerHTML).toContain(
      "data-plan-workspace",
    );

    panel.destroy();
    expect(host.querySelector(".sidebar-plan-panel")).toBeNull();
  });

  test("setPlans after destroy is a no-op (no late repaint into detached node)", async () => {
    const { PlanPanel } = await loadPanel();
    const host = document.getElementById("host")!;
    const panel = new PlanPanel({ onSelectWorkspace: () => {} });
    host.appendChild(panel.getElement());

    panel.destroy();
    panel.setPlans([samplePlan]);
    panel.setAudit([sampleAudit]);

    // Root is gone, and the panel's internal zone elements (still
    // referenced by the closure) hold no card markup.
    expect(host.querySelector(".sidebar-plan-panel")).toBeNull();
    expect(panel.getElement().querySelector(".spp-plans")?.innerHTML).toBe("");
    expect(panel.getElement().querySelector(".spp-audit")?.innerHTML).toBe("");
  });

  test("auto-continue audit section hides when engine visibility is off", async () => {
    const { PlanPanel } = await loadPanel();
    const host = document.getElementById("host")!;
    const panel = new PlanPanel({ onSelectWorkspace: () => {} });
    host.appendChild(panel.getElement());

    panel.setAudit([sampleAudit]);
    expect(host.querySelector(".spp-section-subtitle")?.textContent).toContain(
      "Auto-continue",
    );

    panel.setAutoContinueAuditVisible(false);
    expect(host.querySelector(".spp-section-subtitle")).toBeNull();
    expect(host.querySelector(".sidebar-plan-panel")!.classList.contains("hidden")).toBe(
      true,
    );
  });

  test("off-engine audit entries never render the auto-continue section", async () => {
    const { PlanPanel } = await loadPanel();
    const host = document.getElementById("host")!;
    const panel = new PlanPanel({ onSelectWorkspace: () => {} });
    host.appendChild(panel.getElement());

    panel.setAudit([{ ...sampleAudit, engine: "off" }]);
    expect(host.querySelector(".spp-section-subtitle")).toBeNull();
    expect(host.querySelector(".sidebar-plan-panel")!.classList.contains("hidden")).toBe(
      true,
    );
  });

  test("destroy is idempotent", async () => {
    const { PlanPanel } = await loadPanel();
    const panel = new PlanPanel({ onSelectWorkspace: () => {} });
    document.getElementById("host")!.appendChild(panel.getElement());
    panel.destroy();
    expect(() => panel.destroy()).not.toThrow();
  });
});
