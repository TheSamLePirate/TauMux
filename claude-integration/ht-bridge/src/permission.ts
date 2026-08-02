/**
 * ht-bridge — PermissionRequest routing, pure parts (august-plan M2 / WS3).
 *
 * The PermissionRequest hook is the ONE synchronous path in the bridge:
 * Claude Code blocks the tool call until we print a decision (or print
 * nothing, which hands the question back to Claude Code's own terminal
 * prompt). Everything decidable without IO lives here so tests can lock
 * the exact stdout JSON — a malformed decision would silently break the
 * whole approval feature.
 *
 * Safety contract (doc/august-plan.md WS3): the gate may only ever ADD
 * an answer path. Timeout, τ-mux absent, malformed payload, user picking
 * "Answer in terminal", any error → NO output, exit 0 → Claude Code
 * shows its normal prompt.
 */

/** `--choices` argument for `ht ask choice`. */
export const PERMISSION_CHOICES =
  "allow:Allow,deny:Deny,terminal:Answer in terminal";

/** Keep under Claude Code's 600 s default hook timeout with margin for
 *  the decision write. Overridable via config / env. */
export const DEFAULT_ASK_TIMEOUT_MS = 570_000;

const MAX_BODY_CHARS = 900;

export interface PermissionAsk {
  title: string;
  body: string;
  toolName: string;
}

function s(x: unknown): string | undefined {
  return typeof x === "string" && x ? x : undefined;
}

/**
 * Build the modal title/body from the hook payload. Shows ground truth —
 * the exact tool + input Claude Code would show — never a summary.
 * Returns null when the payload has no tool_name (nothing to decide on).
 */
export function formatPermissionAsk(
  payload: Record<string, unknown>,
): PermissionAsk | null {
  const toolName = s(payload["tool_name"]);
  if (!toolName) return null;
  const input =
    payload["tool_input"] && typeof payload["tool_input"] === "object"
      ? (payload["tool_input"] as Record<string, unknown>)
      : {};

  const lines: string[] = [];
  if (toolName === "Bash" && s(input["command"])) {
    lines.push(`$ ${input["command"] as string}`);
    if (s(input["description"])) lines.push(String(input["description"]));
  } else if (
    (toolName === "Edit" || toolName === "Write" || toolName === "Read") &&
    s(input["file_path"])
  ) {
    lines.push(String(input["file_path"]));
  } else if (Object.keys(input).length > 0) {
    lines.push(JSON.stringify(input, null, 2));
  }
  const mode = s(payload["permission_mode"]);
  if (mode && mode !== "default") lines.push(`mode: ${mode}`);
  const rule = s(payload["permission_rule"]);
  if (rule) lines.push(`rule: ${rule}`);

  let body = lines.join("\n");
  if (body.length > MAX_BODY_CHARS) {
    body = body.slice(0, MAX_BODY_CHARS - 1) + "…";
  }
  return { title: `Claude Code · ${toolName}`, body, toolName };
}

/**
 * The exact stdout JSON for a decision, per the PermissionRequest hook
 * schema (verified against code.claude.com/docs/en/hooks 2026-08-02):
 * `hookSpecificOutput.decision.behavior: "allow" | "deny"`.
 */
export function buildPermissionDecision(behavior: "allow" | "deny"): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior },
    },
  });
}

/** Map an `ht ask choice` outcome to a decision. Only a clean exit 0
 *  with a recognized choice id produces one — everything else falls
 *  through to Claude Code's own prompt. */
export function decisionFromAskResult(
  exitCode: number | null,
  stdout: string,
): "allow" | "deny" | null {
  if (exitCode !== 0) return null;
  const answer = stdout.trim();
  if (answer === "allow" || answer === "deny") return answer;
  return null; // "terminal", empty, garbage — no decision
}
