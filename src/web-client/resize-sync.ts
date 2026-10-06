import { resizePreservingScroll } from "../shared/xterm-fit";
import type { AppState } from "./store";

/**
 * Host-authoritative grid-size sync for the web mirror.
 *
 * The host owns cols/rows. When a `resize` envelope lands (native
 * window or pane drag, another web client's proposal, sessions.resize
 * from any RPC path), the local xterm grid must follow synchronously —
 * without this pass the web's xterm kept whatever the last local fit
 * picked and only caught up when workspace switching recreated the
 * pane.
 *
 * Extracted from main.ts (module-size ratchet) and routed through the
 * shared scroll-preserving helper: a raw `term.resize()` snaps a
 * scrolled-up viewport to the top of the scrollback — the same bug
 * the native side fixed in W1-SCROLL, now fixed on the mirror too.
 */

/** Minimal structural view of main.ts's pane registry — avoids
 *  importing its closure-local TermRef interface. */
export interface ResizeSyncTermRef {
  kind: string;
  term: {
    cols: number;
    rows: number;
    resize(cols: number, rows: number): void;
  } | null;
}

export function syncTerminalGridSizes(
  state: AppState,
  prev: AppState,
  terms: Record<string, ResizeSyncTermRef>,
): void {
  for (const sid in state.surfaces) {
    const s = state.surfaces[sid];
    const ps = prev.surfaces[sid];
    if (!s) continue;
    if (ps && s.cols === ps.cols && s.rows === ps.rows) continue;
    const ref = terms[sid];
    if (!ref || ref.kind !== "term" || !ref.term) continue;
    if (ref.term.cols === s.cols && ref.term.rows === s.rows) continue;
    try {
      resizePreservingScroll(ref.term, s.cols, s.rows);
    } catch {
      /* xterm not yet ready / disposed — skip */
    }
  }
}
