/**
 * Plan #09 commit B — sidebar plan panel (native webview).
 *
 * Mounts a self-contained DOM element the caller appends to the
 * sidebar host. Subscribes via `setPlans` / `setAudit` setters
 * (driven by the `restorePlans` + `autoContinueAudit` RPC envelopes
 * in `index.ts`) and re-renders on every change. Pure rendering
 * helpers live in `src/shared/plan-panel-render.ts` so the web
 * mirror can produce the exact same HTML.
 */

import type { AutoContinueAuditEntry, Plan } from "../../shared/types";
import {
  renderAuditRowHtml,
  renderPlanCardHtml,
} from "../../shared/plan-panel-render";

export interface PlanPanelCallbacks {
  /** Click on a plan card → switch to its workspace (and any host
   *  agent surface the user opened it from). */
  onSelectWorkspace: (workspaceId: string) => void;
}

export class PlanPanel {
  private rootEl: HTMLElement;
  private plansZoneEl: HTMLElement;
  private auditZoneEl: HTMLElement;
  private callbacks: PlanPanelCallbacks;
  private plans: Plan[] = [];
  private audit: AutoContinueAuditEntry[] = [];
  private destroyed = false;

  constructor(callbacks: PlanPanelCallbacks) {
    this.callbacks = callbacks;
    this.rootEl = document.createElement("div");
    this.rootEl.className = "sidebar-plan-panel hidden";

    const planHeader = document.createElement("div");
    planHeader.className = "spp-section-title";
    planHeader.textContent = "Agent plans";
    this.rootEl.appendChild(planHeader);

    this.plansZoneEl = document.createElement("div");
    this.plansZoneEl.className = "spp-plans";
    this.rootEl.appendChild(this.plansZoneEl);

    this.auditZoneEl = document.createElement("div");
    this.auditZoneEl.className = "spp-audit hidden";
    this.rootEl.appendChild(this.auditZoneEl);

    // Click delegation — keeps event count constant regardless of
    // how many cards are rendered. Cards carry their workspaceId in
    // a data-attr so we don't need closures per row.
    this.rootEl.addEventListener("click", (e) => {
      if (this.destroyed) return;
      const target = (e.target as HTMLElement).closest(
        "[data-plan-workspace]",
      ) as HTMLElement | null;
      if (!target) return;
      const wsId = target.getAttribute("data-plan-workspace");
      if (wsId) this.callbacks.onSelectWorkspace(wsId);
    });
  }

  /** Returns the panel's root DOM node so the caller can mount it
   *  wherever fits their layout. */
  getElement(): HTMLElement {
    return this.rootEl;
  }

  setPlans(plans: readonly Plan[]): void {
    if (this.destroyed) return;
    this.plans = [...plans];
    this.repaint();
  }

  setAudit(audit: readonly AutoContinueAuditEntry[]): void {
    if (this.destroyed) return;
    this.audit = [...audit];
    this.repaint();
  }

  /** Detach from the DOM and stop responding to further state changes.
   *  Idempotent. After destroy, `setPlans` / `setAudit` are no-ops so a
   *  late-arriving RPC envelope can't repaint a torn-down node. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.plans = [];
    this.audit = [];
    this.plansZoneEl.innerHTML = "";
    this.auditZoneEl.innerHTML = "";
    this.rootEl.remove();
  }

  private repaint(): void {
    if (this.plans.length === 0 && this.audit.length === 0) {
      this.rootEl.classList.add("hidden");
      return;
    }
    this.rootEl.classList.remove("hidden");

    if (this.plans.length === 0) {
      this.plansZoneEl.innerHTML = `<div class="spp-empty">No active agent plans.</div>`;
    } else {
      this.plansZoneEl.innerHTML = this.plans
        .map((p) => renderPlanCardHtml(p))
        .join("");
    }

    if (this.audit.length === 0) {
      this.auditZoneEl.classList.add("hidden");
      this.auditZoneEl.innerHTML = "";
    } else {
      this.auditZoneEl.classList.remove("hidden");
      // Newest 6 wins — the audit log is intended as a rolling
      // recent-history strip, not a full timeline.
      const visible = this.audit.slice(-6).reverse();
      this.auditZoneEl.innerHTML = `<div class="spp-section-subtitle">Auto-continue · last ${visible.length}</div>${visible
        .map((entry) => renderAuditRowHtml(entry))
        .join("")}`;
    }
  }
}
