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
    {
      id: "M2",
      title: "Implement",
      state: "active",
      description: "Wire the reducer and repaint on change.",
    },
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
    const panel = new PlanPanel({ onSelectWorkspace: () => {}, onClearPlan: () => {} });
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
    const panel = new PlanPanel({ onSelectWorkspace: () => {}, onClearPlan: () => {} });
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
    const panel = new PlanPanel({ onSelectWorkspace: () => {}, onClearPlan: () => {} });
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
    const panel = new PlanPanel({ onSelectWorkspace: () => {}, onClearPlan: () => {} });
    host.appendChild(panel.getElement());

    panel.setAudit([{ ...sampleAudit, engine: "off" }]);
    expect(host.querySelector(".spp-section-subtitle")).toBeNull();
    expect(host.querySelector(".sidebar-plan-panel")!.classList.contains("hidden")).toBe(
      true,
    );
  });

  test("destroy is idempotent", async () => {
    const { PlanPanel } = await loadPanel();
    const panel = new PlanPanel({ onSelectWorkspace: () => {}, onClearPlan: () => {} });
    document.getElementById("host")!.appendChild(panel.getElement());
    panel.destroy();
    expect(() => panel.destroy()).not.toThrow();
  });
});

describe("PlanPanel interaction", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="host"></div>`;
  });

  async function mount() {
    const { PlanPanel } = await loadPanel();
    const cleared: Array<[string, string | undefined]> = [];
    const switched: string[] = [];
    const panel = new PlanPanel({
      onSelectWorkspace: (ws) => switched.push(ws),
      onClearPlan: (ws, agent) => cleared.push([ws, agent]),
    });
    document.getElementById("host")!.appendChild(panel.getElement());
    panel.setPlans([samplePlan]);
    return { panel, cleared, switched };
  }

  test("the clear control reports the card's workspace AND agent", async () => {
    const { cleared, switched } = await mount();
    document.querySelector<HTMLElement>("[data-plan-clear]")!.click();
    expect(cleared).toEqual([["ws-1", "claude:1"]]);
    // Clearing must not also navigate — the control sits inside the card.
    expect(switched).toEqual([]);
  });

  test("clearing does not optimistically remove the card", async () => {
    const { cleared } = await mount();
    document.querySelector<HTMLElement>("[data-plan-clear]")!.click();
    expect(cleared).toHaveLength(1);
    // Still on screen: only the store's next snapshot may remove it, so
    // a rejected/failed clear can never leave a phantom-free panel.
    expect(document.querySelector(".spp-card")).not.toBeNull();
  });

  test("a plan with no agent reports undefined rather than an empty string", async () => {
    const { PlanPanel } = await loadPanel();
    const cleared: Array<[string, string | undefined]> = [];
    const panel = new PlanPanel({
      onSelectWorkspace: () => {},
      onClearPlan: (ws, agent) => cleared.push([ws, agent]),
    });
    document.getElementById("host")!.appendChild(panel.getElement());
    panel.setPlans([{ ...samplePlan, agentId: undefined }]);
    document.querySelector<HTMLElement>("[data-plan-clear]")!.click();
    expect(cleared).toEqual([["ws-1", undefined]]);
  });

  test("clicking a step toggles its detail open, then closed", async () => {
    await mount();
    const step = () => document.querySelector<HTMLElement>("[data-plan-step]")!;
    expect(document.querySelector(".spp-step-desc")).toBeNull();

    step().click();
    expect(document.querySelector(".spp-step-desc")?.textContent).toContain(
      "Wire the reducer",
    );
    expect(step().getAttribute("aria-expanded")).toBe("true");

    step().click();
    expect(document.querySelector(".spp-step-desc")).toBeNull();
  });

  test("toggling a step never navigates", async () => {
    const { switched } = await mount();
    document.querySelector<HTMLElement>("[data-plan-step]")!.click();
    expect(switched).toEqual([]);
  });

  test("the header button still switches workspace", async () => {
    const { switched } = await mount();
    document.querySelector<HTMLElement>("[data-plan-workspace]")!.click();
    expect(switched).toEqual(["ws-1"]);
  });

  test("expansion survives an unrelated repaint", async () => {
    const { panel } = await mount();
    document.querySelector<HTMLElement>("[data-plan-step]")!.click();
    // Same steps, new snapshot (e.g. a step state changed elsewhere).
    panel.setPlans([{ ...samplePlan, updatedAt: 5 }]);
    expect(document.querySelector(".spp-step-desc")).not.toBeNull();
  });

  test("expansion state is dropped when the step disappears", async () => {
    const { panel } = await mount();
    document.querySelector<HTMLElement>("[data-plan-step]")!.click();
    panel.setPlans([{ ...samplePlan, steps: [samplePlan.steps[0]!] }]);
    expect(document.querySelector(".spp-step-desc")).toBeNull();
    // Re-adding the step comes back collapsed, not silently pre-opened.
    panel.setPlans([samplePlan]);
    expect(document.querySelector(".spp-step-desc")).toBeNull();
  });

  test("a completed plan advertises a labelled clear control", async () => {
    const { PlanPanel } = await loadPanel();
    const panel = new PlanPanel({
      onSelectWorkspace: () => {},
      onClearPlan: () => {},
    });
    document.getElementById("host")!.appendChild(panel.getElement());
    panel.setPlans([
      {
        ...samplePlan,
        steps: samplePlan.steps.map((s) => ({ ...s, state: "done" as const })),
      },
    ]);
    const btn = document.querySelector<HTMLElement>("[data-plan-clear]")!;
    expect(btn.textContent).toBe("Clear");
    expect(document.querySelector(".spp-card-complete")).not.toBeNull();
  });
});
