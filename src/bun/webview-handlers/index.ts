/**
 * Aggregate registrar for every webview-facing message handler.
 *
 * Each domain file exports a `register*WebviewHandlers(ctx)` that
 * returns a `Partial<BunMessageHandlers>`. We merge them with a single
 * object-spread expression and stamp the result with
 * `satisfies BunMessageHandlers` so the exhaustiveness check that used
 * to live in `src/bun/index.ts` is preserved — adding a new wire
 * message to `TauMuxRPC["bun"]["messages"]` without a matching handler
 * still fails the typecheck.
 */
import { registerAgentWebviewHandlers } from "./agent";
import { registerAskUserWebviewHandlers } from "./ask-user";
import { registerBrowserWebviewHandlers } from "./browser";
import { registerClaudeWebviewHandlers } from "./claude";
import { registerClipboardWebviewHandlers } from "./clipboard";
import { registerEditorWebviewHandlers } from "./editor";
import { registerExtensionWebviewHandlers } from "./extension";
import { registerNotificationWebviewHandlers } from "./notification";
import { registerPlanWebviewHandlers } from "./plan";
import { registerReplyWebviewHandlers } from "./reply";
import { registerSurfaceWebviewHandlers } from "./surface";
import { registerSystemWebviewHandlers } from "./system";
import { registerTelegramWebviewHandlers } from "./telegram";
import { registerViewportWebviewHandlers } from "./viewport";
import { registerWorkspaceWebviewHandlers } from "./workspace";
import type { BunMessageHandlers, WebviewHandlerContext } from "./types";

export {
  createWebviewHandlerContext,
  type BunMessageHandlers,
  type WebviewHandlerContext,
  type WebviewHandlerLateBindings,
  type WebviewRpc,
} from "./types";

/** Build the full handler map. Returned object is the exact shape
 *  Electrobun's `BrowserView.defineRPC({ handlers: { messages } })`
 *  expects, with the `satisfies` guard intact. */
export function buildBunMessageHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlers {
  return {
    ...registerClipboardWebviewHandlers(ctx),
    ...registerViewportWebviewHandlers(ctx),
    ...registerSurfaceWebviewHandlers(ctx),
    ...registerReplyWebviewHandlers(ctx),
    ...registerWorkspaceWebviewHandlers(ctx),
    ...registerNotificationWebviewHandlers(ctx),
    ...registerPlanWebviewHandlers(ctx),
    ...registerSystemWebviewHandlers(ctx),
    ...registerBrowserWebviewHandlers(ctx),
    ...registerAgentWebviewHandlers(ctx),
    ...registerTelegramWebviewHandlers(ctx),
    ...registerClaudeWebviewHandlers(ctx),
    ...registerEditorWebviewHandlers(ctx),
    ...registerExtensionWebviewHandlers(ctx),
    ...registerAskUserWebviewHandlers(ctx),
  } satisfies BunMessageHandlers;
}
