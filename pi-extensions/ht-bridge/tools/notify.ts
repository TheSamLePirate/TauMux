/**
 * `ht_notify` — fire a τ-mux notification (Mac toast + Telegram
 * forward, when configured). Useful at task milestones or when pi
 * surfaces a result the user should see even if they're not watching
 * the terminal.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { Config } from "../lib/config";
import type { HtClient } from "../lib/ht-client";
import type { SurfaceContext } from "../lib/surface-context";

const PARAMS = Type.Object({
  title: Type.String({ description: "Bold first line of the notification." }),
  body: Type.Optional(
    Type.String({
      description: "Optional multi-line body shown under the title.",
    }),
  ),
  subtitle: Type.Optional(
    Type.String({ description: "Optional subtitle (Mac native field)." }),
  ),
});

export function registerNotifyTool(
  pi: ExtensionAPI,
  cfg: Config,
  ht: HtClient,
  surface: SurfaceContext,
): void {
  pi.registerTool({
    name: "ht_notify",
    label: "Notify user (τ-mux)",
    description:
      "Fire a τ-mux notification (Mac toast + Telegram forward when configured). Use at task milestones — completion, found something, hit a blocker — when the user might not be looking at the terminal.",
    promptSnippet:
      "Fire a τ-mux notification (toast + Telegram) when finishing or hitting a milestone.",
    promptGuidelines: [
      "Use ht_notify when you finish a long task, find a notable result, or hit a blocker the user should know about.",
      "Don't ht_notify on every tool call — once or twice per multi-minute task is the right cadence.",
    ],
    parameters: PARAMS as any,
    async execute(_id, params: any) {
      try {
        await ht.call("notification.create", {
          surface_id: surface.surfaceId || undefined,
          title: params.title,
          body: params.body,
          subtitle: params.subtitle ?? cfg.notifySubtitle,
        });
        return { content: [{ type: "text", text: "Notification sent." }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `ht_notify failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  } as any);
}
