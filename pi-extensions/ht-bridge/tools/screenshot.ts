/**
 * `ht_screenshot` — capture a τ-mux pane (defaults to the agent's
 * own surface, or any surface_id you pass) and write the PNG to disk.
 * Useful for inlining "what does the running app look like right
 * now" in the conversation.
 *
 * macOS-only — the bun-side handler shells out to `screencapture`.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { Config } from "../lib/config";
import type { HtClient } from "../lib/ht-client";
import type { SurfaceContext } from "../lib/surface-context";

const PARAMS = Type.Object({
  surfaceId: Type.Optional(
    Type.String({
      description:
        "Surface to capture. Defaults to the calling pi's own surface ($HT_SURFACE).",
    }),
  ),
  output: Type.Optional(
    Type.String({
      description:
        "Optional absolute output path. If omitted τ-mux writes to /tmp/ht-screenshot-…png and returns the path.",
    }),
  ),
  fullWindow: Type.Optional(
    Type.Boolean({
      description:
        "Capture the whole τ-mux window instead of a single surface.",
    }),
  ),
});

export function registerScreenshotTool(
  pi: ExtensionAPI,
  _cfg: Config,
  ht: HtClient,
  surface: SurfaceContext,
): void {
  pi.registerTool({
    name: "ht_screenshot",
    label: "Screenshot pane (τ-mux)",
    description:
      "Capture a PNG of a τ-mux surface (defaults to pi's own pane). Returns the saved path so you can `read` it next. macOS only.",
    promptSnippet: "Screenshot a τ-mux pane to a PNG file. macOS only.",
    promptGuidelines: [
      "Use ht_screenshot when you want to show or inspect the rendered output of a pane (e.g. a running web app via the browser pane).",
      "Pass surfaceId to capture a different pane than your own — find ids via ht_browser_open's return or `ht list-surfaces`.",
    ],
    parameters: PARAMS as any,
    async execute(_id, params: any) {
      try {
        const result = await ht.call<{ path?: string } | string>(
          "surface.screenshot",
          {
            surface_id: params.surfaceId ?? surface.surfaceId ?? undefined,
            output: params.output,
            full_window: params.fullWindow ?? false,
          },
        );
        const path =
          typeof result === "string"
            ? result
            : typeof result?.path === "string"
              ? result.path
              : "";
        return {
          content: [
            {
              type: "text",
              text: path
                ? `Screenshot saved → ${path}`
                : `Screenshot dispatched (no path returned).`,
            },
          ],
          details: { path: path || null },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `ht_screenshot failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  } as any);
}
