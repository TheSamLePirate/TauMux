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
import type { Plan } from "../src/shared/types";

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
});
