/**
 * Webview mirror of the bun `ClaudeSessionRegistry`.
 *
 * Fed by the `claudeSessions` push (see `TauMuxRPC.webview.messages`).
 * Views that need structured Claude state — currently the Atlas graph —
 * read it from here instead of reverse-engineering it out of the two
 * sidebar status pills the presenter writes.
 *
 * Deliberately dumb: a snapshot, an index by surface, and a subscribe
 * hook. No reducers, no derived state — consumers own their own shaping.
 */
import type { ClaudeSessionState } from "../../shared/claude-types";

type Listener = (sessions: readonly ClaudeSessionState[]) => void;

let sessions: readonly ClaudeSessionState[] = [];
let bySurface = new Map<string, ClaudeSessionState>();
const listeners = new Set<Listener>();

/** Replace the snapshot and notify subscribers. */
export function setClaudeSessions(next: readonly ClaudeSessionState[]): void {
  sessions = next;
  const index = new Map<string, ClaudeSessionState>();
  for (const s of next) {
    if (!s.surfaceId) continue;
    // Registry order is most-recently-active first, so the first entry
    // for a surface is the one a user would call "the" session there.
    if (!index.has(s.surfaceId)) index.set(s.surfaceId, s);
  }
  bySurface = index;
  for (const fn of listeners) {
    try {
      fn(sessions);
    } catch (err) {
      console.error("[claude-session-store] listener failed", err);
    }
  }
}

/** Every live session, most-recently-active first. */
export function getClaudeSessions(): readonly ClaudeSessionState[] {
  return sessions;
}

/** The session attributed to `surfaceId`, or null. */
export function claudeSessionForSurface(
  surfaceId: string,
): ClaudeSessionState | null {
  return bySurface.get(surfaceId) ?? null;
}

/** Sessions with no pane attribution — Claude Code running outside a
 *  τ-mux pane, or a pane that has since closed. They still belong on the
 *  graph; they just hang off the root rather than a workspace. */
export function unboundClaudeSessions(): ClaudeSessionState[] {
  return sessions.filter((s) => !s.surfaceId || !bySurface.has(s.surfaceId));
}

export function subscribeClaudeSessions(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test seam. */
export function resetClaudeSessions(): void {
  sessions = [];
  bySurface = new Map();
  listeners.clear();
}
