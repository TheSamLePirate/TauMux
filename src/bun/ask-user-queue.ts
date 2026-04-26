/**
 * Ask-user queue (Plan #10 commit A).
 *
 * Holds pending agent → user questions until a response lands via
 * the matching CLI / future panel / Telegram path. The agent's
 * `agent.ask_user` RPC blocks (returns a long-pending Promise) until
 * the queue resolves it; the resolver is paired with the request id
 * so any other RPC (`agent.ask_answer`, `agent.ask_cancel`) can
 * dispatch the response by id.
 *
 * Design notes:
 *   - Per-surface FIFO is a nice-to-have, not the durable contract:
 *     the queue is global, ids are unique, callers can answer
 *     out-of-order. The CLI surfaces the per-surface ordering via
 *     `ht ask pending` so a user reading the list sees a coherent
 *     "what was asked first" sequence.
 *   - Timeout uses `setTimeout` per-request — cleared on answer /
 *     cancel. Resolved with `action: "timeout"` so the agent's
 *     `ht ask` invocation prints a clean "(timed out)" rather than
 *     hanging forever.
 *   - Subscriber callbacks fire on every transition (added, resolved
 *     including timeout) so the bun host can broadcast to webview /
 *     web mirror without polling. Throws are isolated.
 *   - The queue never throws and never drops a pending request
 *     silently — the worst case is "nobody ever answers", which is
 *     bounded by the optional timeout.
 */

import type {
  AskUserChoice,
  AskUserKind,
  AskUserRequest,
  AskUserResponse,
} from "../shared/types";

export type { AskUserChoice, AskUserKind, AskUserRequest, AskUserResponse };

export interface AskUserCreateInput {
  surface_id: string;
  kind: AskUserKind;
  title: string;
  body?: string;
  agent_id?: string;
  choices?: AskUserChoice[];
  default?: string;
  timeout_ms?: number;
  unsafe?: boolean;
}

export interface AskUserQueueOptions {
  /** Override the wall-clock source. Tests use a fake clock to
   *  avoid sleep() in the timeout cases. */
  now?: () => number;
  /** Override the timer factory. Tests use a manual scheduler so
   *  the timeout case is deterministic. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Override the id generator. Defaults to `req:<n>` keyed by an
   *  internal counter so ids are stable across tests. */
  idFactory?: () => string;
}

export type AskUserEvent =
  | { kind: "shown"; request: AskUserRequest }
  | {
      kind: "resolved";
      request_id: string;
      response: AskUserResponse;
    };

interface PendingEntry {
  request: AskUserRequest;
  resolve: (response: AskUserResponse) => void;
  timer: unknown | null;
}

export class AskUserQueue {
  private pending = new Map<string, PendingEntry>();
  private subscribers = new Set<(event: AskUserEvent) => void>();
  private nextId = 0;
  private now: () => number;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (handle: unknown) => void;
  private idFactory: () => string;

  constructor(opts: AskUserQueueOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.setTimer =
      opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown);
    this.clearTimer =
      opts.clearTimer ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.idFactory = opts.idFactory ?? (() => `req:${++this.nextId}`);
  }

  /** Create a new question. Returns a Promise that resolves when a
   *  matching answer / cancel / timeout lands. The Promise never
   *  rejects — every termination produces an `AskUserResponse` with
   *  the appropriate `action`.
   *
   *  The returned `request` object is the same `request_id` /
   *  `created_at` shape callers see in `pending()` and on the
   *  webview push. */
  create(input: AskUserCreateInput): {
    request: AskUserRequest;
    response: Promise<AskUserResponse>;
  } {
    const id = this.idFactory();
    const request: AskUserRequest = {
      request_id: id,
      surface_id: input.surface_id,
      agent_id: input.agent_id,
      kind: input.kind,
      title: input.title,
      body: input.body,
      choices: input.choices,
      default: input.default,
      timeout_ms: input.timeout_ms,
      unsafe: input.unsafe,
      created_at: this.now(),
    };

    let resolve!: (response: AskUserResponse) => void;
    const response = new Promise<AskUserResponse>((res) => {
      resolve = res;
    });

    let timer: unknown | null = null;
    if (typeof input.timeout_ms === "number" && input.timeout_ms > 0) {
      timer = this.setTimer(() => {
        // Idempotent — if the entry is already gone (answered just
        // before the timer fired), bail.
        if (!this.pending.has(id)) return;
        this.resolveEntry(id, { request_id: id, action: "timeout" });
      }, input.timeout_ms);
    }

    this.pending.set(id, { request, resolve, timer });
    this.notify({ kind: "shown", request });
    return { request, response };
  }

  /** Drop a pending request with `action: "answer"`. The `value`
   *  shape depends on the request `kind`; the queue trusts the
   *  caller to validate (the RPC handler sanity-checks before
   *  dispatching). Returns true when the id was pending; false
   *  when nothing matched (already resolved / unknown id). */
  answer(id: string, value: string): boolean {
    return this.resolveEntry(id, {
      request_id: id,
      action: "ok",
      value,
    });
  }

  /** Drop a pending request with `action: "cancel"`. Optional reason
   *  surfaces on the agent's stderr. */
  cancel(id: string, reason?: string): boolean {
    return this.resolveEntry(id, {
      request_id: id,
      action: "cancel",
      reason,
    });
  }

  /** Pending requests in insertion order. */
  pending_list(): AskUserRequest[] {
    return [...this.pending.values()].map((e) => e.request);
  }

  /** Pending requests for a single surface, in insertion order. */
  pending_for_surface(surface_id: string): AskUserRequest[] {
    return this.pending_list().filter((r) => r.surface_id === surface_id);
  }

  /** Subscribe to events. Returns an unsubscribe handle. Throwing
   *  subscribers are isolated — a buggy consumer can't poison the
   *  queue. */
  subscribe(fn: (event: AskUserEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private resolveEntry(id: string, response: AskUserResponse): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    if (entry.timer !== null) {
      this.clearTimer(entry.timer);
    }
    try {
      entry.resolve(response);
    } catch {
      /* the awaiter rejecting in microtask isn't our problem */
    }
    this.notify({ kind: "resolved", request_id: id, response });
    return true;
  }

  private notify(event: AskUserEvent): void {
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch {
        /* don't let a buggy subscriber take down the queue */
      }
    }
  }
}
