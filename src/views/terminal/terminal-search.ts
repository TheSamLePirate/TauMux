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

/** Phase 7 — persist case + regex toggles across sessions so a user's
 *  workflow choice carries over reloads. localStorage is the right
 *  scope: the toggles are user-preference, not part of the saved
 *  workspace state. */
const TOGGLE_STORAGE_KEY = "hyperterm-canvas.search.toggles";

interface SearchOptions {
  caseSensitive: boolean;
  regex: boolean;
}

function loadToggles(): SearchOptions {
  try {
    const raw = localStorage.getItem(TOGGLE_STORAGE_KEY);
    if (!raw) return { caseSensitive: false, regex: false };
    const parsed = JSON.parse(raw) as Partial<SearchOptions>;
    return {
      caseSensitive: Boolean(parsed.caseSensitive),
      regex: Boolean(parsed.regex),
    };
  } catch {
    return { caseSensitive: false, regex: false };
  }
}

function saveToggles(opts: SearchOptions): void {
  try {
    localStorage.setItem(TOGGLE_STORAGE_KEY, JSON.stringify(opts));
  } catch {
    /* private mode / quota — silently skip persistence */
  }
}

/** Imperative search-bar controller. A single instance is created
 *  eagerly by SurfaceManager and reused across show/hide cycles; the
 *  DOM is constructed lazily on first show. */
export class TerminalSearchBar {
  private barEl: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private caseBtn: HTMLButtonElement | null = null;
  private regexBtn: HTMLButtonElement | null = null;
  private visible = false;
  /** Phase 7 — case + regex toggles persisted across sessions in
   *  localStorage. Initialised lazily from storage so private-mode
   *  windows still get sensible defaults. */
  private opts: SearchOptions = loadToggles();

  constructor(
    private container: HTMLElement,
    private hooks: TerminalSearchHooks,
  ) {}

  get isVisible(): boolean {
    return this.visible;
  }

  /** Test seam — read the active toggles. Public so a smoke test can
   *  assert persistence + the localStorage roundtrip. */
  getOptions(): SearchOptions {
    return { ...this.opts };
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
    // xterm SearchAddon accepts a second `ISearchOptions` arg with
    // `regex`, `caseSensitive`, `wholeWord`, `decorations`. We wire
    // case + regex from our persisted toggles.
    this.hooks.getActiveSearchAddon()?.findNext(query, {
      caseSensitive: this.opts.caseSensitive,
      regex: this.opts.regex,
    });
  }

  previous(): void {
    const query = this.inputEl?.value;
    if (!query) return;
    this.hooks.getActiveSearchAddon()?.findPrevious(query, {
      caseSensitive: this.opts.caseSensitive,
      regex: this.opts.regex,
    });
  }

  /** Phase 7 — flip a toggle. Persists to localStorage and re-runs
   *  the current query so the user sees the new match set without
   *  hitting Enter. */
  private setOption<K extends keyof SearchOptions>(
    key: K,
    value: SearchOptions[K],
  ): void {
    this.opts = { ...this.opts, [key]: value };
    saveToggles(this.opts);
    this.refreshToggleButtons();
    // Reset xterm's match-decoration cache by clearing first, then
    // running the new search.
    this.hooks.getActiveSearchAddon()?.clearDecorations();
    if (this.inputEl?.value) this.next();
  }

  private refreshToggleButtons(): void {
    if (this.caseBtn) {
      this.caseBtn.classList.toggle(
        "search-bar-toggle-active",
        this.opts.caseSensitive,
      );
      this.caseBtn.setAttribute(
        "aria-pressed",
        String(this.opts.caseSensitive),
      );
    }
    if (this.regexBtn) {
      this.regexBtn.classList.toggle(
        "search-bar-toggle-active",
        this.opts.regex,
      );
      this.regexBtn.setAttribute("aria-pressed", String(this.opts.regex));
    }
  }

  private build(): void {
    const bar = document.createElement("div");
    bar.className = "search-bar";

    const input = document.createElement("input");
    input.className = "search-bar-input";
    input.type = "text";
    input.placeholder = "Find in terminal\u2026";
    input.setAttribute("aria-label", "Search terminal");

    // Phase 7 — case + regex toggle buttons. Pressed state mirrors
    // the persisted `opts` and the buttons re-run the active query
    // on flip so the user sees the new match set immediately.
    const caseBtn = document.createElement("button");
    caseBtn.className = "search-bar-btn search-bar-toggle";
    caseBtn.title = "Case sensitive (Aa)";
    caseBtn.setAttribute("aria-label", "Toggle case sensitive");
    caseBtn.setAttribute("aria-pressed", String(this.opts.caseSensitive));
    caseBtn.textContent = "Aa";
    if (this.opts.caseSensitive)
      caseBtn.classList.add("search-bar-toggle-active");
    caseBtn.addEventListener("click", () =>
      this.setOption("caseSensitive", !this.opts.caseSensitive),
    );
    this.caseBtn = caseBtn;

    const regexBtn = document.createElement("button");
    regexBtn.className = "search-bar-btn search-bar-toggle";
    regexBtn.title = "Regular expression (.*)";
    regexBtn.setAttribute("aria-label", "Toggle regex");
    regexBtn.setAttribute("aria-pressed", String(this.opts.regex));
    regexBtn.textContent = ".*";
    if (this.opts.regex) regexBtn.classList.add("search-bar-toggle-active");
    regexBtn.addEventListener("click", () =>
      this.setOption("regex", !this.opts.regex),
    );
    this.regexBtn = regexBtn;

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
    bar.appendChild(caseBtn);
    bar.appendChild(regexBtn);
    bar.appendChild(prevBtn);
    bar.appendChild(nextBtn);
    bar.appendChild(closeBtn);
    this.container.appendChild(bar);

    this.barEl = bar;
    this.inputEl = input;
  }
}
