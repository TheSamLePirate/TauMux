import type { Handler, HandlerDeps } from "./types";
import type {
  AskUserChoice,
  AskUserKind,
  AskUserQueue,
} from "../ask-user-queue";

/** RPC handlers for Plan #10's user-question protocol. The queue
 *  is process-local; this module exposes its API to socket callers
 *  so the agent's `ht ask` command and the future panel / Telegram
 *  reply paths share one source of truth. */
export function registerAskUser(
  _deps: HandlerDeps,
  queue: AskUserQueue,
): Record<string, Handler> {
  return {
    /** Long-pending. Resolves when the matching `agent.ask_answer` /
     *  `agent.ask_cancel` lands, or when the request's `timeout_ms`
     *  elapses. Returns the `AskUserResponse` shape verbatim. */
    "agent.ask_user": async (params) => {
      const surface_id = stringOrThrow(params, "surface_id");
      const kind = parseKind(params["kind"]);
      const title = stringOrThrow(params, "title");
      const body = optionalString(params, "body");
      const agent_id = optionalString(params, "agent_id");
      const default_ = optionalString(params, "default");
      const choices = parseChoices(params["choices"], kind);
      const timeout_ms = parsePositiveNumber(params["timeout_ms"]);
      const unsafe = params["unsafe"] === true;
      const { response } = queue.create({
        surface_id,
        kind,
        title,
        body,
        agent_id,
        choices,
        default: default_,
        timeout_ms,
        unsafe,
      });
      return response;
    },

    /** Snapshot pending requests. `surface_id` filters when set. */
    "agent.ask_pending": (params) => {
      const surface = optionalString(params, "surface_id");
      const list = surface
        ? queue.pending_for_surface(surface)
        : queue.pending_list();
      return { pending: list };
    },

    /** Resolve a pending request as the user's answer. Returns
     *  `{ resolved: boolean }` so the CLI can print "ok" vs
     *  "(no such id)". */
    "agent.ask_answer": (params) => {
      const id = stringOrThrow(params, "request_id");
      const value = stringOrThrow(params, "value");
      const resolved = queue.answer(id, value);
      return { resolved };
    },

    /** Cancel a pending request. Optional `reason` surfaces on the
     *  agent's stderr. */
    "agent.ask_cancel": (params) => {
      const id = stringOrThrow(params, "request_id");
      const reason = optionalString(params, "reason");
      const resolved = queue.cancel(id, reason);
      return { resolved };
    },
  };
}

function stringOrThrow(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`agent.ask_*: missing required string param "${key}"`);
  }
  return v;
}

function optionalString(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = params[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function parsePositiveNumber(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return undefined;
  }
  return Math.floor(raw);
}

function parseKind(raw: unknown): AskUserKind {
  if (
    raw === "yesno" ||
    raw === "choice" ||
    raw === "text" ||
    raw === "confirm-command"
  ) {
    return raw;
  }
  throw new Error(
    `agent.ask_user: invalid kind "${String(raw)}" (expect yesno|choice|text|confirm-command)`,
  );
}

function parseChoices(
  raw: unknown,
  kind: AskUserKind,
): AskUserChoice[] | undefined {
  if (kind !== "choice") return undefined;
  if (!Array.isArray(raw)) {
    throw new Error("agent.ask_user: kind=choice requires `choices` array");
  }
  const out: AskUserChoice[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = o["id"];
    if (typeof id !== "string" || id.length === 0) continue;
    const label = typeof o["label"] === "string" ? (o["label"] as string) : id;
    out.push({ id, label });
  }
  if (out.length === 0) {
    throw new Error("agent.ask_user: kind=choice requires at least one choice");
  }
  return out;
}
