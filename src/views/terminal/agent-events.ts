/**
 * Agent-pane DOM event → RPC bridge.
 *
 * Before this module existed, 28 nearly-identical
 * `window.addEventListener("ht-agent-*", ...)` blocks lived at the
 * top level of src/views/terminal/index.ts. Each one pulled detail
 * off a CustomEvent, optionally validated required fields, and
 * forwarded the payload to rpc.send with a matching method name.
 *
 * Moving them here keeps the webview entry focused on bootstrapping
 * (RPC setup, panel construction, layout glue) rather than being a
 * transcript of every event the agent panel can fire.
 *
 * The route table is pure data: see `AGENT_EVENT_ROUTES`. Special
 * cases that need side effects beyond rpc.send (agentPrompt echoes
 * into surface-manager's UI, extension-ui-response fills in a default
 * cancelled body) ride alongside via explicit handler functions.
 */

import type { SurfaceManager } from "./surface-manager";

/** Loose RPC interface — we build payloads dynamically from CustomEvent
 *  details so the statically-typed HyperTermRPC send signature can't
 *  narrow them without a lot of boilerplate. The bun-side handler
 *  still validates shape at the real call site. Callers pass the
 *  electrobun rpc object and we cast internally. */
 
type RpcSend = (name: any, payload: any) => void;
interface Rpc {
  send: RpcSend;
}

interface AgentEventRoute {
  event: string;
  method: string;
  /** Fields that must all be truthy on `detail` for the route to
   *  fire. Prevents half-filled events from reaching the host. */
  required: string[];
  /** Build the rpc payload from `detail`. When omitted, the whole
   *  detail is forwarded as-is (TypeScript guards at the send site
   *  catch shape mismatches). */
  buildPayload?: (detail: Record<string, unknown>) => Record<string, unknown>;
}

const AGENT_EVENT_ROUTES: AgentEventRoute[] = [
  {
    event: "ht-agent-abort",
    method: "agentAbort",
    required: ["agentId"],
  },
  {
    event: "ht-agent-set-model",
    method: "agentSetModel",
    required: ["agentId", "provider", "modelId"],
  },
  {
    event: "ht-agent-set-thinking",
    method: "agentSetThinking",
    required: ["agentId", "level"],
  },
  {
    event: "ht-agent-new-session",
    method: "agentNewSession",
    required: ["agentId"],
  },
  {
    event: "ht-agent-compact",
    method: "agentCompact",
    required: ["agentId"],
  },
  {
    event: "ht-agent-get-models",
    method: "agentGetModels",
    required: ["agentId"],
  },
  {
    event: "ht-agent-get-state",
    method: "agentGetState",
    required: ["agentId"],
  },
  {
    event: "ht-agent-steer",
    method: "agentSteer",
    required: ["agentId", "message"],
    buildPayload: (d) => ({
      agentId: d["agentId"],
      message: d["message"],
      images: d["images"],
    }),
  },
  {
    event: "ht-agent-follow-up",
    method: "agentFollowUp",
    required: ["agentId", "message"],
    buildPayload: (d) => ({
      agentId: d["agentId"],
      message: d["message"],
      images: d["images"],
    }),
  },
  {
    event: "ht-agent-bash",
    method: "agentBash",
    required: ["agentId", "command"],
    buildPayload: (d) => ({
      agentId: d["agentId"],
      command: d["command"],
      timeout: d["timeout"],
    }),
  },
  {
    event: "ht-agent-abort-bash",
    method: "agentAbortBash",
    required: ["agentId"],
  },
  {
    event: "ht-agent-cycle-model",
    method: "agentCycleModel",
    required: ["agentId"],
  },
  {
    event: "ht-agent-cycle-thinking",
    method: "agentCycleThinking",
    required: ["agentId"],
  },
  {
    event: "ht-agent-get-commands",
    method: "agentGetCommands",
    required: ["agentId"],
  },
  {
    event: "ht-agent-get-session-stats",
    method: "agentGetSessionStats",
    required: ["agentId"],
  },
  {
    event: "ht-agent-get-messages",
    method: "agentGetMessages",
    required: ["agentId"],
  },
  {
    event: "ht-agent-list-sessions",
    method: "agentListSessions",
    required: ["agentId"],
  },
  {
    event: "ht-agent-get-session-tree",
    method: "agentGetSessionTree",
    required: ["agentId"],
    buildPayload: (d) => ({
      agentId: d["agentId"],
      sessionPath: d["sessionPath"],
    }),
  },
  {
    event: "ht-agent-get-fork-messages",
    method: "agentGetForkMessages",
    required: ["agentId"],
  },
  {
    event: "ht-agent-get-last-assistant-text",
    method: "agentGetLastAssistantText",
    required: ["agentId"],
  },
  {
    event: "ht-agent-set-steering-mode",
    method: "agentSetSteeringMode",
    required: ["agentId", "mode"],
  },
  {
    event: "ht-agent-set-follow-up-mode",
    method: "agentSetFollowUpMode",
    required: ["agentId", "mode"],
  },
  {
    event: "ht-agent-abort-retry",
    method: "agentAbortRetry",
    required: ["agentId"],
  },
  {
    event: "ht-agent-set-session-name",
    method: "agentSetSessionName",
    required: ["agentId", "name"],
  },
  {
    event: "ht-agent-switch-session",
    method: "agentSwitchSession",
    required: ["agentId", "sessionPath"],
  },
  {
    event: "ht-agent-fork",
    method: "agentFork",
    required: ["agentId", "entryId"],
  },
  {
    event: "ht-agent-export-html",
    method: "agentExportHtml",
    required: ["agentId"],
    buildPayload: (d) => ({
      agentId: d["agentId"],
      outputPath: d["outputPath"],
    }),
  },
];

