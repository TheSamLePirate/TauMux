import { ModalHost } from "./a11y/modal-host";

const RECENTS_STORAGE_KEY = "hyperterm-canvas.palette.recents";

/**
 * Palette categories whose commands start an agent session. Tagged amber
 * per the §7 identity rule (cyan = human / system, amber = agent), so the
 * two "Split Right" style entries are told apart before you run one.
 *
 * Categories are plain strings supplied by buildPaletteCommands in
 * index.ts; a category that is not listed here is neutral, which is the
 * right default for a new non-agent feature.
 */
const AGENT_CATEGORIES = new Set(["Agent", "Claude Code"]);

export interface PaletteCommand {
  id: string;
  category?: string;
  label: string;
  description?: string;
  shortcut?: string;
  action: () => void;
}

export class CommandPalette {
  private overlay: HTMLDivElement;
  private container: HTMLDivElement;
  private input: HTMLInputElement;
  private resultsEl: HTMLDivElement;
  private resultsMetaEl: HTMLSpanElement;
  private commands: PaletteCommand[] = [];
  private filtered: PaletteCommand[] = [];
  private selectedIndex = 0;
  private visible = false;
  private recentIds: string[];
  /** Tracks IME composition so Enter while composing doesn't fire the
   *  command. macOS/JP/CN users were submitting half-composed kanji /
   *  combining marks as queries (U15). */
  private composing = false;
  /** Single AbortController for every listener attached at the
   *  document/window level. `destroy()` aborts it, removing all of
   *  them at once. Without this the document-level Escape listener
   *  re-registered on every electrobun-dev hot-reload — N reloads = N
   *  listeners with stale `this` (G.6 / L8). */
  private abort = new AbortController();
  private host: ModalHost;

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "palette-overlay hidden";

    this.container = document.createElement("div");
    const container = this.container;
    container.className = "palette-container";

    const inputRow = document.createElement("div");
    inputRow.className = "palette-input-row";

    const prompt = document.createElement("span");
    prompt.className = "palette-prompt";
    prompt.textContent = ">";
    inputRow.appendChild(prompt);

    this.input = document.createElement("input");
    this.input.className = "palette-input";
    this.input.type = "text";
    this.input.placeholder = "Search commands, panes, and workspaces";
    this.input.autocomplete = "off";
    this.input.autocapitalize = "off";
    this.input.spellcheck = false;
    inputRow.appendChild(this.input);

    container.appendChild(inputRow);

    this.resultsEl = document.createElement("div");
    this.resultsEl.className = "palette-results";
    container.appendChild(this.resultsEl);

    const footer = document.createElement("div");
    footer.className = "palette-footer";

    this.resultsMetaEl = document.createElement("span");
    this.resultsMetaEl.className = "palette-footer-summary";
    footer.appendChild(this.resultsMetaEl);

    const hints = document.createElement("div");
    hints.className = "palette-footer-hints";
    for (const [key, label] of [
      ["\u2191\u2193", "Navigate"],
      ["Enter", "Run"],
      ["Esc", "Close"],
    ]) {
      const hint = document.createElement("span");
      hint.className = "palette-footer-hint";

      const keyEl = document.createElement("kbd");
      keyEl.className = "palette-footer-key";
      keyEl.textContent = key;
      hint.appendChild(keyEl);

      const labelEl = document.createElement("span");
      labelEl.textContent = label;
      hint.appendChild(labelEl);

      hints.appendChild(hint);
    }
    footer.appendChild(hints);
    container.appendChild(footer);

    this.overlay.appendChild(container);
    document.body.appendChild(this.overlay);

    // Give the prompt a stable id so the host can label the dialog.
    prompt.id = "palette-prompt";
    this.input.setAttribute("aria-labelledby", "palette-prompt");

    this.host = new ModalHost({
      overlay: this.overlay,
      panel: container,
      onClose: () => this.hide(),
      // Palette has its own visible Esc hint, so let the host handle it.
    });

    this.recentIds = this.loadRecents();

    this.input.addEventListener("input", () => {
      this.filter();
      this.render();
    });

