/**
 * Notification overlay — Plan #03 Section A.
 *
 * When a notification arrives carrying a `surface_id`, this module
 * anchors a floating card over the originating surface's container
 * (top-right, inside the surface bounds). The card auto-dismisses
 * after a configurable timeout; hover pauses the timer; clicking the
 * body focuses the originating surface and dismisses the
 * notification through the existing pipeline; clicking the close
 * button dismisses silently.
 *
 * Stack model:
 *   Up to MAX_VISIBLE cards per surface stack vertically. When more
 *   arrive, the oldest visible card collapses into a "+N more" pill
 *   that opens the sidebar on click.
 *
 * Lifecycle:
 *   - DOM lives inside the surface container, so existing
 *     layout / drag / resize logic moves the overlay with the
 *     surface — no extra repositioning code.
 *   - The overlay manager itself is a thin coordinator: a per-surface
 *     `OverlayStack` owns its DOM root + the queue of cards.
 *   - Removing a card removes it from the stack; relayout is handled
 *     by CSS flexbox reverse order (newest top).
 *
 * Pure manager:
 *   The stack ordering / overflow logic is split into a pure
 *   `composeStack(visible, queued, max)` helper so unit tests can
 *   exercise it without any DOM. `OverlayStack` instantiates the
 *   manager, attaches the DOM bits, and reads from the pure side.
 */

import { createIcon } from "./icons";

export interface NotificationOverlayPayload {
  /** Stable id from the notification store — used for de-dupe and
   *  for routing the dismiss back through the existing pipeline. */
  id: string;
  /** Originating surface id. Required — without it we don't anchor. */
  surfaceId: string;
  title: string;
  body?: string;
  /** Wall-clock ms of arrival. */
  time: number;
}

export interface NotificationOverlayOptions {
  /** Auto-dismiss after this many ms. Hover pauses the timer; the
   *  remaining duration restarts on mouseleave. Set to 0 to disable
   *  auto-dismiss (overlay stays until clicked). */
  autoDismissMs: number;
  /** Whether overlays render at all. Toggled from
   *  `AppSettings.notificationOverlayEnabled`. */
  enabled: boolean;
}

const DEFAULT_OPTIONS: NotificationOverlayOptions = {
  autoDismissMs: 6000,
  enabled: true,
};

const MAX_VISIBLE_PER_SURFACE = 3;

/** Pure compose: returns the visible window of cards + the overflow
 *  count for the "+N more" pill. Newest-first ordering — the most
 *  recent N stay visible, older cards collapse. */
export function composeStack<T>(
  cards: readonly T[],
  max: number = MAX_VISIBLE_PER_SURFACE,
): { visible: T[]; overflow: number } {
  if (cards.length === 0) return { visible: [], overflow: 0 };
  if (cards.length <= max) return { visible: [...cards], overflow: 0 };
  return {
    visible: cards.slice(cards.length - max),
    overflow: cards.length - max,
  };
}

/** A single per-surface stack root. Owns the DOM container that's
 *  appended to the surface container, plus an ordered card list. */
class OverlayStack {
  readonly root: HTMLElement;
  private cards: NotificationOverlayPayload[] = [];
  /** Per-card DOM + timer state. Indexed by id. */
  private nodes = new Map<string, OverlayCardController>();
  private overflowPill: HTMLButtonElement | null = null;

  constructor(
    private surfaceContainer: HTMLElement,
    private options: NotificationOverlayOptions,
    private hooks: OverlayHooks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "tau-notif-overlay-stack";
    this.surfaceContainer.appendChild(this.root);
  }

  push(payload: NotificationOverlayPayload): void {
    if (!this.options.enabled) return;
    if (this.nodes.has(payload.id)) return; // dedupe replays
    this.cards.push(payload);
    this.relayout();
  }

  remove(id: string): void {
    const idx = this.cards.findIndex((c) => c.id === id);
    if (idx === -1) return;
    this.cards.splice(idx, 1);
    const ctrl = this.nodes.get(id);
    if (ctrl) {
      ctrl.dispose();
      this.nodes.delete(id);
    }
    this.relayout();
  }

