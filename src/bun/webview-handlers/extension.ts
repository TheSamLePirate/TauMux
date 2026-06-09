import type {
  ExtensionFrontendPayload,
  ExtensionHostPayload,
} from "../../shared/extension-types";
import type { BunMessageHandlerSlice, WebviewHandlerContext } from "./types";

type Keys =
  | "createExtensionSurface"
  | "splitExtensionSurface"
  | "extensionFrontendMessage"
  | "requestExtensionList";

/** Extension-app surface lifecycle + the frontend⇄host bridge.
 *
 * `extensionFrontendMessage` carries an opaque `ExtensionFrontendPayload`
 * posted by the iframe's SDK. Two routes:
 *  - `rpc-request` → dispatched through the SAME socket handler the CLI uses
 *    (so the frontend drives every control surface), reply pushed back as a
 *    `rpc-response`. This does NOT touch the extension's own Bun backend.
 *  - `backend-message` → forwarded to the extension's backend process stdin;
 *    its stdout JSONL comes back as `backend-message` host payloads (wired in
 *    `index.ts` via `ExtensionManager.onHostPayload`). */
export function registerExtensionWebviewHandlers(
  ctx: WebviewHandlerContext,
): BunMessageHandlerSlice<Keys> {
  return {
    createExtensionSurface: (payload) => {
      ctx.createExtensionWorkspaceSurface(payload.extensionId);
    },
    splitExtensionSurface: (payload) => {
      ctx.splitExtensionSurface(payload.direction, payload.extensionId);
    },
    extensionFrontendMessage: async (payload) => {
      const surfaceId = payload.surfaceId;
      const msg = payload.payload as ExtensionFrontendPayload | null;
      if (!msg || typeof msg !== "object") return;
      if (msg.kind === "rpc-request") {
        let response: ExtensionHostPayload;
        try {
          const result = await ctx.socketHandler(msg.method, msg.params ?? {});
          response = { kind: "rpc-response", id: msg.id, result };
        } catch (err) {
          response = {
            kind: "rpc-response",
            id: msg.id,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        ctx.rpc.send("extensionBackendMessage", {
          surfaceId,
          payload: response,
        });
      } else if (msg.kind === "backend-message") {
        ctx.extensionManager.forwardToBackend(surfaceId, msg.data);
      }
      // `frontend-ready` is a no-op in v1 (no queued-message replay yet).
    },
    requestExtensionList: () => {
      ctx.rpc.send("extensionList", {
        extensions: ctx.extensionManager.list().map((d) => ({
          id: d.manifest.id,
          name: d.manifest.name,
          icon: d.manifest.icon,
          hasBuild: d.hasBuild,
        })),
      });
    },
  };
}
