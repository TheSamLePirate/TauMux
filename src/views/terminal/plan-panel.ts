/**
 * Plan #09 commit B — sidebar plan panel (native webview).
 *
 * Mounts a self-contained DOM element the caller appends to the
 * sidebar host. Subscribes via `setPlans` / `setAudit` setters
 * (driven by the `restorePlans` + `autoContinueAudit` RPC envelopes
 * in `index.ts`) and re-renders on every change. Pure rendering
 * helpers live in `src/shared/plan-panel-render.ts` so the web
 * mirror can produce the exact same HTML.
 *
 * Two bits of local view state live here rather than in the store:
 * which step descriptions are expanded, and nothing else. Expansion
 * is per-user and per-surface — the native panel and the web mirror
 * are allowed to disagree about it, so it never goes on the wire.
 */

import type { AutoContinueAuditEntry, Plan } from "../../shared/types";
import {
  planStepKey,
  renderAuditRowHtml,
  renderPlanCardHtml,
} from "../../shared/plan-panel-render";

export interface PlanPanelCallbacks {
  /** Click on a plan card → switch to its workspace (and any host
   *  agent surface the user opened it from). */
  onSelectWorkspace: (workspaceId: string) => void;
  /** Click the card's clear control → drop the plan. The panel does
   *  not remove the card itself: the store broadcasts the new
   *  snapshot and `setPlans` repaints, so the UI can never claim a
   *  clear that didn't land. */
  onClearPlan: (workspaceId: string, agentId?: string) => void;
}

export class PlanPanel {
  private rootEl: HTMLElement;
  private plansZoneEl: HTMLElement;
  private auditZoneEl: HTMLElement;
  private callbacks: PlanPanelCallbacks;
  private plans: Plan[] = [];
  private audit: AutoContinueAuditEntry[] = [];
  private autoContinueAuditVisible = true;
  private expanded = new Set<string>();
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
    // how many cards are rendered. Controls carry their identity in
    // data-attrs so we don't need closures per row. Order matters:
    // clear and step-toggle sit inside the card, and only the
    // workspace button should fall through to a workspace switch.
    this.rootEl.addEventListener("click", (e) => {
      if (this.destroyed) return;
      const el = e.target as HTMLElement;

      const clearBtn = el.closest("[data-plan-clear]");
      if (clearBtn) {
        const card = clearBtn.closest("[data-plan-ws]");
        const ws = card?.getAttribute("data-plan-ws");
        if (ws) {
          const agent = card?.getAttribute("data-plan-agent") || undefined;
          this.callbacks.onClearPlan(ws, agent);
        }
        return;
      }

      const stepBtn = el.closest("[data-plan-step]");
      if (stepBtn) {
        const card = stepBtn.closest("[data-plan-ws]");
        const ws = card?.getAttribute("data-plan-ws");
        const stepId = stepBtn.getAttribute("data-plan-step");
        if (ws && stepId) {
          const key = planStepKey(
            {
              workspaceId: ws,
              agentId: card?.getAttribute("data-plan-agent") || undefined,
            },
            stepId,
          );
          if (this.expanded.has(key)) this.expanded.delete(key);
          else this.expanded.add(key);
          this.repaint();
        }
        return;
      }

      const target = el.closest("[data-plan-workspace]") as HTMLElement | null;
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
    this.pruneExpanded();
    this.repaint();
  }

  setAudit(audit: readonly AutoContinueAuditEntry[]): void {
    if (this.destroyed) return;
    this.audit = [...audit];
    this.repaint();
  }

  /** Hide the auto-continue audit strip when the engine is disabled.
   *  The plan cards remain visible; only the `AUTO-CONTINUE · …`
   *  sidebar section is suppressed. */
  setAutoContinueAuditVisible(visible: boolean): void {
    if (this.destroyed) return;
    this.autoContinueAuditVisible = visible;
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
    this.expanded.clear();
    this.plansZoneEl.innerHTML = "";
    this.auditZoneEl.innerHTML = "";
    this.rootEl.remove();
  }

  /** Drop expansion keys for steps that no longer exist. Without this
   *  a long-lived session accumulates one dead key per step of every
   *  plan it ever saw. */
  private pruneExpanded(): void {
    if (this.expanded.size === 0) return;
    const live = new Set<string>();
    for (const plan of this.plans) {
      for (const step of plan.steps) live.add(planStepKey(plan, step.id));
    }
    for (const key of this.expanded) {
      if (!live.has(key)) this.expanded.delete(key);
    }
  }

  private repaint(): void {
    const visibleAudit = this.getVisibleAudit();
    if (this.plans.length === 0 && visibleAudit.length === 0) {
      this.rootEl.classList.add("hidden");
      this.auditZoneEl.classList.add("hidden");
      this.auditZoneEl.innerHTML = "";
      return;
    }
    this.rootEl.classList.remove("hidden");

    if (this.plans.length === 0) {
      this.plansZoneEl.innerHTML = `<div class="spp-empty">No active agent plans.</div>`;
    } else {
      this.plansZoneEl.innerHTML = this.plans
        .map((p) =>
          renderPlanCardHtml(p, { clearable: true, expanded: this.expanded }),
        )
        .join("");
    }

    if (visibleAudit.length === 0) {
      this.auditZoneEl.classList.add("hidden");
      this.auditZoneEl.innerHTML = "";
    } else {
      this.auditZoneEl.classList.remove("hidden");
      // Newest 6 wins — the audit log is intended as a rolling
      // recent-history strip, not a full timeline.
      const visible = visibleAudit.slice(-6).reverse();
      this.auditZoneEl.innerHTML = `<div class="spp-section-subtitle">Auto-continue · last ${visible.length}</div>${visible
        .map((entry) => renderAuditRowHtml(entry))
        .join("")}`;
    }
  }

  private getVisibleAudit(): AutoContinueAuditEntry[] {
    if (!this.autoContinueAuditVisible) return [];
    return this.audit.filter((entry) => entry.engine !== "off");
  }
}