/** Fields on the CustomEvent detail that use `!= null` rather than
 *  truthiness (so `enabled: false` still counts as present). These
 *  are treated as optional by the `required` check. */
const NOT_NULL_FIELDS: Record<string, string[]> = {
  "ht-agent-set-auto-compaction": ["enabled"],
  "ht-agent-set-auto-retry": ["enabled"],
};

const NULLABLE_ROUTES: AgentEventRoute[] = [
  {
    event: "ht-agent-set-auto-compaction",
    method: "agentSetAutoCompaction",
    required: ["agentId"],
    buildPayload: (d) => ({
      agentId: d["agentId"],
      enabled: d["enabled"],
    }),
  },
  {
    event: "ht-agent-set-auto-retry",
    method: "agentSetAutoRetry",
    required: ["agentId"],
    buildPayload: (d) => ({
      agentId: d["agentId"],
      enabled: d["enabled"],
    }),
  },
];

/** Register every ht-agent-* DOM event handler onto `window`. Returns
 *  a teardown for tests — callers in production don't need it since
 *  the page lifecycle scrubs listeners at unload. */
export function registerAgentEvents(
  rpc: Rpc,
  surfaceManager: SurfaceManager,
): () => void {
  const abort = new AbortController();
  const opts: AddEventListenerOptions = { signal: abort.signal };

  // The single special case: prompts both echo into the panel UI and
  // forward to pi. Kept out of the route table so the dual effect is
  // obvious at the call site.
  window.addEventListener(
    "ht-agent-prompt",
    (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | Record<string, unknown>
        | undefined;
      const agentId = detail?.["agentId"] as string | undefined;
      const message = detail?.["message"] as string | undefined;
      if (!agentId || !message) return;
      const images = detail?.["images"] as never;
      surfaceManager.agentAddUserMessage(agentId, message, images);
      rpc.send("agentPrompt", { agentId, message, images });
    },
    opts,
  );

  // extension-ui-response has a cancel-fallback shape that's not just
  // a forward. Keep it standalone too.
  window.addEventListener(
    "ht-agent-extension-ui-response",
    (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | Record<string, unknown>
        | undefined;
      const agentId = detail?.["agentId"] as string | undefined;
      const id = detail?.["id"] as string | undefined;
      if (!agentId || !id) return;
      const response = (detail?.["response"] as
        | Record<string, unknown>
        | undefined) ?? {
        cancelled: (detail?.["cancelled"] as boolean | undefined) ?? true,
      };
      rpc.send("agentExtensionUIResponse", { agentId, id, response });
    },
    opts,
  );

  for (const route of AGENT_EVENT_ROUTES) {
    wireRoute(rpc, route, opts);
  }
  for (const route of NULLABLE_ROUTES) {
    wireRoute(rpc, route, opts, NOT_NULL_FIELDS[route.event]);
  }

  return () => abort.abort();
}

function wireRoute(
  rpc: Rpc,
  route: AgentEventRoute,
  opts: AddEventListenerOptions,
  notNullFields: string[] | undefined = undefined,
): void {
  window.addEventListener(
    route.event,
    (e: Event) => {
      const detail = ((e as CustomEvent).detail ?? {}) as Record<
        string,
        unknown
      >;
      for (const key of route.required) {
        if (!detail[key]) return;
      }
      if (notNullFields) {
        for (const key of notNullFields) {
          if (detail[key] == null) return;
        }
      }
      const payload = route.buildPayload ? route.buildPayload(detail) : detail;
      rpc.send(route.method, payload);
    },
    opts,
  );
}
