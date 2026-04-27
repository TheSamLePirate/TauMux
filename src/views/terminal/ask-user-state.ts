/**
 * Webview-side mirror of the bun ask-user queue (Plan #10 commit C).
 *
 * Holds the `AskUserRequest`s the webview learns about over the
 * Electrobun `askUserEvent` push channel, plus a snapshot seeded
 * via `agent.ask_pending` on bootstrap. The modal subscribes to
 * change notifications and renders the head request for whichever
 * surface is currently focused; the sidebar badge reads pending
 * counts.
 *
 * This module owns no DOM and no RPC — both are wired in `index.ts`.
 * That separation is what makes the store hermetically testable
 * (no Electrobun, no webview, no jsdom needed).
 */

import type { AskUserRequest } from "../../shared/types";

export type { AskUserRequest };

export type AskUserStateChange =
  | { kind: "shown"; request: AskUserRequest }
  | { kind: "resolved"; request_id: string }
  | { kind: "snapshot" };

export class AskUserState {
  /** Insertion-ordered FIFO per surface. JS Map preserves insertion
   *  order on `values()`, so we don't need a separate array. */
  private bySurface = new Map<string, AskUserRequest[]>();
  /** Secondary index for O(1) resolve. */
  private byId = new Map<string, AskUserRequest>();
  private subscribers = new Set<(change: AskUserStateChange) => void>();

  /** Add a freshly-shown request. Idempotent on `request_id` — replays
   *  of the same shown event (e.g. webview reconnect mid-flight) are
   *  silently dropped rather than duplicated. */
  pushShown(request: AskUserRequest): void {
    if (this.byId.has(request.request_id)) return;
    this.byId.set(request.request_id, request);
    const list = this.bySurface.get(request.surface_id);
    if (list) list.push(request);
    else this.bySurface.set(request.surface_id, [request]);
    this.notify({ kind: "shown", request });
  }

  /** Drop a request by id. No-op when the id is unknown — the bun
   *  queue and the webview store can race; we trust the bun-side
   *  resolved event as the truth. */
  pushResolved(request_id: string): void {
    const req = this.byId.get(request_id);
    if (!req) return;
    this.byId.delete(request_id);
    const list = this.bySurface.get(req.surface_id);
    if (list) {
      const idx = list.findIndex((r) => r.request_id === request_id);
      if (idx !== -1) list.splice(idx, 1);
      if (list.length === 0) this.bySurface.delete(req.surface_id);
    }
    this.notify({ kind: "resolved", request_id });
  }

  /** Replace the entire store with the given pending list. Used at
   *  bootstrap (or after a reconnect) to align with bun's truth.
   *  Preserves request order: callers should pass the bun queue's
   *  insertion order so per-surface FIFO matches across the wire. */
  seedSnapshot(requests: readonly AskUserRequest[]): void {
    this.bySurface.clear();
    this.byId.clear();
    for (const req of requests) {
      // Defensive dedupe: snapshot from bun should already be unique,
      // but a buggy bun build shouldn't poison the store.
      if (this.byId.has(req.request_id)) continue;
      this.byId.set(req.request_id, req);
      const list = this.bySurface.get(req.surface_id);
      if (list) list.push(req);
      else this.bySurface.set(req.surface_id, [req]);
    }
    this.notify({ kind: "snapshot" });
  }

  /** Pending requests for one surface in FIFO order. Returns the live
   *  array — callers must not mutate. Empty when nothing is pending
   *  for that surface. */
  getPendingForSurface(surface_id: string): readonly AskUserRequest[] {
    return this.bySurface.get(surface_id) ?? [];
  }

  /** Head request for a surface, or null. The modal renders this. */
  getHeadForSurface(surface_id: string): AskUserRequest | null {
    const list = this.bySurface.get(surface_id);
    return list && list.length > 0 ? list[0] : null;
  }

  /** Pending count for one surface. */
  getPendingCount(surface_id: string): number {
    return this.bySurface.get(surface_id)?.length ?? 0;
  }

  /** All pending requests across every surface in insertion order
   *  per surface. Surface order is whatever the Map iteration order
   *  is (insertion order of first-pending-on-that-surface). */
  getAllPending(): AskUserRequest[] {
    const out: AskUserRequest[] = [];
    for (const list of this.bySurface.values()) out.push(...list);
    return out;
  }

  /** Total pending count across every surface. */
  getTotalCount(): number {
    return this.byId.size;
  }

  /** Look up a request by id without mutation. */
  getById(request_id: string): AskUserRequest | null {
    return this.byId.get(request_id) ?? null;
  }

  /** Subscribe to change events. Returns an unsubscribe handle.
   *  Throwing subscribers are isolated — a buggy consumer can't
   *  poison the store, mirroring the bun-side AskUserQueue. */
  subscribe(fn: (change: AskUserStateChange) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private notify(change: AskUserStateChange): void {
    for (const fn of this.subscribers) {
      try {
        fn(change);
      } catch {
        /* don't let a buggy subscriber take down the store */
      }
    }
  }
}
