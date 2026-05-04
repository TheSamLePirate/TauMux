/**
 * Plan tools — `ht_plan_set`, `ht_plan_update`, `ht_plan_complete`.
 * Give the LLM explicit structured plan ops so the τ-mux plan panel
 * tracks pi's multi-step work without the textual sniff fallback. New
 * plans include a detailed markdown file under `.pi/plans/` for user
 * review before the concise sidebar steps are published.
 *
 * Plan-mirror (Phase 2) still runs in parallel: if pi calls the tools,
 * the panel updates via the precise path; if pi just emits JSON in
 * prose, the mirror catches that as a backup. The first to publish a
 * step wins; subsequent updates dedupe by signature.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import type { Config } from "../lib/config";
import type { HtClient } from "../lib/ht-client";
import type { SurfaceContext } from "../lib/surface-context";
import {
  planApprovalResultText,
  requestPlanApproval,
} from "./plan-approval";

const STATE_ENUM = StringEnum(["done", "active", "waiting", "err"] as const);

const SET_PARAMS = Type.Object({
  planName: Type.Optional(
    Type.String({
      description:
        "Short filename-friendly name for the detailed markdown plan saved under .pi/plans/<planName>.md.",
    }),
  ),
  detailedPlanMarkdown: Type.Optional(
    Type.String({
      description:
        "Full detailed markdown plan for the user to review before accepting. Include objective, approach, files/areas to inspect, validation, risks, and rollback/cleanup notes.",
    }),
  ),
  steps: Type.Array(
    Type.Object({
      id: Type.String({
        description:
          "Short opaque id (e.g. M1, step-3). Stable across updates.",
      }),
      title: Type.String({ description: "Human-readable step title." }),
      state: Type.Optional(STATE_ENUM),
    }),
    { description: "The full ordered list of plan steps." },
  ),
});

const UPDATE_PARAMS = Type.Object({
  stepId: Type.String({
    description: "id of the step to update (must match a previously set step).",
  }),
  state: STATE_ENUM,
  title: Type.Optional(Type.String()),
});

const NO_PARAMS = Type.Object({});

export function registerPlanTools(
  pi: ExtensionAPI,
  _cfg: Config,
  ht: HtClient,
  surface: SurfaceContext,
): void {
  const baseParams = {
    agent_id: surface.agentId,
    surface_id: surface.surfaceId || undefined,
  };

  pi.registerTool({
    name: "ht_plan_set",
    label: "Propose plan (τ-mux)",
    description:
      "Propose a multi-step plan for τ-mux's plan panel. Also provide a full detailed markdown plan; ht-bridge saves it to .pi/plans/<planName>.md, shows that file path to the user, and publishes the sidebar steps only if the user accepts.",
    promptSnippet:
      "Propose a structured plan for τ-mux's sidebar and write a detailed .pi/plans/*.md plan for user review; publication waits for user approval.",
    promptGuidelines: [
      "Use ht_plan_set at the start of any non-trivial multi-step task (3+ steps).",
      "Always include planName and detailedPlanMarkdown when calling ht_plan_set; the markdown should be a full detailed plan with objective, approach, impacted files/areas, validation, risks, and rollback/cleanup notes.",
      "ht_plan_set writes the detailed plan to .pi/plans/<planName>.md and asks the user to accept, decline, or discuss before publishing sidebar steps; if they decline or discuss, do not blindly retry the same plan.",
      "Keep sidebar plan steps concise — title under 60 chars, e.g. 'Read the auth tests'. Derive these steps from the detailed markdown plan.",
      "Mark exactly one step as state='active' at a time; the rest 'waiting' or 'done'.",
    ],
    parameters: SET_PARAMS as any,
    async execute(
      _id,
      params: any,
      signal?: AbortSignal,
      _onUpdate?: unknown,
      toolCtx?: { cwd?: string },
    ) {
      try {
        const approval = await requestPlanApproval({
          ht,
          surface,
          cwd: toolCtx?.cwd ?? surface.cwd ?? process.cwd(),
          planName: params.planName,
          detailedPlanMarkdown: params.detailedPlanMarkdown,
          steps: params.steps,
          source: "ht_plan_set",
          signal,
        });

        if (approval.action !== "accept") {
          return {
            content: [
              {
                type: "text",
                text: `${planApprovalResultText(approval)}\nPlan not set.`,
              },
            ],
            details: { steps: params.steps, approval, published: false },
          };
        }

        await ht.call("plan.set", { ...baseParams, steps: params.steps });
        return {
          content: [
            {
              type: "text",
              text: `Plan approved and set — ${params.steps.length} step(s).`,
            },
          ],
          details: { steps: params.steps, approval, published: true },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `ht_plan_set failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  } as any);

  pi.registerTool({
    name: "ht_plan_update",
    label: "Update plan step (τ-mux)",
    description:
      "Update a single plan step's state (or title) in τ-mux. Use to mark a step done before moving to the next.",
    promptSnippet: "Mark a plan step done/active/waiting/err in τ-mux.",
    promptGuidelines: [
      "Use ht_plan_update each time you finish a step (state='done') and start the next (state='active').",
      "Use state='err' when a step fails so the panel renders it red.",
    ],
    parameters: UPDATE_PARAMS as any,
    async execute(_id, params: any) {
      try {
        await ht.call("plan.update", {
          ...baseParams,
          step_id: params.stepId,
          state: params.state,
          title: params.title,
        });
        return {
          content: [
            {
              type: "text",
              text: `Plan step ${params.stepId} → ${params.state}.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `ht_plan_update failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  } as any);

  pi.registerTool({
    name: "ht_plan_complete",
    label: "Complete plan (τ-mux)",
    description:
      "Mark every step done and clear the τ-mux plan panel. Call after the whole task is finished.",
    promptSnippet: "Clear the τ-mux plan panel after finishing the whole task.",
    promptGuidelines: [
      "Use ht_plan_complete only when the entire multi-step task is finished — not after each step.",
    ],
    parameters: NO_PARAMS as any,
    async execute() {
      try {
        await ht.call("plan.complete", baseParams);
        await ht.call("plan.clear", baseParams).catch(() => {
          /* clear is idempotent — complete is the user-visible signal */
        });
        return {
          content: [
            { type: "text", text: "Plan marked complete and cleared." },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `ht_plan_complete failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  } as any);
}