  setOptions(options: NotificationOverlayOptions): void {
    this.options = options;
    if (!options.enabled) {
      this.clear();
      return;
    }
    // Refresh auto-dismiss timers with the new duration.
    for (const ctrl of this.nodes.values()) {
      ctrl.setAutoDismissMs(options.autoDismissMs);
    }
  }

  clear(): void {
    for (const ctrl of this.nodes.values()) ctrl.dispose();
    this.nodes.clear();
    this.cards = [];
    this.relayout();
  }

  destroy(): void {
    this.clear();
    this.root.remove();
  }

  size(): number {
    return this.cards.length;
  }

  private relayout(): void {
    const { visible, overflow } = composeStack(this.cards);
    const visibleIds = new Set(visible.map((c) => c.id));

    // Remove DOM for cards no longer visible.
    for (const [id, ctrl] of [...this.nodes.entries()]) {
      if (!visibleIds.has(id)) {
        ctrl.dispose();
        this.nodes.delete(id);
      }
    }

    // Render the visible window in newest-first order. Oldest visible
    // stays on top, newest at the bottom — the user reads downward
    // toward the freshly-arrived card.
    this.root.innerHTML = "";
    for (const payload of visible) {
      let ctrl = this.nodes.get(payload.id);
      if (!ctrl) {
        ctrl = new OverlayCardController(payload, this.options, this.hooks);
        this.nodes.set(payload.id, ctrl);
      }
      this.root.appendChild(ctrl.element);
    }

    // Overflow pill — single element regardless of count.
    if (overflow > 0) {
      if (!this.overflowPill) {
        const btn = document.createElement("button");
        btn.className = "tau-notif-overlay-overflow";
        btn.type = "button";
        btn.addEventListener("click", () => this.hooks.onOverflowClick());
        this.overflowPill = btn;
      }
      this.overflowPill.textContent = `+${overflow} more`;
      this.root.appendChild(this.overflowPill);
    } else if (this.overflowPill) {
      this.overflowPill.remove();
      this.overflowPill = null;
    }
  }
}

interface OverlayHooks {
  /** User clicked the body — focus the originating surface and
   *  dismiss the notification through the existing pipeline so the
   *  sidebar list stays in sync. */
  onCardActivate: (payload: NotificationOverlayPayload) => void;
  /** User clicked the close button — dismiss without focusing. */
  onCardDismiss: (payload: NotificationOverlayPayload) => void;
  /** User clicked the overflow pill — open the sidebar (or scroll
   *  it to the notifications section). */
  onOverflowClick: () => void;
}

class OverlayCardController {
  readonly element: HTMLElement;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  private dismissDeadline: number | null = null;
  private remainingMs: number;

  constructor(
    private payload: NotificationOverlayPayload,
    private options: NotificationOverlayOptions,
    private hooks: OverlayHooks,
  ) {
    this.remainingMs = options.autoDismissMs;
    this.element = this.build();
    this.scheduleDismiss();
  }

  setAutoDismissMs(ms: number): void {
    this.remainingMs = ms;
    if (this.dismissTimer) {
      this.cancelTimer();
      this.scheduleDismiss();
    }
  }

  dispose(): void {
    this.cancelTimer();
    this.element.remove();
  }