    // IME composition guards (U15) — `compositionend` fires immediately
    // before the synthetic Enter key event that some IMEs use to
    // commit the composed text. We swallow Enter while composing.
    this.input.addEventListener("compositionstart", () => {
      this.composing = true;
    });
    this.input.addEventListener("compositionend", () => {
      this.composing = false;
    });

    this.input.addEventListener("keydown", (e) => {
      // Escape is routed via the host (overlay-level keydown). The input
      // also receives it because it's nested in the panel; the host
      // does preventDefault + stopPropagation, but happy-dom's stop
      // doesn't always halt re-dispatch — so we re-check here too.
      // (Native browsers handle it via the host alone.)
      if (e.defaultPrevented) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.selectedIndex = Math.min(
          this.selectedIndex + 1,
          this.filtered.length - 1,
        );
        this.render();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.render();
      } else if (e.key === "Enter") {
        // IME guard: skip when composing OR when the event's own
        // isComposing flag is set (some browsers don't fire
        // compositionend before the Enter that commits).
        if (this.composing || (e as { isComposing?: boolean }).isComposing) {
          return;
        }
        e.preventDefault();
        const cmd = this.filtered[this.selectedIndex];
        if (cmd) this.execute(cmd);
      }
    });
  }

  /** Detach every document/window-level listener and remove the
   *  overlay from the DOM. Wire onto `lifecycleDisposers` in `index.ts`
   *  so a webview reload doesn't accumulate stale palette instances. */
  destroy(): void {
    this.host.destroy();
    this.abort.abort();
    if (this.overlay.parentElement) {
      this.overlay.parentElement.removeChild(this.overlay);
    }
  }

  setCommands(commands: PaletteCommand[]): void {
    this.commands = commands;
    this.filter();
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.overlay.classList.remove("hidden");
    document.body.classList.add("palette-open");
    this.input.value = "";
    this.selectedIndex = 0;
    this.composing = false;
    this.filter();
    this.render();
    this.host.open();
    this.input.focus();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.overlay.classList.add("hidden");
    document.body.classList.remove("palette-open");
    this.input.value = "";
    this.host.close();
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Introspection used by the Tier 2 `__test.readPaletteCommands` RPC.
   *  Returns the current filtered (visible) command list in render order —
   *  empty when the palette is closed. Safe to call at any time. */
  getFilteredCommands(): PaletteCommand[] {
    return [...this.filtered];
  }

  /** Current input text, for tests that want to assert on the search query
   *  state after typing or clearing. */
  getCurrentQuery(): string {
    return this.input.value;
  }

  /** Execute the currently highlighted command (or a specific index). Drives
   *  Tier 2 `__test.executePalette` — tests can exercise the palette's
   *  "type to filter, Enter to execute" flow without synthesising Enter
   *  events through KeyboardEvent, which proved racy in headless webview. */
  executeSelected(): PaletteCommand | null {
    const cmd = this.filtered[this.selectedIndex];
    if (!cmd) return null;
    this.execute(cmd);
    return cmd;
  }

  /** Set the filter query programmatically. Keeps behaviour consistent with
   *  a real user typing: re-filters and re-renders. */
  setQuery(query: string): void {
    this.input.value = query;
    // `filter`/`render` are private; call them via the same path input uses.
    this.input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  private execute(cmd: PaletteCommand): void {
    this.remember(cmd.id);
    this.hide();
    // Palette commands ran unguarded before — a throw silently dismissed
    // the palette with no user feedback. Surface the error via toast so
    // the user at least sees something went wrong.
    try {
      cmd.action();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[palette] command ${cmd.id} failed:`, err);
      void import("./toast").then(({ showToast }) => {
        showToast(`"${cmd.label}" failed: ${message}`, "error");
      });
    }
  }

  private filter(): void {
    const query = this.input.value.toLowerCase().trim();

    if (!query) {
      this.filtered = [...this.commands].sort((a, b) => {
        const recentDelta = this.recentRank(a.id) - this.recentRank(b.id);
        if (recentDelta !== 0) return recentDelta;

        const categoryDelta = (a.category || "").localeCompare(
          b.category || "",
        );
        if (categoryDelta !== 0) return categoryDelta;

        return a.label.localeCompare(b.label);
      });
    } else {
      this.filtered = this.commands
        .filter((cmd) => {
          const haystack = [cmd.label, cmd.category, cmd.description]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return this.fuzzyMatch(haystack, query);
        })
        .sort((a, b) => {
          const aPrefix = a.label.toLowerCase().startsWith(query) ? 0 : 1;
          const bPrefix = b.label.toLowerCase().startsWith(query) ? 0 : 1;
          if (aPrefix !== bPrefix) return aPrefix - bPrefix;
          return this.recentRank(a.id) - this.recentRank(b.id);
        });
    }

    this.selectedIndex = 0;
  }

  private recentRank(id: string): number {
    const idx = this.recentIds.indexOf(id);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  }

  private fuzzyMatch(text: string, query: string): boolean {
    let qi = 0;
    for (let i = 0; i < text.length && qi < query.length; i++) {
      if (text[i] === query[qi]) qi++;
    }
    return qi === query.length;
  }

  private render(): void {
    this.resultsEl.innerHTML = "";

    const maxShow = 12;
    const items = this.filtered.slice(0, maxShow);
    this.resultsMetaEl.textContent = `${this.filtered.length} match${this.filtered.length === 1 ? "" : "es"}`;

    for (let i = 0; i < items.length; i++) {
      const cmd = items[i];
      const el = document.createElement("div");
      el.className = `palette-item${i === this.selectedIndex ? " selected" : ""}`;

      const meta = document.createElement("div");
      meta.className = "palette-item-meta";

      const top = document.createElement("div");
      top.className = "palette-item-top";

      if (cmd.category) {
        const category = document.createElement("span");
        category.className = "palette-item-category";
        // §7 identity rule: a command that spawns an agent session is
        // tagged amber, everything else stays neutral. Running "Split
        // Agent Right" and "Split Right" are materially different acts —
        // one starts a robot in your workspace — and the palette is
        // where that choice is made, so the distinction belongs here.
        if (AGENT_CATEGORIES.has(cmd.category)) {
          category.classList.add("is-agent");
        }
        category.textContent = cmd.category;
        top.appendChild(category);
      }

      const label = document.createElement("span");
      label.className = "palette-item-label";
      label.textContent = cmd.label;
      top.appendChild(label);
      meta.appendChild(top);

      if (cmd.description) {
        const description = document.createElement("span");
        description.className = "palette-item-description";
        description.textContent = cmd.description;
        meta.appendChild(description);
      }

      el.appendChild(meta);

      const trailing = document.createElement("div");
      trailing.className = "palette-item-trailing";

      if (this.recentIds.includes(cmd.id)) {
        const recent = document.createElement("span");
        recent.className = "palette-item-recent";
        recent.textContent = "Recent";
        trailing.appendChild(recent);
      }

      if (cmd.shortcut) {
        const shortcut = document.createElement("span");
        shortcut.className = "palette-item-shortcut";
        shortcut.textContent = cmd.shortcut;
        trailing.appendChild(shortcut);
      }

      el.appendChild(trailing);

      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.execute(cmd);
      });

      el.addEventListener("mouseenter", () => {
        this.selectedIndex = i;
        this.render();
      });

      this.resultsEl.appendChild(el);
    }

    // Scroll selected item into view
    const selectedEl = this.resultsEl.children[this.selectedIndex] as
      HTMLElement | undefined;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "palette-empty";
      empty.textContent = "No matching commands";
      this.resultsEl.appendChild(empty);
    }
  }

  private remember(id: string): void {
    this.recentIds = [
      id,
      ...this.recentIds.filter((value) => value !== id),
    ].slice(0, 6);
    try {
      localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(this.recentIds));
    } catch {
      // Local storage can be unavailable in private or restricted contexts.
    }
  }

  private loadRecents(): string[] {
    try {
      const raw = localStorage.getItem(RECENTS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [];
    } catch {
      return [];
    }
  }
}
