/**
 * ht-bridge v2 — pure hook-payload → ClaudeBridgeEvent mapping
 * (august-plan M1 / WS1).
 *
 * Everything the bridge *decides* lives here so tests can drive it with
 * recorded hook payloads and assert the exact event JSON, without
 * spawning anything. `index.ts` is the thin IO shell (stdin → this →
 * `ht claude event`).
 *
 * v1 parsed transcripts against a hand-maintained pricing table and ran
 * a `pi` sidecar to title sessions. Both are gone: cost / context / rate
 * limits / session title now arrive through `ht claude statusline` —
 * computed by Claude Code itself (see doc/august-plan.md §2.2).
 */

/** Mirror of `src/shared/claude-types.ts` ClaudeBridgeEventType. The
 *  bridge is installed OUTSIDE the repo (symlinked into ~/.claude), so
 *  it must not import from the app tree — the wire contract is the
 *  shared type, re-declared here and locked together by the tests in
 *  tests/claude-bridge.test.ts (which import both sides). */
export type BridgeEventName =
  | "session-start"
  | "session-end"
  | "prompt"
  | "stop"
  | "stop-failure"
  | "subagent-start"
  | "subagent-stop"
  | "pre-compact"
  | "post-compact"
  | "cwd-changed"
  | "notify-idle"
  | "notify-permission"
  | "permission-request"
  | "permission-resolved"
  | "task-created"
  | "task-completed";

export const BRIDGE_EVENT_NAMES: readonly BridgeEventName[] = [
  "session-start",
  "session-end",
  "prompt",
  "stop",
  "stop-failure",
  "subagent-start",
  "subagent-stop",
  "pre-compact",
  "post-compact",
  "cwd-changed",
  "notify-idle",
  "notify-permission",
  "permission-request",
  "permission-resolved",
  "task-created",
  "task-completed",
];

const MAX_PROMPT_CHARS = 2000;

function s(x: unknown): string | undefined {
  return typeof x === "string" && x ? x : undefined;
}

/**
 * Build the `ht claude event` payload for one hook invocation.
 * Returns null for unknown event names (forward-compat: an installer
 * newer than the bridge may wire events we don't know yet — skipping
 * beats crashing the hook pipeline).
 */
export function buildBridgeEvent(
  eventName: string,
  payload: Record<string, unknown>,
  env: Record<string, string | undefined>,
  now: number,
): Record<string, unknown> | null {
  if (!(BRIDGE_EVENT_NAMES as readonly string[]).includes(eventName)) {
    return null;
  }

  const ev: Record<string, unknown> = {
    type: eventName,
    sessionId: s(payload["session_id"]) ?? "unknown",
    ts: now,
  };

  const surfaceId = s(env["HT_SURFACE"]);
  if (surfaceId) ev["surfaceId"] = surfaceId;
  const cwd = s(payload["cwd"]);
  if (cwd) ev["cwd"] = cwd;
  const permissionMode = s(payload["permission_mode"]);
  if (permissionMode) ev["permissionMode"] = permissionMode;
  const transcriptPath = s(payload["transcript_path"]);
  if (transcriptPath) ev["transcriptPath"] = transcriptPath;

  switch (eventName) {
    case "session-start": {
      const source = s(payload["source"]);
      if (source) ev["source"] = source;
      break;
    }
    case "session-end": {
      const reason = s(payload["reason"]);
      if (reason) ev["reason"] = reason;
      break;
    }
    case "prompt": {
      const prompt = s(payload["prompt"]);
      if (prompt) ev["prompt"] = prompt.slice(0, MAX_PROMPT_CHARS);
      break;
    }
    case "stop":
      // Turn boundary only — data-plane numbers come via the statusline.
      break;
    case "stop-failure": {
      const errorType = s(payload["error_type"]);
      if (errorType) ev["errorType"] = errorType;
      const errorMessage = s(payload["error_message"]);
      if (errorMessage) ev["errorMessage"] = errorMessage.slice(0, 500);
      break;
    }
    case "subagent-start":
    case "subagent-stop": {
      const agentId = s(payload["agent_id"]);
      if (agentId) ev["agentId"] = agentId;
      const agentType = s(payload["agent_type"]);
      if (agentType) ev["agentType"] = agentType;
      break;
    }
    case "cwd-changed": {
      // CwdChanged carries old_cwd/new_cwd rather than a fresh `cwd`.
      const newCwd = s(payload["new_cwd"]);
      if (newCwd) ev["cwd"] = newCwd;
      break;
    }
    case "notify-idle":
    case "notify-permission": {
      const message = s(payload["message"]);
      if (message) ev["message"] = message.slice(0, 500);
      break;
    }
    // WS3 — the fire-and-forget shadow of the synchronous approval flow
    // (index.ts drives the modal; these just keep the pill honest).
    // `message` carries the tool name for the sidebar.
    case "permission-request": {
      const tool = s(payload["tool_name"]);
      if (tool) ev["message"] = tool;
      break;
    }
    case "permission-resolved":
      break;
    case "task-created":
    case "task-completed": {
      const taskId = s(payload["task_id"]);
      const taskName = s(payload["task_name"]);
      if (taskId) ev["taskId"] = taskId;
      if (taskName) ev["taskName"] = taskName;
      // TaskCreated fires mid-creation and may not carry an id yet —
      // the registry dedups `name:<task_name>` against the real id later.
      if (!taskId && !taskName) return null; // nothing to mirror
      break;
    }
    case "pre-compact":
    case "post-compact":
      break;
  }

  return ev;
}
