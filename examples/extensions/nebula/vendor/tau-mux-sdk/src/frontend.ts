// Frontend SDK — runs inside the extension's Vite app (the iframe). Drives
// τ-mux control surfaces via a postMessage bridge to the host (which dispatches
// through the same RPC the CLI uses), and exchanges app-level messages with the
// extension's own Bun backend.

import {
  EXT_BRIDGE_TAG,
  makeApi,
  type BridgeEnvelope,
  type ExtensionFrontendPayload,
  type ExtensionHostPayload,
  type TauMuxApi,
} from "./protocol";

export interface FrontendSdk extends TauMuxApi {
  /** Receive an app-level message pushed from the extension's Bun backend. */
  onBackendMessage(handler: (data: unknown) => void): void;
  /** Send an app-level message to the extension's Bun backend. */
  sendToBackend(data: unknown): void;
  /** Pane resize notifications (host → frontend). */
  onResize(handler: (size: { width: number; height: number }) => void): void;
  /** Backend lifecycle (starting / ready / exited). */
  onLifecycle(
    handler: (state: "starting" | "ready" | "exited", code?: number) => void,
  ): void;
}

function post(payload: ExtensionFrontendPayload): void {
  const envelope: BridgeEnvelope<ExtensionFrontendPayload> = {
    source: EXT_BRIDGE_TAG,
    payload,
  };
  window.parent.postMessage(envelope, "*");
}

/** Create the frontend SDK. Call once when your app mounts. */
export function createFrontendSdk(): FrontendSdk {
  let nextId = 1;
  const pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  let backendHandler: ((data: unknown) => void) | null = null;
  let resizeHandler: ((s: { width: number; height: number }) => void) | null =
    null;
  let lifecycleHandler:
    | ((state: "starting" | "ready" | "exited", code?: number) => void)
    | null = null;

  window.addEventListener("message", (e: MessageEvent) => {
    // Only accept messages from the host (our parent frame).
    if (e.source !== window.parent) return;
    const data = e.data as BridgeEnvelope<ExtensionHostPayload> | null;
    if (!data || data.source !== EXT_BRIDGE_TAG) return;
    const payload = data.payload;
    switch (payload.kind) {
      case "rpc-response": {
        const entry = pending.get(payload.id);
        if (!entry) return;
        pending.delete(payload.id);
        if (payload.error) entry.reject(new Error(payload.error));
        else entry.resolve(payload.result);
        break;
      }
      case "backend-message":
        backendHandler?.(payload.data);
        break;
      case "resize":
        resizeHandler?.({ width: payload.width, height: payload.height });
        break;
      case "lifecycle":
        lifecycleHandler?.(payload.state, payload.code);
        break;
    }
  });

  const call = (
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> => {
    const id = String(nextId++);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({ kind: "rpc-request", id, method, params });
    });
  };

  // Tell the host we've mounted (reserved for future queued-message replay).
  post({ kind: "frontend-ready" });

  const api = makeApi(call);
  return {
    ...api,
    onBackendMessage(handler) {
      backendHandler = handler;
    },
    sendToBackend(data) {
      post({ kind: "backend-message", data });
    },
    onResize(handler) {
      resizeHandler = handler;
    },
    onLifecycle(handler) {
      lifecycleHandler = handler;
    },
  };
}
