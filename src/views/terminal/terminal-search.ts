/**
 * Terminal find-in-page bar. Extracted from SurfaceManager.
 *
 * Rendering, input handling, and next/prev search are self-contained.
 * The owner (SurfaceManager) only needs to hand over:
 *   - a mount container for the bar
 *   - a resolver that returns the currently focused surface's
 *     SearchAddon (so search follows the focused pane)
 *   - optional hooks to refocus the terminal on close and handle
 *     decoration clearing
 */

import type { SearchAddon } from "@xterm/addon-search";
import { createIcon } from "./icons";

export interface TerminalSearchHooks {
  /** Returns the active SearchAddon to search against, or null when
   *  the focused pane isn't a terminal. The resolver is called on
   *  each find/next/prev so we always target the *current* surface
   *  rather than the one that was focused when the bar opened. */
  getActiveSearchAddon: () => SearchAddon | null;
  /** Called once after `hideSearchBar()` clears decorations so the
   *  owner can refocus the terminal. Optional — absence is a no-op. */
  onClose?: () => void;
}

/** Imperative search-bar controller. A single instance is created
 *  eagerly by SurfaceManager and reused across show/hide cycles; the
 *  DOM is constructed lazily on first show. */
export class TerminalSearchBar {
  private barEl: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private visible = false;

  constructor(
    private container: HTMLElement,
    private hooks: TerminalSearchHooks,
  ) {}

  get isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  show(): void {
    if (this.visible) {
      this.inputEl?.focus();
      return;
    }
    this.visible = true;
    if (!this.barEl) this.build();
    this.barEl!.classList.add("search-bar-visible");
    this.inputEl!.value = "";
    this.inputEl!.focus();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.barEl?.classList.remove("search-bar-visible");
    // Clear existing highlights from the previously active surface.
    const addon = this.hooks.getActiveSearchAddon();
    if (addon) addon.clearDecorations();
    this.hooks.onClose?.();
  }

  next(): void {
    const query = this.inputEl?.value;
    if (!query) return;
    this.hooks.getActiveSearchAddon()?.findNext(query);
  }

  previous(): void {
    const query = this.inputEl?.value;
    if (!query) return;
    this.hooks.getActiveSearchAddon()?.findPrevious(query);
  }

  private build(): void {
    const bar = document.createElement("div");
    bar.className = "search-bar";

    const input = document.createElement("input");
    input.className = "search-bar-input";
    input.type = "text";
    input.placeholder = "Find in terminal\u2026";
    input.setAttribute("aria-label", "Search terminal");

    const prevBtn = document.createElement("button");
    prevBtn.className = "search-bar-btn";
    prevBtn.title = "Previous (Shift+Enter)";
    prevBtn.setAttribute("aria-label", "Previous match");
    prevBtn.append(createIcon("chevronUp", "", 14));
    prevBtn.addEventListener("click", () => this.previous());

    const nextBtn = document.createElement("button");
    nextBtn.className = "search-bar-btn";
    nextBtn.title = "Next (Enter)";
    nextBtn.setAttribute("aria-label", "Next match");
    nextBtn.append(createIcon("chevronDown", "", 14));
    nextBtn.addEventListener("click", () => this.next());

    const closeBtn = document.createElement("button");
    closeBtn.className = "search-bar-btn search-bar-close";
    closeBtn.title = "Close (Escape)";
    closeBtn.setAttribute("aria-label", "Close search");
    closeBtn.append(createIcon("close", "", 12));
    closeBtn.addEventListener("click", () => this.hide());

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        this.previous();
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.next();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
      }
    });

    input.addEventListener("input", () => {
      this.next();
    });

    bar.appendChild(input);
    bar.appendChild(prevBtn);
    bar.appendChild(nextBtn);
    bar.appendChild(closeBtn);
    this.container.appendChild(bar);

    this.barEl = bar;
    this.inputEl = input;
  }
}
