/**
 * Shared approval gate for proposed agent plans.
 *
 * Both explicit `ht_plan_set` tool calls and the textual plan mirror
 * route through this helper before publishing a fresh plan to τ-mux.
 * The full detailed plan is written to `.pi/plans/<plan-name>.md`
 * inside the project before the approval modal opens, so the user can
 * review the markdown file and then accept, decline, or ask the agent
 * to discuss/revise first.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { HtClient } from "../lib/ht-client";
import type { SurfaceContext } from "../lib/surface-context";

export interface ApprovalPlanStep {
  id: string;
  title: string;
  state?: string;
}

export interface PlanFileInfo {
  planName: string;
  relativePath: string;
  absolutePath: string;
}

export type PlanApprovalDecision =
  | { action: "accept"; planFile?: PlanFileInfo }
  | { action: "decline"; reason?: string; planFile?: PlanFileInfo }
  | {
      action: "discuss";
      feedback?: string;
      reason?: string;
      planFile?: PlanFileInfo;
    };

interface AskUserResponse {
  action: "ok" | "cancel" | "timeout";
  value?: string;
  reason?: string;
}

export interface RequestPlanApprovalOptions {
  ht: Pick<HtClient, "call">;
  surface: SurfaceContext;
  steps: readonly ApprovalPlanStep[];
  /** Project directory where `.pi/plans/` should be created. Prefer
   *  pi's `ctx.cwd`; falls back to the τ-mux surface cwd / process cwd. */
  cwd?: string | null;
  /** Human-readable plan name. Sanitized before becoming the filename. */
  planName?: string;
  /** Full detailed markdown plan authored by the agent. If omitted,
   *  a conservative markdown plan is generated from the step list. */
  detailedPlanMarkdown?: string;
  /** Label included in the modal body, e.g. "ht_plan_set" or
   *  "assistant message". */
  source?: string;
  /** Passed to both the τ-mux ask modal and the RPC call. `0` means
   *  wait indefinitely, matching `/ht-ask`'s blocking behaviour. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

const PLAN_APPROVAL_CHOICES = [
  { id: "accept", label: "Accept — publish this plan" },
  { id: "decline", label: "Decline — do not publish" },
  { id: "discuss", label: "Talk about it / revise first" },
];

export function formatPlanForApproval(
  steps: readonly ApprovalPlanStep[],
): string {
  return steps
    .map((step, i) => {
      const id = cleanText(step.id) || `step-${i + 1}`;
      const title = cleanText(step.title) || id;
      return `${stateGlyph(step.state)} ${id} — ${title}`;
    })
    .join("\n");
}

export function buildDetailedPlanMarkdown(opts: {
  planName?: string;
  detailedPlanMarkdown?: string;
  steps: readonly ApprovalPlanStep[];
  source?: string;
  now?: () => Date;
}): string {
  const title = cleanText(opts.planName ?? "") || defaultPlanName(opts.steps);
  const detail = String(opts.detailedPlanMarkdown ?? "").trim();
  const now = opts.now?.() ?? new Date();
  const header = [
    `# ${title}`,
    "",
    `- Source: ${cleanText(opts.source ?? "agent") || "agent"}`,
    `- Created: ${now.toISOString()}`,
    "",
    "## Sidebar steps",
    "",
    ...opts.steps.map(
      (s, i) =>
        `- [${checkboxState(s.state)}] **${cleanText(s.id) || `step-${i + 1}`}** — ${cleanText(s.title) || cleanText(s.id) || `Step ${i + 1}`}`,
    ),
    "",
  ].join("\n");

  if (detail) {
    return `${header}## Detailed plan\n\n${detail}\n`;
  }

  return `${header}## Detailed plan\n\n${opts.steps
    .map((s, i) => {
      const id = cleanText(s.id) || `step-${i + 1}`;
      const title = cleanText(s.title) || id;
      return [`### ${id} — ${title}`, "", "- Goal: Complete this step safely and verify the outcome.", "- Notes: Add task-specific details before starting if more precision is needed."].join(
        "\n",
      );
    })
    .join("\n\n")}\n`;
}

export async function writeDetailedPlanFile(opts: {
  cwd?: string | null;
  planName?: string;
  detailedPlanMarkdown?: string;
  steps: readonly ApprovalPlanStep[];
  source?: string;
}): Promise<PlanFileInfo> {
  const root = resolve(opts.cwd || process.cwd());
  const planName = sanitizePlanName(opts.planName || defaultPlanName(opts.steps));
  const relativePath = `.pi/plans/${planName}.md`;
  const absolutePath = join(root, relativePath);
  const markdown = buildDetailedPlanMarkdown({
    planName: opts.planName || planName,
    detailedPlanMarkdown: opts.detailedPlanMarkdown,
    steps: opts.steps,
    source: opts.source,
  });

  await mkdir(join(root, ".pi", "plans"), { recursive: true });
  await writeFile(absolutePath, markdown, "utf8");
  return { planName, relativePath, absolutePath };
}

export function buildPlanApprovalBody(opts: {
  steps: readonly ApprovalPlanStep[];
  source?: string;
  planFile?: PlanFileInfo;
}): string {
  const source = opts.source ?? "agent";
  const planText = formatPlanForApproval(opts.steps);
  const file = opts.planFile;
  return [
    `The agent wants to publish this plan from ${source}:`,
    "",
    planText || "(empty plan)",
    "",
    file
      ? `Detailed markdown plan saved to:\n${file.relativePath}\n\nAbsolute path:\n${file.absolutePath}`
      : "Detailed markdown plan file was not written.",
    "",
    "Review the markdown file if you want the full detail. Accept to show the sidebar steps in τ-mux, decline to leave the panel unchanged, or talk about it to send feedback back to the agent first.",
  ].join("\n");
}

export async function requestPlanApproval(
  opts: RequestPlanApprovalOptions,
): Promise<PlanApprovalDecision> {
  const { ht, surface, steps, source = "agent", signal } = opts;
  const timeoutMs = opts.timeoutMs ?? 0;

  if (!surface.surfaceId) {
    return {
      action: "decline",
      reason: "Cannot request plan approval: missing τ-mux surface id.",
    };
  }

  const planFile = await writeDetailedPlanFile({
    cwd: opts.cwd ?? surface.cwd ?? process.cwd(),
    planName: opts.planName,
    detailedPlanMarkdown: opts.detailedPlanMarkdown,
    steps,
    source,
  });
  const body = buildPlanApprovalBody({ steps, source, planFile });
  const choice = await ht.call<AskUserResponse>(
    "agent.ask_user",
    {
      surface_id: surface.surfaceId,
      agent_id: surface.agentId,
      kind: "choice",
      title: "Review proposed plan",
      body,
      choices: PLAN_APPROVAL_CHOICES,
      default: "accept",
      timeout_ms: timeoutMs,
    },
    { timeoutMs, signal },
  );

  if (choice.action !== "ok") {
    return {
      action: "decline",
      planFile,
      reason:
        choice.action === "timeout"
          ? "Plan approval timed out."
          : `Plan approval cancelled${choice.reason ? `: ${choice.reason}` : "."}`,
    };
  }

  if (choice.value === "accept") return { action: "accept", planFile };
  if (choice.value === "decline") return { action: "decline", planFile };
  if (choice.value !== "discuss") {
    return {
      action: "decline",
      planFile,
      reason: `Unknown plan approval response: ${choice.value ?? ""}`,
    };
  }

  const feedback = await ht.call<AskUserResponse>(
    "agent.ask_user",
    {
      surface_id: surface.surfaceId,
      agent_id: surface.agentId,
      kind: "text",
      title: "What should change in the plan?",
      body,
      default: "",
      timeout_ms: timeoutMs,
    },
    { timeoutMs, signal },
  );

  if (feedback.action === "ok") {
    return { action: "discuss", feedback: feedback.value ?? "", planFile };
  }

  return {
    action: "discuss",
    planFile,
    reason:
      feedback.action === "timeout"
        ? "Plan discussion prompt timed out."
        : `Plan discussion cancelled${feedback.reason ? `: ${feedback.reason}` : "."}`,
  };
}

export function planApprovalResultText(
  decision: PlanApprovalDecision,
): string {
  const file = decision.planFile
    ? `\nDetailed plan: ${decision.planFile.relativePath}`
    : "";
  if (decision.action === "accept") {
    return `User accepted the proposed plan.${file}`;
  }
  if (decision.action === "decline") {
    return `User declined the proposed plan${decision.reason ? `: ${decision.reason}` : "."}${file}`;
  }
  const feedback = cleanText(decision.feedback ?? "");
  if (feedback) {
    return `User wants to discuss/revise the proposed plan before publishing:\n${feedback}${file}`;
  }
  return `User wants to discuss/revise the proposed plan before publishing${decision.reason ? `: ${decision.reason}` : "."}${file}`;
}

export function sanitizePlanName(input: string): string {
  const base = cleanText(input)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "plan";
}

function defaultPlanName(steps: readonly ApprovalPlanStep[]): string {
  const active = steps.find((s) => s.state === "active") ?? steps[0];
  return cleanText(active?.title ?? active?.id ?? "plan") || "plan";
}

function cleanText(v: string): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function checkboxState(state: unknown): string {
  return state === "done" ? "x" : " ";
}

function stateGlyph(state: unknown): string {
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