  private build(): HTMLElement {
    const card = document.createElement("div");
    card.className = "tau-notif-overlay-card";
    card.dataset["notifId"] = this.payload.id;
    card.setAttribute("role", "alert");
    card.setAttribute("aria-live", "polite");

    // Hover pauses the auto-dismiss; mouseleave resumes from where
    // we left off so a long-hover doesn't reset the clock.
    card.addEventListener("mouseenter", () => this.pause());
    card.addEventListener("mouseleave", () => this.resume());

    // Click anywhere on the card body (excluding the close button)
    // focuses the surface + dismisses through the pipeline.
    card.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".tau-notif-overlay-close")) return;
      this.hooks.onCardActivate(this.payload);
    });

    const titleRow = document.createElement("div");
    titleRow.className = "tau-notif-overlay-title-row";

    const title = document.createElement("span");
    title.className = "tau-notif-overlay-title";
    title.textContent = this.payload.title || "Notification";
    titleRow.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tau-notif-overlay-close";
    closeBtn.setAttribute("aria-label", "Dismiss notification");
    closeBtn.append(createIcon("close", "", 12));
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.onCardDismiss(this.payload);
    });
    titleRow.appendChild(closeBtn);

    card.appendChild(titleRow);

    if (this.payload.body) {
      const body = document.createElement("div");
      body.className = "tau-notif-overlay-body";
      body.textContent = this.payload.body;
      card.appendChild(body);
    }

    // A thin progress meter fills the card width and drains over the
    // auto-dismiss window. Purely decorative — gives the user a
    // visual cue for "how long until this disappears".
    if (this.options.autoDismissMs > 0) {
      const meter = document.createElement("div");
      meter.className = "tau-notif-overlay-meter";
      meter.style.animationDuration = `${this.options.autoDismissMs}ms`;
      card.appendChild(meter);
    }

    return card;
  }

  private scheduleDismiss(): void {
    if (this.options.autoDismissMs <= 0) return;
    this.dismissDeadline = Date.now() + this.remainingMs;
    this.dismissTimer = setTimeout(() => {
      this.dismissTimer = null;
      this.hooks.onCardDismiss(this.payload);
    }, this.remainingMs);
  }

  private cancelTimer(): void {
    if (this.dismissTimer !== null) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }

  private pause(): void {
    if (this.dismissTimer === null || this.dismissDeadline === null) return;
    this.remainingMs = Math.max(0, this.dismissDeadline - Date.now());
    this.cancelTimer();
    this.dismissDeadline = null;
    // Pause the meter animation visually.
    const meter = this.element.querySelector<HTMLElement>(
      ".tau-notif-overlay-meter",
    );
    if (meter) meter.style.animationPlayState = "paused";
  }

  private resume(): void {
    if (this.dismissTimer !== null) return; // already running
    if (this.options.autoDismissMs <= 0) return;
    this.scheduleDismiss();
    const meter = this.element.querySelector<HTMLElement>(
      ".tau-notif-overlay-meter",
    );
    if (meter) meter.style.animationPlayState = "running";
  }
}

/** Top-level manager. Coordinates per-surface stacks; surface-manager
 *  resolves the surface container once at show-time. */
export class NotificationOverlay {
  private stacks = new Map<string, OverlayStack>();
  private options: NotificationOverlayOptions = { ...DEFAULT_OPTIONS };

  constructor(private hooks: OverlayHooks) {}

  setOptions(options: Partial<NotificationOverlayOptions>): void {
    this.options = { ...this.options, ...options };
    if (!this.options.enabled) {
      // Tear down all live overlays the moment the user opts out.
      this.dismissAll();
      return;
    }
    for (const stack of this.stacks.values()) {
      stack.setOptions(this.options);
    }
  }

  /** Show an overlay anchored over `surfaceContainer`. The container
   *  is supplied by the caller (surface-manager owns the lookup) so
   *  this module stays free of surface-state concerns. */
  show(
    surfaceContainer: HTMLElement,
    payload: NotificationOverlayPayload,
  ): void {
    if (!this.options.enabled) return;
    const stack = this.getOrCreateStack(payload.surfaceId, surfaceContainer);
    stack.push(payload);
  }

  /** Drop a single overlay by id. Idempotent. */
  dismiss(surfaceId: string, id: string): void {
    this.stacks.get(surfaceId)?.remove(id);
  }

  /** Drop every overlay everywhere — used when the user clears all
   *  notifications or toggles the overlay setting off. */
  dismissAll(): void {
    for (const stack of this.stacks.values()) stack.destroy();
    this.stacks.clear();
  }

  /** Forget a surface's stack entirely (e.g. surface closed). */
  forgetSurface(surfaceId: string): void {
    this.stacks.get(surfaceId)?.destroy();
    this.stacks.delete(surfaceId);
  }

  private getOrCreateStack(
    surfaceId: string,
    container: HTMLElement,
  ): OverlayStack {
    const existing = this.stacks.get(surfaceId);
    if (existing) return existing;
    const stack = new OverlayStack(container, this.options, this.hooks);
    this.stacks.set(surfaceId, stack);
    return stack;
  }
}
