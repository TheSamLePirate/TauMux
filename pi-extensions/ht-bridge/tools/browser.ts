/**
 * Browser tools — `ht_browser_open`, `ht_browser_navigate`,
 * `ht_browser_close`. Give pi the ability to drive a τ-mux browser
 * pane during the agent loop (e.g. inspecting docs, opening the
 * running app under test).
 *
 * v1 scope is intentionally narrow: open + navigate + close. The
 * read-back surfaces (`snapshot`, `eval`, `console_list`,
 * `errors_list`) return their results asynchronously via the
 * webview's host-message channel, which doesn't reduce to a single
 * RPC reply. Wiring them through cleanly is follow-up work.
 *
 * The newly-opened browser surface id is stashed in module scope so
 * subsequent `ht_browser_navigate` calls reuse the same pane instead
 * of stacking new ones.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { Config } from "../lib/config";
import type { HtClient } from "../lib/ht-client";

const OPEN_PARAMS = Type.Object({
  url: Type.String({
    description: "URL to open. Must include http:// or https://.",
  }),
  split: Type.Optional(
    Type.Boolean({
      description:
        "When true, opens the browser as a new pane split (default: replaces current focus).",
    }),
  ),
});

const NAV_PARAMS = Type.Object({
  url: Type.String({
    description: "URL to navigate the existing browser pane to.",
  }),
});

const NO_PARAMS = Type.Object({});

export function registerBrowserTools(
  pi: ExtensionAPI,
  _cfg: Config,
  ht: HtClient,
): void {
  let lastBrowserSurface: string | null = null;

  pi.registerTool({
    name: "ht_browser_open",
    label: "Open browser pane (τ-mux)",
    description:
      "Open a τ-mux built-in browser pane at the given URL. Returns the new surface id. If you've already opened one this session, this opens a second; use ht_browser_navigate to reuse it.",
    promptSnippet:
      "Open a built-in τ-mux browser pane at a URL. Useful for inspecting docs or the running app.",
    promptGuidelines: [
      "Use ht_browser_open when you need to look at a real rendered web page during the task.",
      "Prefer ht_browser_navigate over ht_browser_open if the user already has a browser pane up.",
    ],
    parameters: OPEN_PARAMS as any,
    async execute(_id, params: any) {
      try {
        const method = params.split ? "browser.open_split" : "browser.open";
        const result = await ht.call<unknown>(method, { url: params.url });
        // The RPC handler returns "OK" but also dispatches a webview
        // event that the surface registry observes; the new surface
        // id isn't directly returned from the RPC. We try
        // browser.list afterward to capture it.
        try {
          const list = (await ht.call<Array<{ id: string; url?: string }>>(
            "browser.list",
            {},
          )) as Array<{ id: string; url?: string }>;
          const fresh = list.find((s) => s.url?.startsWith(params.url));
          if (fresh) lastBrowserSurface = fresh.id;
          else if (list.length > 0)
            lastBrowserSurface = list[list.length - 1]?.id ?? null;
        } catch {
          /* best effort — even without an id we still opened the pane */
        }
        return {
          content: [
            {
              type: "text",
              text: lastBrowserSurface
                ? `Opened browser pane ${lastBrowserSurface} → ${params.url}`
                : `Opened browser pane → ${params.url} (raw: ${String(result)})`,
            },
          ],
          details: { surfaceId: lastBrowserSurface, url: params.url },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `ht_browser_open failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  } as any);

  pi.registerTool({
    name: "ht_browser_navigate",
    label: "Navigate browser pane (τ-mux)",
    description:
      "Navigate the most-recently-opened τ-mux browser pane to a new URL. Errors if no browser pane has been opened yet — call ht_browser_open first.",
    promptSnippet: "Navigate the existing τ-mux browser pane to a new URL.",
    promptGuidelines: [
      "Use ht_browser_navigate when you've already opened a browser pane and want to follow a link or visit a different page.",
    ],
    parameters: NAV_PARAMS as any,
    async execute(_id, params: any) {
      if (!lastBrowserSurface) {
        return {
          content: [
            {
              type: "text",
              text: "No browser pane to navigate. Call ht_browser_open first.",
            },
          ],
          isError: true,
        };
      }
      try {
        await ht.call("browser.navigate", {
          surface_id: lastBrowserSurface,
          url: params.url,
        });
        return {
          content: [
            {
              type: "text",
              text: `Navigated ${lastBrowserSurface} → ${params.url}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `ht_browser_navigate failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  } as any);

  pi.registerTool({
    name: "ht_browser_close",
    label: "Close browser pane (τ-mux)",
    description: "Close the most-recently-opened τ-mux browser pane.",
    promptSnippet: "Close the τ-mux browser pane when no longer needed.",
    promptGuidelines: [
      "Use ht_browser_close once you no longer need the browser pane to keep the user's layout tidy.",
    ],
    parameters: NO_PARAMS as any,
    async execute() {
      if (!lastBrowserSurface) {
        return {
          content: [{ type: "text", text: "No browser pane to close." }],
        };
      }
      try {
        await ht.call("browser.close", { surface_id: lastBrowserSurface });
        const closed = lastBrowserSurface;
        lastBrowserSurface = null;
        return {
          content: [{ type: "text", text: `Closed browser pane ${closed}.` }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `ht_browser_close failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  } as any);
}
