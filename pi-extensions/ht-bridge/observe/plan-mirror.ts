/**
 * Plan mirror — when pi's assistant message contains a fenced JSON
 * array shaped like `[{id, title, state}, …]`, show it to the user
 * for accept/decline/discuss approval, then mirror accepted plans to
 * τ-mux's plan panel via the `plan.set` RPC. Useful immediately
 * because models often emit todos as text.
 *
 * Detection is intentionally loose:
 *   - Looks at every fenced code block (```json, ```js, plain ``` ).
 *   - Accepts `title|label|description|name` for the step title.
 *   - Accepts `state|status` and normalizes to {done, active, waiting, err}.
 *   - Requires at least one `title` field on the first element.
 *
 * The explicit `ht_plan_set` LLM-callable tool uses the same approval
 * helper. When both are active the tool path runs first; this fallback
 * only fires for messages that didn't already propose the plan via a
 * tool call.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Config } from "../lib/config";
import { debugEnabled } from "../lib/config";
import type { HtClient } from "../lib/ht-client";
import { extractText } from "../lib/messages";
import type { SurfaceContext } from "../lib/surface-context";
import {
  planApprovalResultText,
  requestPlanApproval,
} from "../tools/plan-approval";

interface PlanStep {
  id: string;
  title: string;
  state: "done" | "active" | "waiting" | "err";
}

const STATE_ALIASES: Record<string, PlanStep["state"]> = {
  done: "done",
  complete: "done",
  completed: "done",
  finished: "done",
  active: "active",
  in_progress: "active",
  "in-progress": "active",
  running: "active",
  doing: "active",
  waiting: "waiting",
  pending: "waiting",
  todo: "waiting",
  open: "waiting",
  error: "err",
  err: "err",
  failed: "err",
  failure: "err",
  blocked: "err",
};

function normalizeState(s: unknown): PlanStep["state"] {
  if (typeof s !== "string") return "waiting";
  return STATE_ALIASES[s.trim().toLowerCase()] ?? "waiting";
}

function pickTitle(o: any): string {
  if (typeof o.title === "string") return o.title.trim();
  if (typeof o.label === "string") return o.label.trim();
  if (typeof o.description === "string") return o.description.trim();
  if (typeof o.name === "string") return o.name.trim();
  return "";
}

function pickId(o: any, fallback: number): string {
  if (typeof o.id === "string" && o.id.trim()) return o.id.trim();
  if (typeof o.id === "number") return String(o.id);
  if (typeof o.key === "string" && o.key.trim()) return o.key.trim();
  return `step-${fallback}`;
}

/** Try to parse a single fenced or raw chunk as a plan array.
 *  Returns null on any failure. */
function tryParsePlan(raw: string): PlanStep[] | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const steps: PlanStep[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (!item || typeof item !== "object") return null;
    const title = pickTitle(item);
    if (!title) return null;
    steps.push({
      id: pickId(item, i),
      title,
      state: normalizeState((item as any).state ?? (item as any).status),
    });
  }
  return steps;
}

const FENCE_RE = /```(?:json|js|javascript)?\s*\n([\s\S]*?)```/gi;

/** Scan an assistant message for the most-recent plan-shaped JSON
 *  array. Falls back to raw text only when no fences are present
 *  (avoids picking up an inline `[{a:1}]` example from prose). */
export function findPlanInText(text: string): PlanStep[] | null {
  if (!text) return null;
  const fenced: string[] = [];
  for (const m of text.matchAll(FENCE_RE)) {
    fenced.push(m[1] ?? "");
  }
  const candidates = fenced.length > 0 ? fenced : [text];
  let last: PlanStep[] | null = null;
  for (const c of candidates) {
    const plan = tryParsePlan(c);
    if (plan) last = plan;
  }
  return last;
}

function queuePlanDiscussionFollowUp(
  pi: ExtensionAPI,
  approval: { action: "discuss"; feedback?: string; reason?: string },
): void {
  const text = [
    planApprovalResultText(approval),
    "The proposed plan was not published. Please discuss the feedback with the user and propose a revised plan only after addressing it.",
  ].join("\n\n");

  try {
    pi.sendUserMessage(text, { deliverAs: "followUp" });
  } catch (err) {
    if (debugEnabled()) {
      console.error(
        `[ht-bridge] plan-mirror follow-up failed: ${(err as Error).message}`,
      );
    }
  }
}

export function registerPlanMirror(
  pi: ExtensionAPI,
  _cfg: Config,
  ht: HtClient,
  ctx: SurfaceContext,
): void {
  let lastSig = ""; // dedup: don't republish identical plans

  pi.on("message_end", async (event: any, eventCtx: any) => {
    try {
      const msg = event?.message;
      if (!msg || msg.role !== "assistant") return;
      const text = extractText(msg.content);
      const plan = findPlanInText(text);
      if (!plan) return;
      const sig = JSON.stringify(plan);
      if (sig === lastSig) return;
      lastSig = sig;

      const approval = await requestPlanApproval({
        ht,
        surface: ctx,
        cwd: eventCtx?.cwd ?? ctx.cwd ?? process.cwd(),
        planName: plan[0]?.title,
        steps: plan,
        source: "assistant message",
        signal: eventCtx?.signal,
      });

      if (approval.action === "accept") {
        await ht.call("plan.set", {
          agent_id: ctx.agentId,
          surface_id: ctx.surfaceId || undefined,
          steps: plan,
        });
        return;
      }

      if (approval.action === "discuss") {
        queuePlanDiscussionFollowUp(pi, approval);
      }
    } catch (err) {
      if (debugEnabled()) {
        console.error(
          `[ht-bridge] plan-mirror failed: ${(err as Error).message}`,
        );
      }
    }
  });

  pi.on("session_shutdown", () => {
    // Don't clear the plan — the user may want to keep it visible
    // after pi exits. The plan panel collapses on its own when
    // nothing is active in any workspace.
    lastSig = "";
  });
}
