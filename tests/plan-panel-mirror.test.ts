// C.3 — verify the web-mirror plan panel stays hidden until the first
// `plansSnapshot` arrives, then reveals itself with a "No active agent
// plans" empty state when the snapshot is empty. Avoids the prior
// behaviour of staying hidden forever, which made the widget invisible
// to users on a fresh connection.

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

async function loadModule() {
  return await import("../src/web-client/plan-panel-mirror");
}

const samplePlan: Plan = {
  workspaceId: "ws-1",
  agentId: "claude:1",
  steps: [{ id: "M1", title: "Explore", state: "active" }],
  updatedAt: 0,
};

const sampleAudit: AutoContinueAuditEntry = {
  at: 0,
  surfaceId: "surface:1",
  outcome: "skipped",
  reason: "ok",
  engine: "heuristic",
  modelConsulted: false,
};

describe("PlanPanelMirror — empty-state placeholder (C.3)", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `<div id="host"></div>`;
    host = document.getElementById("host") as HTMLElement;
  });

  test("panel is hidden before any plansSnapshot arrives", async () => {
    const { createPlanPanelMirror } = await loadModule();
    createPlanPanelMirror({
      hostEl: host,
      onSelectWorkspace: () => {},
    });
    const root = host.querySelector(".sb-plan-panel");
    expect(root).not.toBeNull();
    expect(root!.classList.contains("hidden")).toBe(true);
    // No empty-state markup pre-snapshot — the panel is invisible AND
    // its body is empty, so a flicker is impossible.
    expect(host.querySelector(".sb-plan-empty")).toBeNull();
  });

  test("after first empty plansSnapshot, panel is visible with empty state", async () => {
    const { createPlanPanelMirror } = await loadModule();
    const view = createPlanPanelMirror({
      hostEl: host,
      onSelectWorkspace: () => {},
    });
    view.setPlans([]);
    const root = host.querySelector(".sb-plan-panel");
    expect(root!.classList.contains("hidden")).toBe(false);
    expect(host.querySelector(".sb-plan-empty")?.textContent).toContain(
      "No active agent plans",
    );
  });

  test("non-empty snapshot replaces empty state with plan cards", async () => {
    const { createPlanPanelMirror } = await loadModule();
    const view = createPlanPanelMirror({
      hostEl: host,
      onSelectWorkspace: () => {},
    });
    view.setPlans([samplePlan]);
    expect(host.querySelector(".sb-plan-empty")).toBeNull();
    expect(host.querySelectorAll("[data-plan-workspace]").length).toBe(1);
  });

  test("off-engine audit entries do not render the auto-continue strip", async () => {
    const { createPlanPanelMirror } = await loadModule();
    const view = createPlanPanelMirror({
      hostEl: host,
      onSelectWorkspace: () => {},
    });
    view.setPlans([]);
    view.setAudit([{ ...sampleAudit, engine: "off" }]);
    expect(host.querySelector(".sb-plan-audit-title")).toBeNull();
  });

  test("non-off audit entries still render the auto-continue strip", async () => {
    const { createPlanPanelMirror } = await loadModule();
    const view = createPlanPanelMirror({
      hostEl: host,
      onSelectWorkspace: () => {},
    });
    view.setPlans([]);
    view.setAudit([sampleAudit]);
    expect(host.querySelector(".sb-plan-audit-title")?.textContent).toContain(
      "Auto-continue",
    );
  });

  test("setAudit alone (before plansSnapshot) does not flip the visibility flag", async () => {
    const { createPlanPanelMirror } = await loadModule();
    const view = createPlanPanelMirror({
      hostEl: host,
      onSelectWorkspace: () => {},
    });
    // Defensive — even if audit happened to land first somehow, we
    // still wait on the plansSnapshot envelope to mark "server has
    // spoken".
    view.setAudit([]);
    expect(
      host.querySelector(".sb-plan-panel")!.classList.contains("hidden"),
    ).toBe(true);
  });

  test("M17 — setAutoContinueAuditVisible(false) hides the audit strip even with non-off entries", async () => {
    const { createPlanPanelMirror } = await loadModule();
    const view = createPlanPanelMirror({
      hostEl: host,
      onSelectWorkspace: () => {},
    });
    view.setPlans([]);
    view.setAudit([sampleAudit]);
    // Strip is visible by default (engine: "heuristic", non-off).
    expect(host.querySelector(".sb-plan-audit-title")).not.toBeNull();
    // Flipping the gate off — mirrors what main.ts does when the
    // host's `state.settings.autoContinueEngine === "off"`.
    view.setAutoContinueAuditVisible(false);
    expect(host.querySelector(".sb-plan-audit-title")).toBeNull();
    // And re-flipping on restores the strip.
    view.setAutoContinueAuditVisible(true);
    expect(host.querySelector(".sb-plan-audit-title")).not.toBeNull();
  });
});

describe("web-mirror plan interaction", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="host"></div>`;
  });

  test("no clear control unless the host wired onClearPlan", async () => {
    const { createPlanPanelMirror } = await loadModule();
    const view = createPlanPanelMirror({
      hostEl: document.getElementById("host")!,
      onSelectWorkspace: () => {},
    });
    view.setPlans([samplePlan]);
    // A read-only embed must not paint a button that goes nowhere.
    expect(document.querySelector("[data-plan-clear]")).toBeNull();
  });

  test("clear relays workspace + agent to the host", async () => {
    const { createPlanPanelMirror } = await loadModule();
    const cleared: Array<[string, string | undefined]> = [];
    const view = createPlanPanelMirror({
      hostEl: document.getElementById("host")!,
      onSelectWorkspace: () => {},
      onClearPlan: (ws, agent) => cleared.push([ws, agent]),
    });
    view.setPlans([samplePlan]);
    document.querySelector<HTMLElement>("[data-plan-clear]")!.click();
    expect(cleared).toEqual([["ws-1", "claude:1"]]);
    // The card stays until the host echoes a new snapshot.
    expect(document.querySelector(".spp-card")).not.toBeNull();
  });

  test("step detail expands locally without touching the wire", async () => {
    const { createPlanPanelMirror } = await loadModule();
    const sent: string[] = [];
    const view = createPlanPanelMirror({
      hostEl: document.getElementById("host")!,
      onSelectWorkspace: (ws) => sent.push(ws),
      onClearPlan: () => sent.push("clear"),
    });
    view.setPlans([
      {
        ...samplePlan,
        steps: [
          {
            id: "M1",
            title: "Explore",
            state: "active",
            description: "Read the reducer.",
          },
        ],
      },
    ]);
    document.querySelector<HTMLElement>("[data-plan-step]")!.click();
    expect(document.querySelector(".spp-step-desc")?.textContent).toContain(
      "Read the reducer.",
    );
    expect(sent).toEqual([]);
  });
});
