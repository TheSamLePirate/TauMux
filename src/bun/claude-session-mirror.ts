/**
 * Mirror the Claude session registry into the webview.
 *
 * The webview used to see Claude state only through the two sidebar
 * pills `ClaudeStatusPresenter` writes (`Claude` and `cc`), which lose
 * per-session identity as soon as two sessions share a workspace. The
 * Atlas graph needs the structured state — phase, model, context, cost,
 * tasks, subagents, pending approvals — to place a session in the
 * topology and offer the right action on it.
 *
 * The registry fires on every hook event *and* every statusline tee
 * (~1 Hz per live session), so pushes are coalesced into one per short
 * window. No timer runs while no session is changing.
 */
import type { ClaudeSessionState } from "../shared/claude-types";
import type { ClaudeSessionRegistry } from "./claude-session-registry";

const COALESCE_MS = 120;

export interface ClaudeSessionMirrorDeps {
  registry: ClaudeSessionRegistry;
  send: (sessions: ClaudeSessionState[]) => void;
}

/** Subscribe and start mirroring. Returns an unsubscribe thunk. */
export function attachClaudeSessionMirror(
  deps: ClaudeSessionMirrorDeps,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = deps.registry.onChange(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      deps.send(deps.registry.list());
    }, COALESCE_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribe();
  };
}
