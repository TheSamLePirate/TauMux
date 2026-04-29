// Triple-A I.11 / U11 — keyboard cheat-sheet rendered from the
// `KEYBOARD_BINDINGS` + `HIGH_PRIORITY_BINDINGS` arrays. Previously
// the bindings carried `id`/`description`/`category` "for a future
// help dialog" and nothing rendered them, so discoverability was
// purely tribal (read the README or hover specific buttons).
//
// Open with the `Help: Keyboard shortcuts` command from the palette
// (or via `keyboardCheatsheet.toggle()`). Closes on Escape or any
// click outside the panel.

import { escapeHtml } from "../../shared/escape-html";

// The cheat-sheet only reads metadata fields — id, description,
// category, and the matcher's `display` property. The runtime ctx
// the bindings dispatch on is irrelevant here. Use a structural
// "info-only" view so the renderer accepts `Binding<KeyCtx>[]` from
// the call site without contravariance problems on the `when`
// predicate (which we never invoke).
type BindingInfo = {
  id: string;
  description?: string;
  category?: string;
  match: { display?: string } | ((e: KeyboardEvent) => boolean);
};

export class KeyboardCheatsheet {
  private overlay: HTMLDivElement;
  private visible = false;
  private bindings: ReadonlyArray<BindingInfo> = [];

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "kbd-cheatsheet hidden";
    this.overlay.setAttribute("role", "dialog");
    this.overlay.setAttribute("aria-modal", "true");
    this.overlay.setAttribute("aria-labelledby", "kbd-cheatsheet-title");
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener("mousedown", (e) => {
      // Click on the dim background closes; click on the panel doesn't.
      if (e.target === this.overlay) this.hide();
    });
    document.addEventListener("keydown", (e) => {
      if (this.visible && e.key === "Escape") {
        e.preventDefault();
        this.hide();
      }
    });
  }

  setBindings(bindings: ReadonlyArray<BindingInfo>): void {
    this.bindings = bindings;
    if (this.visible) this.render();
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  show(): void {
    this.visible = true;
    this.overlay.classList.remove("hidden");
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.overlay.classList.add("hidden");
  }

  isVisible(): boolean {
    return this.visible;
  }

  private render(): void {
    // Group by category, preserving binding order within each.
    const groups = new Map<string, BindingInfo[]>();
    for (const b of this.bindings) {
      if (!b.description) continue;
      const display = (b.match as { display?: string }).display ?? "";
      if (!display) continue;
      const cat = b.category ?? "Other";
      const arr = groups.get(cat) ?? [];
      arr.push(b);
      groups.set(cat, arr);
    }
    // Stable category order: known up front, then anything else
    // alphabetically.
    const knownOrder = [
      "App",
      "Workspace",
      "Pane",
      "Surface",
      "Browser",
      "Terminal",
      "Overlays",
      "Other",
    ];
    const sortedCats = [...groups.keys()].sort((a, b) => {
      const ai = knownOrder.indexOf(a);
      const bi = knownOrder.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });

    const sections = sortedCats
      .map((cat) => {
        const items = groups.get(cat) ?? [];
        const rows = items
          .map((b) => {
            const keys = (b.match as { display?: string }).display ?? "";
            return `<li class="kbd-row"><kbd class="kbd-keys">${escapeHtml(keys)}</kbd><span class="kbd-desc">${escapeHtml(b.description ?? "")}</span></li>`;
          })
          .join("");
        return `<section class="kbd-section"><h3 class="kbd-cat">${escapeHtml(cat)}</h3><ul class="kbd-list">${rows}</ul></section>`;
      })
      .join("");

    this.overlay.innerHTML = `
      <div class="kbd-panel" role="document">
        <header class="kbd-header">
          <h2 id="kbd-cheatsheet-title">Keyboard shortcuts</h2>
          <button class="kbd-close" aria-label="Close" type="button">×</button>
        </header>
        <div class="kbd-body">${sections || '<p class="kbd-empty">No shortcuts registered.</p>'}</div>
        <footer class="kbd-footer"><kbd>Esc</kbd> to close</footer>
      </div>
    `;

    const closeBtn = this.overlay.querySelector(".kbd-close");
    closeBtn?.addEventListener("click", () => this.hide());
  }

  destroy(): void {
    if (this.overlay.parentElement) {
      this.overlay.parentElement.removeChild(this.overlay);
    }
  }
}
