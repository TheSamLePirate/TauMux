// Shared wire contract between an extension and the τ-mux host. This mirrors
// `src/shared/extension-types.ts` in the host repo; the constant + payload
// shapes are the stable public contract, intentionally duplicated so the SDK
// has zero dependency on host internals.

/** Sentinel tag on every frontend⇄host postMessage envelope. */
export const EXT_BRIDGE_TAG = "taumux-ext" as const;

/** Frontend (iframe) → host. */
export type ExtensionFrontendPayload =
  | {
      kind: "rpc-request";
      id: string;
      method: string;
      params: Record<string, unknown>;
    }
  | { kind: "backend-message"; data: unknown }
  | { kind: "frontend-ready" };

/** Host → frontend (iframe). */
export type ExtensionHostPayload =
  | { kind: "rpc-response"; id: string; result?: unknown; error?: string }
  | { kind: "backend-message"; data: unknown }
  | { kind: "lifecycle"; state: "starting" | "ready" | "exited"; code?: number }
  | { kind: "resize"; width: number; height: number };

/** The bridge envelope carried by `postMessage`. */
export interface BridgeEnvelope<P> {
  source: typeof EXT_BRIDGE_TAG;
  payload: P;
}

/** A curated, typed view of the τ-mux control surfaces an extension can drive.
 *  Backed by the host's socket/Electrobun RPC. This is a growing subset — any
 *  method name accepted by the host can also be called via `call(method,
 *  params)`. */
export interface TauMuxApi {
  /** Raw escape hatch — call any RPC method by name. */
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;

  notification: {
    create(opts: {
      title: string;
      body?: string;
      surfaceId?: string;
    }): Promise<unknown>;
  };
  sidebar: {
    setStatus(opts: {
      key: string;
      value: unknown;
      workspaceId?: string;
      surfaceId?: string;
    }): Promise<unknown>;
    log(opts: { message: string; level?: string }): Promise<unknown>;
  };
  surface: {
    list(): Promise<unknown>;
    rename(opts: { surfaceId: string; title: string }): Promise<unknown>;
    sendText(opts: { surfaceId: string; text: string }): Promise<unknown>;
  };
  workspace: {
    list(): Promise<unknown>;
  };
  browser: {
    open(opts: { url: string; split?: boolean }): Promise<unknown>;
  };
  system: {
    version(): Promise<unknown>;
  };
}

/** Build the typed namespaced facade over a raw `call`. Shared by the backend
 *  and frontend SDKs so both expose an identical surface. */
export function makeApi(
  call: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): TauMuxApi {
  return {
    call,
    notification: {
      create: (o) => call("notification.create", o),
    },
    sidebar: {
      setStatus: (o) => call("sidebar.setStatus", o),
      log: (o) => call("sidebar.log", o),
    },
    surface: {
      list: () => call("surface.list", {}),
      rename: (o) => call("surface.rename", o),
      sendText: (o) => call("surface.send_text", o),
    },
    workspace: {
      list: () => call("workspace.list", {}),
    },
    browser: {
      open: (o) => call("browser.open", o),
    },
    system: {
      version: () => call("system.version", {}),
    },
  };
}
