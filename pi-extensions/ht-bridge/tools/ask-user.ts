/**
 * `ht_ask_user` — LLM-callable tool that pops a τ-mux modal (and
 * mirrors to Telegram) to ask the human a structured question, then
 * blocks until they answer / cancel / time out.
 *
 *   kind=yesno   → "yes"/"no"
 *   kind=choice  → choice id selected from `choices: [{id,label}]`
 *   kind=text    → free-text reply (or `default` if user didn't type)
 *
 * Returns a tool-result with the typed `value` field; cancel/timeout
 * surface as `isError: true` so pi can decide whether to retry or
 * abandon.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { Config } from "../lib/config";
import type { HtClient } from "../lib/ht-client";
import type { SurfaceContext } from "../lib/surface-context";

const PARAMS = Type.Object({
  kind: StringEnum(["yesno", "choice", "text"] as const, {
    description:
      "Kind of question. yesno → yes/no buttons, choice → pick from choices[], text → free text reply.",
  }),
  title: Type.String({
    description: "Short one-line title shown at the top of the modal.",
  }),
  body: Type.Optional(
    Type.String({
      description: "Optional multi-line body for context. Plain text only.",
    }),
  ),
  choices: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.String(),
        label: Type.String(),
      }),
      {
        description:
          "Required when kind=choice. Each entry is one selectable option.",
      },
    ),
  ),
  default: Type.Optional(
    Type.String({
      description:
        "Default value pre-filled in the modal (kind=text) or pre-selected (kind=choice).",
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Number({
      description:
        "Auto-timeout in milliseconds. Default 5 minutes. Pass 0 to wait indefinitely.",
    }),
  ),
});

export function registerAskUserTool(
  pi: ExtensionAPI,
  _cfg: Config,
  ht: HtClient,
  surface: SurfaceContext,
): void {
  pi.registerTool({
    name: "ht_ask_user",
    label: "Ask the user (τ-mux)",
    description:
      "Pop a modal in τ-mux to ask the human a structured question. Blocks until they answer. Mirrors to Telegram if configured. Use only when you genuinely need user input — don't ask trivial questions.",
    promptSnippet:
      "Ask the human a structured question via a τ-mux modal (yes/no, choice, or free text).",
    promptGuidelines: [
      "Use ht_ask_user when the request is ambiguous and one clarifying question would unblock the work.",
      "Prefer kind=choice with 2-4 options over kind=text when possible — easier on a phone via Telegram.",
      "Do NOT use ht_ask_user to ask permission for routine bash commands; the τ-mux bash-safety gate already handles dangerous ones.",
    ],
    parameters: PARAMS as any,
    async execute(_id, params: any) {
      if (!surface.surfaceId) {
        return {
          content: [
            {
              type: "text",
              text: "ht_ask_user is unavailable: pi is not running inside a τ-mux pane (no $HT_SURFACE).",
            },
          ],
          isError: true,
        };
      }

      try {
        const resp = await ht.call<{
          action: "ok" | "cancel" | "timeout";
          value?: string;
          reason?: string;
        }>(
          "agent.ask_user",
          {
            surface_id: surface.surfaceId,
            agent_id: surface.agentId,
            kind: params.kind,
            title: params.title,
            body: params.body,
            choices: params.choices,
            default: params.default,
            timeout_ms: params.timeoutMs,
          },
          { timeoutMs: 0 },
        );

        if (resp.action === "ok") {
          return {
            content: [
              {
                type: "text",
                text: `User answered: ${resp.value ?? ""}`,
              },
            ],
            details: resp,
          };
        }

        const why =
          resp.action === "timeout"
            ? "User did not respond in time."
            : `User cancelled${resp.reason ? `: ${resp.reason}` : "."}`;
        return {
          content: [{ type: "text", text: why }],
          details: resp,
          isError: true,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `ht_ask_user failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  } as any);
}
