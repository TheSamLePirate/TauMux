const RECENTS_STORAGE_KEY = "hyperterm-canvas.palette.recents";

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
  private input: HTMLInputElement;
  private resultsEl: HTMLDivElement;
  private commands: PaletteCommand[] = [];
  private filtered: PaletteCommand[] = [];
  private selectedIndex = 0;
  private visible = false;
  private recentIds: string[];

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "palette-overlay hidden";

    const container = document.createElement("div");
    container.className = "palette-container";

    this.input = document.createElement("input");
    this.input.className = "palette-input";
    this.input.type = "text";
    this.input.placeholder = "Search commands, layouts, workspaces...";
    container.appendChild(this.input);

    this.resultsEl = document.createElement("div");
    this.resultsEl.className = "palette-results";
    container.appendChild(this.resultsEl);

    this.overlay.appendChild(container);
    document.body.appendChild(this.overlay);

    this.recentIds = this.loadRecents();

    this.overlay.addEventListener("mousedown", (e) => {
      if (e.target === this.overlay) this.hide();
    });

    this.input.addEventListener("input", () => {
      this.filter();
      this.render();
    });

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.hide();
      } else if (e.key === "ArrowDown") {
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
        e.preventDefault();
        const cmd = this.filtered[this.selectedIndex];
        if (cmd) this.execute(cmd);
      }
    });
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
    this.visible = true;
    this.overlay.classList.remove("hidden");
    this.input.value = "";
    this.selectedIndex = 0;
    this.filter();
    this.render();
    this.input.focus();
  }

  hide(): void {
    this.visible = false;
    this.overlay.classList.add("hidden");
    this.input.value = "";
  }

  isVisible(): boolean {
    return this.visible;
  }

  private execute(cmd: PaletteCommand): void {
    this.remember(cmd.id);
    this.hide();
    cmd.action();
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
      | HTMLElement
      | undefined;
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
