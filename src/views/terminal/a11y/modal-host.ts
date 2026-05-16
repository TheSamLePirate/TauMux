/**
 * Shared modal-host helper (Triple-A I.1 / U1).
 *
 * Wraps an existing overlay element with the four invariants every
 * τ-mux modal needs:
 *
 * 1. `role="dialog"` + `aria-modal="true"` on the overlay.
 * 2. Focus trap — Tab / Shift+Tab cycle among the focusable
 *    descendants; focus can't escape into the underlying terminal.
 * 3. Focus restore — on close, focus returns to whatever was active
 *    when open() was called. Keyboard users land where they started.
 * 4. Escape closes (default) + optional scrim click closes.
 *
 * The host does NOT own the DOM. Callers construct the overlay and
 * panel themselves (so this is a drop-in for Process Manager,
 * Command Palette, Settings Panel, Ask-user, Cheatsheet) and hand
 * a `ModalHostOptions` to attach the behaviour.
 *
 * All listeners are attached via a single AbortController so
 * `destroy()` is one call — same lifecycle pattern the rest of the
 * webview uses (CommandPalette / KeyboardCheatsheet).
 */

export interface ModalHostOptions {
  /** The outermost overlay element. Carries role/aria attributes
   *  and the scrim-click handler. */
  overlay: HTMLElement;
  /** The inner panel containing the focusable controls. Used to
   *  decide whether a click was "on the scrim" (target === overlay)
   *  or "inside the panel" (target descends from panel). */
  panel: HTMLElement;
  /** id of the element that names the dialog. Wired to
   *  `aria-labelledby`. Pass undefined to skip (rare — most modals
   *  have a visible title). */
  labelledBy?: string;
  /** id of the element that describes the dialog. Wired to
   *  `aria-describedby`. Optional. */
  describedBy?: string;
  /** When true (default), Escape calls onClose. Set false for modals
   *  that handle Escape themselves (e.g. a multi-step wizard that
   *  treats Escape as "back"). */
  escapeCloses?: boolean;
  /** When true (default), clicking the overlay backdrop calls onClose.
   *  Set false for modals where stray clicks shouldn't dismiss
   *  (e.g. ask-user prompts that need a deliberate decision). */
  scrimCloses?: boolean;
  /** Called when the host wants the modal closed. The caller is
   *  responsible for the actual hide animation / DOM removal — the
   *  host just signals intent. */
  onClose: () => void;
}

/**
 * Standard focusable selector. Mirrors what axe-core checks plus the
 * common `[tabindex]:not([tabindex="-1"])` clause for custom controls.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]:not([disabled])",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(",");

export class ModalHost {
  private readonly opts: ModalHostOptions;
  private abort: AbortController | null = null;
  private previouslyFocused: Element | null = null;
  private isOpen = false;

  constructor(opts: ModalHostOptions) {
    this.opts = opts;
    // Apply the static a11y attributes once. open()/close() doesn't
    // need to touch them — they're stable for the modal's lifetime.
    this.opts.overlay.setAttribute("role", "dialog");
    this.opts.overlay.setAttribute("aria-modal", "true");
    if (this.opts.labelledBy) {
      this.opts.overlay.setAttribute("aria-labelledby", this.opts.labelledBy);
    }
    if (this.opts.describedBy) {
      this.opts.overlay.setAttribute("aria-describedby", this.opts.describedBy);
    }
  }

  /** Attach listeners and remember the currently-focused element so
   *  close() can restore focus. Safe to call when already open
   *  (no-op). */
  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.previouslyFocused = document.activeElement;
    this.abort = new AbortController();
    const signal = this.abort.signal;

    // Focus trap on Tab / Shift+Tab, Escape close.
    this.opts.overlay.addEventListener(
      "keydown",
      (e) => this.handleKeydown(e),
      { signal },
    );

    // Scrim click — only the overlay itself (not the panel) is the
    // backdrop. event.target === overlay means the click landed on
    // the dim area outside the panel.
    if (this.opts.scrimCloses !== false) {
      this.opts.overlay.addEventListener(
        "mousedown",
        (e) => {
          if (e.target === this.opts.overlay) {
            this.opts.onClose();
          }
        },
        { signal },
      );
    }
  }

  /** Detach listeners and restore focus to the pre-open element.
   *  Safe to call when not open (no-op). */
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.abort?.abort();
    this.abort = null;
    // Restore focus to the pre-open element if it's still in the
    // document and focusable. Defensive: a modal that opened during
    // a layout transition could find the previously-focused element
    // has been re-mounted; in that case we just give up silently
    // (no exception) — the user's next Tab will find the body.
    const prev = this.previouslyFocused;
    this.previouslyFocused = null;
    if (
      prev instanceof HTMLElement &&
      document.contains(prev) &&
      typeof prev.focus === "function"
    ) {
      try {
        prev.focus();
      } catch {
        /* swallow — never throw from close() */
      }
    }
  }

  /** Permanently detach. After destroy() the host is unusable; create
   *  a new one if you need to re-open the modal. */
  destroy(): void {
    this.close();
  }

  /** Programmatic focus to the first focusable descendant. Useful in
   *  open() flows where the caller wants the modal to "land" with
   *  focus inside it (otherwise the initial Tab press is the only
   *  way in, which is slightly worse UX for keyboard users). */
  focusFirst(): void {
    const focusables = this.getFocusableDescendants();
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      // No focusable controls — put focus on the panel itself so the
      // a11y tree at least announces the dialog title. The panel
      // needs tabindex=-1 to be programmatically focusable; we set it
      // here rather than asking callers to remember.
      if (!this.opts.panel.hasAttribute("tabindex")) {
        this.opts.panel.setAttribute("tabindex", "-1");
      }
      this.opts.panel.focus();
    }
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && this.opts.escapeCloses !== false) {
      e.preventDefault();
      e.stopPropagation();
      this.opts.onClose();
      return;
    }
    if (e.key !== "Tab") return;
    // Recompute focusable set each press — modals can hide / show
    // controls dynamically (e.g. settings sections, palette filter).
    const focusables = this.getFocusableDescendants();
    if (focusables.length === 0) {
      // Nothing to cycle — trap focus on the panel itself.
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    // "Inside the cycle" means active is one of the focusable
    // descendants. The panel container itself (when it received
    // programmatic focus via tabindex=-1) does NOT count — Tab from
    // there should land on the first focusable, not pass through.
    const inCycle = active != null && focusables.includes(active);
    if (e.shiftKey) {
      if (!inCycle || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (!inCycle || active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  private getFocusableDescendants(): HTMLElement[] {
    const nodes =
      this.opts.panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    // Filter to visible elements — `display:none` / `visibility:hidden`
    // controls shouldn't count toward the cycle. The cheapest reliable
    // check is `offsetParent` (null for display:none in most engines)
    // combined with `getClientRects().length` (zero for visibility:hidden).
    const out: HTMLElement[] = [];
    for (const n of nodes) {
      if (n.offsetParent === null && n.getClientRects().length === 0) continue;
      out.push(n);
    }
    return out;
  }
}
