/**
 * Plan #09 commit B — web-mirror plan panel.
 *
 * Mirrors the native sidebar plan widget over the web mirror. Pure
 * rendering lives in `src/shared/plan-panel-render.ts`; this module
 * just wires the host DOM, the click handler, and the imperative
 * `setPlans` / `setAudit` setters consumed by the protocol
 * dispatcher.
 *
 * The mirror is read-only — clicking a plan card emits a
 * `selectWorkspace` envelope so the native side switches and
 * broadcasts the result back via `layoutChanged`. We never mutate
 * plan state from the mirror.
 */

import type { AutoContinueAuditEntry, Plan } from "../shared/types";
import {
  renderAuditRowHtml,
  renderPlanCardHtml,
} from "../shared/plan-panel-render";

export interface PlanPanelMirrorDeps {
  hostEl: HTMLElement;
  onSelectWorkspace: (workspaceId: string) => void;
}

export interface PlanPanelMirrorView {
  setPlans(plans: readonly Plan[]): void;
  setAudit(audit: readonly AutoContinueAuditEntry[]): void;
}

export function createPlanPanelMirror(
  deps: PlanPanelMirrorDeps,
): PlanPanelMirrorView {
  const { hostEl, onSelectWorkspace } = deps;
  let plans: Plan[] = [];
  let audit: AutoContinueAuditEntry[] = [];

  const root = document.createElement("div");
  root.className = "sb-plan-panel hidden";

  const headerEl = document.createElement("div");
  headerEl.className = "sb-plan-title";
  headerEl.textContent = "Agent plans";
  root.appendChild(headerEl);

  const plansZoneEl = document.createElement("div");
  plansZoneEl.className = "sb-plan-cards";
  root.appendChild(plansZoneEl);

  const auditZoneEl = document.createElement("div");
  auditZoneEl.className = "sb-plan-audit hidden";
  root.appendChild(auditZoneEl);

  hostEl.appendChild(root);

  root.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest(
      "[data-plan-workspace]",
    ) as HTMLElement | null;
    if (!target) return;
    const wsId = target.getAttribute("data-plan-workspace");
    if (wsId) onSelectWorkspace(wsId);
  });

  function repaint(): void {
    if (plans.length === 0 && audit.length === 0) {
      root.classList.add("hidden");
      return;
    }
    root.classList.remove("hidden");
    if (plans.length === 0) {
      plansZoneEl.innerHTML = `<div class="sb-plan-empty">No active agent plans.</div>`;
    } else {
      plansZoneEl.innerHTML = plans.map((p) => renderPlanCardHtml(p)).join("");
    }
    if (audit.length === 0) {
      auditZoneEl.classList.add("hidden");
      auditZoneEl.innerHTML = "";
    } else {
      auditZoneEl.classList.remove("hidden");
      const visible = audit.slice(-6).reverse();
      auditZoneEl.innerHTML = `<div class="sb-plan-audit-title">Auto-continue · last ${visible.length}</div>${visible
        .map((entry) => renderAuditRowHtml(entry))
        .join("")}`;
    }
  }

  return {
    setPlans(next) {
      plans = [...next];
      repaint();
    },
    setAudit(next) {
      audit = [...next];
      repaint();
    },
  };
}
