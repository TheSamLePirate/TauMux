/**
 * Plan #09 commit B — pure HTML renderers for the plan panel.
 *
 * Shared between the native webview (`src/views/terminal/plan-panel.ts`)
 * and the web mirror (`src/web-client/plan-panel-mirror.ts`) so both
 * surfaces render the same markup. The functions below have no DOM
 * references and no side effects — they take typed plan data and
 * return an HTML string the caller pastes into a host element.
 *
 * HTML escaping is conservative (no innerHTML-as-text shortcuts);
 * agent-supplied step titles + audit reasons can contain any
 * characters and we never want them to break the chrome.
 */

import type { AutoContinueAuditEntry, Plan } from "./types";
import { escapeHtml } from "./escape-html";

/** Render a single plan card. The host element binds a click
 *  handler via event delegation on the `data-plan-workspace`
 *  attribute. */
export function renderPlanCardHtml(plan: Plan): string {
  const wsAttr = escapeHtml(plan.workspaceId);
  const titleParts: string[] = [];
  titleParts.push(
    `<span class="spp-card-ws">${escapeHtml(plan.workspaceId)}</span>`,
  );
  if (plan.agentId) {
    titleParts.push(
      `<span class="spp-card-agent">${escapeHtml(plan.agentId)}</span>`,
    );
  }
  titleParts.push(
    `<span class="spp-card-summary">${summarizePlan(plan.steps)}</span>`,
  );
  const stepsHtml = plan.steps.map((s) => renderStepRowHtml(s)).join("");
  return [
    `<button type="button" class="spp-card" data-plan-workspace="${wsAttr}" title="Click to switch to workspace ${wsAttr}">`,
    `<div class="spp-card-header">${titleParts.join("")}</div>`,
    `<div class="spp-card-steps">${stepsHtml}</div>`,
    `</button>`,
  ].join("");
}

export function renderStepRowHtml(step: {
  id: string;
  title: string;
  state: string;
}): string {
  const icon = stateIcon(step.state);
  const stateClass = ["done", "active", "waiting", "err"].includes(step.state)
    ? step.state
    : "waiting";
  return [
    `<div class="spp-step spp-step-${stateClass}">`,
    `<span class="spp-step-icon">${icon}</span>`,
    `<span class="spp-step-id">${escapeHtml(step.id)}</span>`,
    `<span class="spp-step-title">${escapeHtml(step.title)}</span>`,
    `</div>`,
  ].join("");
}

export function renderAuditRowHtml(entry: AutoContinueAuditEntry): string {
  const outcomeClass = entry.outcome.replace("-", "");
  return [
    `<div class="spp-audit-row spp-audit-${outcomeClass}">`,
    `<span class="spp-audit-outcome">${entry.outcome}</span>`,
    `<span class="spp-audit-engine">${escapeHtml(entry.engine)}${entry.modelConsulted ? "+model" : ""}</span>`,
    `<span class="spp-audit-reason">${escapeHtml(entry.reason)}</span>`,
    `</div>`,
  ].join("");
}

/** Pure: one-line summary of a plan's steps. */
export function summarizePlan(steps: readonly { state: string }[]): string {
  const counts = { done: 0, active: 0, waiting: 0, err: 0 };
  for (const s of steps) {
    if (s.state === "done") counts.done++;
    else if (s.state === "active") counts.active++;
    else if (s.state === "err") counts.err++;
    else counts.waiting++;
  }
  const total = steps.length;
  if (total === 0) return "no steps";
  const parts: string[] = [`${counts.done}/${total} done`];
  if (counts.active > 0) parts.push(`${counts.active} active`);
  if (counts.err > 0) parts.push(`${counts.err} err`);
  return parts.join(" · ");
}

function stateIcon(state: string): string {
  // Non-emoji geometric / Latin glyphs only — design guideline §0
  // forbids emoji code points in chrome. ■ (U+25A0) and ○ (U+25CB)
  // come from the Geometric Shapes block; × is plain Latin (U+00D7).
  switch (state) {
    case "done":
      return "■";
    case "active":
      return "●";
    case "err":
      return "×";
    default:
      return "○";
  }
}

// escapeHtml moved to ./escape-html (F.3 / A13).
