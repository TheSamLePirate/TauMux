/**
 * Agent-panel model + thinking helpers.
 *
 * Everything here is either a pure function over model metadata or a
 * small DOM-writer that only needs a few named elements. Keeping them
 * out of agent-panel.ts lets the response handler dedup its repeated
 * "apply model" / "apply thinking level" blocks (previously inlined 3×
 * in the 324-line handleResponse switch) and gives us a testable
 * surface.
 */

import { fmtK } from "./agent-panel-utils";

export interface AgentModelSummary {
  provider: string;
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

/** Thinking-level options, ordered from off → xhigh. Cycle order. */
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

/** Dot-color indicator per thinking level — surfaces intensity at a
 *  glance in the toolbar. Unknown levels fall back via
 *  `applyThinkingLevel`. */
export const THINKING_COLORS: Record<string, string> = {
  off: "rgba(255,255,255,0.25)",
  minimal: "rgba(255,255,255,0.4)",
  low: "#67e8f9",
  medium: "#a78bfa",
  high: "#f97316",
  xhigh: "#ef4444",
};

/** Normalize an arbitrary RPC record into an AgentModelSummary. */
export function toModelSummary(
  rec: Record<string, unknown>,
): AgentModelSummary {
  return {
    provider: (rec["provider"] as string) ?? "",
    id: (rec["id"] as string) ?? "",
    name: (rec["name"] as string) ?? (rec["id"] as string) ?? "",
    reasoning: rec["reasoning"] as boolean | undefined,
    input: Array.isArray(rec["input"]) ? (rec["input"] as string[]) : undefined,
    contextWindow: rec["contextWindow"] as number | undefined,
    maxTokens: rec["maxTokens"] as number | undefined,
    cost: (rec["cost"] as AgentModelSummary["cost"]) ?? undefined,
  };
}

/** Stable key used to identify a model across the scoped-models set.
 *  Just provider+id — names can change but the pair is stable. */
export function scopedModelKey(
  model: Pick<AgentModelSummary, "provider" | "id">,
): string {
  return `${model.provider}/${model.id}`;
}

/** Build the badge row shown in the toolbar meta strip for a model. */
export function buildModelBadges(model: AgentModelSummary): HTMLElement[] {
  const mk = (text: string, cls = "") => {
    const badge = document.createElement("span");
    badge.className = `agent-model-badge${cls ? ` ${cls}` : ""}`;
    badge.textContent = text;
    return badge;
  };
  const badges: HTMLElement[] = [
    mk(model.provider, "agent-model-badge-provider"),
  ];
  if (model.reasoning) badges.push(mk("reasoning"));
  if (model.input?.includes("image")) badges.push(mk("vision"));
  if (model.contextWindow) badges.push(mk(`${fmtK(model.contextWindow)} ctx`));
  if (model.maxTokens) badges.push(mk(`${fmtK(model.maxTokens)} out`));
  if (model.cost?.input != null && model.cost?.output != null) {
    badges.push(
      mk(
        `$${model.cost.input}/$${model.cost.output}`,
        "agent-model-badge-cost",
      ),
    );
  }
  return badges;
}

/** Apply a thinking level to the toolbar button + dot color. Before
 *  this helper existed, three different spots in handleResponse
 *  duplicated the element lookup + THINKING_COLORS read. */
export function applyThinkingLevel(
  elements: { thinkingBtnLabel: HTMLElement; toolbarEl: HTMLElement },
  level: string,
): void {
  elements.thinkingBtnLabel.textContent = level;
  const dot = elements.toolbarEl.querySelector(
    ".agent-tb-thinking .agent-tb-dot",
  ) as HTMLElement | null;
  if (dot) {
    dot.style.background = THINKING_COLORS[level] ?? "var(--text-dim)";
  }
}

/** Write a model's display name into the toolbar model button label. */
export function applyModelLabel(
  elements: { modelBtnLabel: HTMLElement },
  model: AgentModelSummary,
): void {
  elements.modelBtnLabel.textContent = model.name || model.id || "No model";
}
